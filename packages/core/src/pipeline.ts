/**
 * Pipeline orchestration of the CLI commands: extract → generate → check.
 * Connects the adapter runner, graph pipeline, LLM layer, and output modules.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterInfo, AppInfo, JourneyGraph } from '@ductus/schema';
import { SUPPORTED_SCHEMA_MAJOR, isSupportedSchemaVersion } from '@ductus/schema';
import { runAdapter } from './adapters/runner.js';
import { ConfigError } from './config.js';
import type {
  AdapterRunResult,
  DuctusConfig,
  FaithfulnessViolation,
  GenerateResult,
  MdxPage,
  ValidationIssue,
  ValidationResult,
  WebsiteGenerator,
} from './contracts.js';
import { mergeGraphs, serializeGraph, validateGraph } from './graph/index.js';
import {
  buildGenerationPrompt,
  buildJudgePrompt,
  createProvider,
  estimateCostUsd,
  estimateTokens,
  generateDocs,
  PROMPT_VERSION,
  SegmentCache,
  segmentGraph,
  serializeSegment,
} from './llm/index.js';
import { buildJourneyData } from './output/journey-data.js';
import { buildMdxPages, writeMdxPages } from './output/mdx.js';
import { outputStrings } from './output/strings.js';
import { scaffoldWebsite } from './output/website.js';
import { buildReport, writeReport } from './report.js';

/** LLM error (missing key, --offline with a real provider, …) ⇒ exit code 3. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface PipelineOptions {
  offline?: boolean;
  log?: (message: string) => void;
}

// ─────────────────────────────── runExtract ─────────────────────────────────

export interface ExtractResult {
  graph: JourneyGraph;
  validation: ValidationResult;
  adapterInfos: AdapterInfo[];
  /** Written artifact paths (empty on validation errors or write:false). */
  written: string[];
}

/** Runs all adapters and merges their graphs (MergeError is passed through). */
async function extractGraph(
  config: DuctusConfig,
  opts: PipelineOptions,
): Promise<{ graph: JourneyGraph; validation: ValidationResult }> {
  const results: AdapterRunResult[] = [];
  for (const entry of config.adapters) {
    opts.log?.(`Running adapter "${entry.name}" …`);
    results.push(
      await runAdapter(entry, {
        rootDir: config.rootDir,
        ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
        ...(opts.log !== undefined ? { log: opts.log } : {}),
      }),
    );
  }

  // NFR7/V6: check the schemaVersion of EVERY adapter graph BEFORE the merge —
  // mergeGraphs normalizes to the supported version and would otherwise
  // silently mask an incompatible adapter output. The check deliberately lives
  // here (not in the runner) so the case is classified as a validation error
  // (exit 1) rather than an AdapterError (exit 3).
  const versionErrors: ValidationIssue[] = results
    .filter((r) => !isSupportedSchemaVersion(r.graph.schemaVersion))
    .map((r) => ({
      rule: 'V6',
      severity: 'error' as const,
      message:
        `Adapter "${r.adapter.name}": schemaVersion "${r.graph.schemaVersion}" is not ` +
        `supported (expected major ${SUPPORTED_SCHEMA_MAJOR}, e.g. "${SUPPORTED_SCHEMA_MAJOR}.0").`,
    }));
  if (versionErrors.length > 0) {
    // No merge: the first returned graph serves only as a placeholder —
    // on errors it is neither written nor processed further.
    return { graph: results[0]!.graph, validation: { errors: versionErrors, warnings: [] } };
  }

  // The config (app: section of ductus.config.yaml) is the authoritative
  // source for app metadata.
  const app: AppInfo = {
    name: config.app.name,
    locale: config.app.locale,
    ...(config.app.platforms !== undefined ? { platforms: config.app.platforms } : {}),
  };
  const graph = mergeGraphs(results.map((r) => r.graph), { app });
  return { graph, validation: validateGraph(graph) };
}

/**
 * extract: adapters → merge → validation; with 0 errors, journey-graph.json
 * and ductus-report.json are written next to the config (rootDir; the cache
 * and graph HTML live under .ductus/ instead).
 * With write:false everything stays in memory (check/graph).
 */
export async function runExtract(
  config: DuctusConfig,
  opts: PipelineOptions & { write?: boolean } = {},
): Promise<ExtractResult> {
  const { graph, validation } = await extractGraph(config, opts);
  const adapterInfos = graph.meta?.adapters ?? [];

  const written: string[] = [];
  if (validation.errors.length === 0 && opts.write !== false) {
    const graphPath = join(config.rootDir, 'journey-graph.json');
    writeFileSync(graphPath, serializeGraph(graph), 'utf8');
    written.push(graphPath);

    const reportPath = join(config.rootDir, 'ductus-report.json');
    writeReport(buildReport({ adapters: adapterInfos, warnings: validation.warnings }), reportPath);
    written.push(reportPath);
  }

  return { graph, validation, adapterInfos, written };
}

// ─────────────────────────────── runGenerate ─────────────────────────────────

export interface GenerateRunResult {
  extract: ExtractResult;
  /** Missing on validation errors (aborted before generation, exit 1). */
  result?: GenerateResult;
  pages: MdxPage[];
  /** Written docs paths (MDX mode); empty in website mode. */
  writtenDocs: string[];
  reportPath?: string;
  violationsTotal: number;
  costUsd?: number;
}

/** Must match ESTIMATED_OUTPUT_CAP in llm/generate.ts (NFR3). */
const ESTIMATED_OUTPUT_CAP = 800;

/** Cost estimate BEFORE generation (NFR3) — same calculation as generateDocs. */
function logEstimate(config: DuctusConfig, graph: JourneyGraph, log?: (m: string) => void): void {
  if (log === undefined) return;
  const segments = segmentGraph(graph, config.style.granularity, {
    miscTitle: outputStrings(config.app.locale).miscSegmentTitle,
  });
  const promptOpts = { voice: config.style.voice, locale: config.app.locale, appName: config.app.name };
  const perCallOutput = Math.min(config.llm.maxTokens, ESTIMATED_OUTPUT_CAP);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const segment of segments) {
    const generation = buildGenerationPrompt(segment, promptOpts);
    inputTokens += estimateTokens(
      generation.system + generation.messages.map((m) => m.content).join('\n'),
    );
    outputTokens += perCallOutput;
    if (config.llm.faithfulnessCheck) {
      const judge = buildJudgePrompt(segment, '', config.style.voice);
      inputTokens += estimateTokens(judge.system + judge.messages.map((m) => m.content).join('\n')) + perCallOutput;
      outputTokens += perCallOutput;
    }
  }

  const cost = estimateCostUsd({ inputTokens, outputTokens }, config.llm.pricing);
  log(
    `Cost estimate (upfront): ${segments.length} segment(s), ` +
      `~${inputTokens} input tokens, ~${outputTokens} output tokens` +
      (cost !== undefined ? `, ~${cost.toFixed(4)} USD` : ''),
  );
}

/** Root directory of the @ductus/core package — this module lives in <corePkg>/src or <corePkg>/dist. */
function corePackageDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Template resolution for website mode: config path → package assets → repo template. */
function resolveTemplateDir(config: DuctusConfig, generator: WebsiteGenerator): string {
  if (config.output.website.template !== undefined) {
    const custom = resolve(config.rootDir, config.output.website.template);
    if (!existsSync(custom)) {
      throw new ConfigError(`"output.website.template": directory not found: "${custom}".`);
    }
    return custom;
  }
  const corePkgDir = corePackageDir();
  const candidates = [
    join(corePkgDir, 'assets', 'templates', generator),
    resolve(corePkgDir, '..', '..', 'templates', generator),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ConfigError(
    `Website template "${generator}" not found (searched: ${candidates.join(', ')}). ` +
      'Alternatively set output.website.template.',
  );
}

/**
 * Read the version of @ductus/core deterministically at runtime from the
 * package's package.json (NO hardcoding — pattern analogous to
 * resolveTemplateDir with import.meta.url). Embedded in ductus.data.json as
 * site.ductusVersion.
 */
function resolveDuctusVersion(): string {
  const pkgPath = join(corePackageDir(), 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version;
  } catch {
    // falls through to the ConfigError below
  }
  throw new ConfigError(`Cannot determine the version of @ductus/core (package.json: "${pkgPath}").`);
}

export async function runGenerate(
  config: DuctusConfig,
  opts: PipelineOptions = {},
): Promise<GenerateRunResult> {
  const extract = await runExtract(config, opts);
  if (extract.validation.errors.length > 0) {
    // Abort: the caller signals exit code 1 (validation errors).
    return { extract, pages: [], writtenDocs: [], violationsTotal: 0 };
  }

  // --offline allows generate only with the network-free mock provider
  // (extract/check/graph remain unrestricted), otherwise exit 3.
  if (opts.offline === true && config.llm.provider !== 'mock') {
    throw new LlmError(
      `--offline allows "generate" only with llm.provider "mock" (configured: "${config.llm.provider}").`,
    );
  }
  if (config.output.format === 'website' && config.output.website.generator === 'docusaurus') {
    throw new ConfigError(
      'output.website.generator "docusaurus" is not included in phase 1 — please use "journey" (default) or "starlight".',
    );
  }

  let provider;
  try {
    provider = createProvider(config.llm);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : String(error));
  }

  // NFR3: print the estimate BEFORE the first provider call.
  logEstimate(config, extract.graph, opts.log);

  const result = await generateDocs({
    graph: extract.graph,
    provider,
    llm: config.llm,
    voice: config.style.voice,
    locale: config.app.locale,
    appName: config.app.name,
    granularity: config.style.granularity,
    cacheDir: join(config.rootDir, '.ductus', 'cache'),
    ...(opts.log !== undefined ? { log: opts.log } : {}),
  });

  const pages = buildMdxPages(result, {
    diagrams: config.output.website.diagrams,
    locale: config.app.locale,
  });
  const outDir = resolve(config.rootDir, config.output.dir);
  let writtenDocs: string[] = [];
  if (config.output.format === 'mdx') {
    writtenDocs = await writeMdxPages(pages, outDir);
  } else {
    const generator = config.output.website.generator;
    await scaffoldWebsite({
      templateDir: resolveTemplateDir(config, generator),
      outDir,
      pages,
      appName: config.app.name,
      locale: config.app.locale,
      generator,
      // journey mode: exactly one ductus.data.json is written instead of MDX/sidebar.
      ...(generator === 'journey'
        ? {
            journeyData: buildJourneyData({
              result,
              adapterInfos: extract.adapterInfos,
              appName: config.app.name,
              locale: config.app.locale,
              ductusVersion: resolveDuctusVersion(),
            }),
          }
        : {}),
    });
  }

  const violationsTotal = result.segments.reduce((sum, s) => sum + s.violations.length, 0);
  const costUsd = estimateCostUsd(result.usage, config.llm.pricing);

  const reportPath = join(config.rootDir, 'ductus-report.json');
  writeReport(
    buildReport({
      adapters: extract.adapterInfos,
      warnings: extract.validation.warnings,
      segments: result.segments,
      cache: result.cache,
      estimated: result.estimated,
      usage: result.usage,
      ...(costUsd !== undefined ? { costUsd } : {}),
    }),
    reportPath,
  );

  return {
    extract,
    result,
    pages,
    writtenDocs,
    reportPath,
    violationsTotal,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

// ─────────────────────────────── runCheck ────────────────────────────────────

export interface CheckResult {
  validation: ValidationResult;
  /** Faithfulness violations from the cache entries of the current segments. */
  faithfulnessViolations: Array<{ segmentId: string; violations: FaithfulnessViolation[] }>;
  /** Unconfirmed judge/lexicon hints — informational, do not count against the threshold. */
  faithfulnessHints: Array<{ segmentId: string; hints: FaithfulnessViolation[] }>;
  /** Segments without a cache entry — “not generated yet”. */
  notGenerated: string[];
}

/**
 * check: extract + validation in memory (write NO files); faithfulness comes
 * exclusively from the segment cache — no LLM call, no cost (CI-friendly,
 * offline-safe).
 */
export async function runCheck(config: DuctusConfig, opts: PipelineOptions = {}): Promise<CheckResult> {
  const { graph, validation } = await extractGraph(config, opts);
  if (validation.errors.length > 0) {
    return { validation, faithfulnessViolations: [], faithfulnessHints: [], notGenerated: [] };
  }

  const segments = segmentGraph(graph, config.style.granularity, {
    miscTitle: outputStrings(config.app.locale).miscSegmentTitle,
  });
  const cacheDir = join(config.rootDir, '.ductus', 'cache');
  if (!existsSync(cacheDir)) {
    // No cache ⇒ nothing generated; do NOT create the directory (B.8: write nothing).
    return {
      validation,
      faithfulnessViolations: [],
      faithfulnessHints: [],
      notGenerated: segments.map((s) => s.id),
    };
  }

  const cache = new SegmentCache(cacheDir);
  // Cache key exactly as in generateDocs (llm/generate.ts): PROMPT_VERSION, model, voice|locale.
  const styleKey = `${config.style.voice}|${config.app.locale}`;
  const faithfulnessViolations: CheckResult['faithfulnessViolations'] = [];
  const faithfulnessHints: CheckResult['faithfulnessHints'] = [];
  const notGenerated: string[] = [];

  for (const segment of segments) {
    const key = cache.computeKey({
      segmentJson: serializeSegment(segment),
      promptVersion: PROMPT_VERSION,
      model: config.llm.model,
      styleKey,
    });
    const entry = cache.get(key);
    if (entry === undefined) {
      notGenerated.push(segment.id);
      continue;
    }
    if (entry.violations.length > 0) {
      faithfulnessViolations.push({ segmentId: segment.id, violations: entry.violations });
    }
    const hints = entry.hints ?? [];
    if (hints.length > 0) {
      faithfulnessHints.push({ segmentId: segment.id, hints });
    }
  }

  return { validation, faithfulnessViolations, faithfulnessHints, notGenerated };
}
