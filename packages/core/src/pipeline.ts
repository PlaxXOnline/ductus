/**
 * Pipeline-Orchestrierung der CLI-Kommandos: extract → generate → check.
 * Verbindet Adapter-Runner, Graph-Pipeline, LLM-Schicht und Ausgabe-Module.
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
import { scaffoldWebsite } from './output/website.js';
import { buildReport, writeReport } from './report.js';

/** LLM-Fehler (fehlender Key, --offline mit echtem Provider, …) ⇒ Exit-Code 3. */
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
  /** Geschriebene Artefakt-Pfade (leer bei Validierungsfehlern oder write:false). */
  written: string[];
}

/** Führt alle Adapter aus und merged deren Graphen (MergeError wird durchgereicht). */
async function extractGraph(
  config: DuctusConfig,
  opts: PipelineOptions,
): Promise<{ graph: JourneyGraph; validation: ValidationResult }> {
  const results: AdapterRunResult[] = [];
  for (const entry of config.adapters) {
    opts.log?.(`Adapter "${entry.name}" wird ausgeführt …`);
    results.push(
      await runAdapter(entry, {
        rootDir: config.rootDir,
        ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
        ...(opts.log !== undefined ? { log: opts.log } : {}),
      }),
    );
  }

  // NFR7/V6: schemaVersion JEDES Adapter-Graphen VOR dem Merge prüfen —
  // mergeGraphs normalisiert auf die unterstützte Version und würde eine
  // inkompatible Adapter-Ausgabe sonst stillschweigend maskieren. Die Prüfung
  // liegt bewusst hier (nicht im Runner), damit der Fall als Validierungsfehler
  // (Exit 1) und nicht als AdapterError (Exit 3) klassifiziert wird.
  const versionErrors: ValidationIssue[] = results
    .filter((r) => !isSupportedSchemaVersion(r.graph.schemaVersion))
    .map((r) => ({
      rule: 'V6',
      severity: 'error' as const,
      message:
        `Adapter "${r.adapter.name}": schemaVersion "${r.graph.schemaVersion}" wird nicht ` +
        `unterstützt (erwartet Major ${SUPPORTED_SCHEMA_MAJOR}, z. B. "${SUPPORTED_SCHEMA_MAJOR}.0").`,
    }));
  if (versionErrors.length > 0) {
    // Kein Merge: der erste gelieferte Graph dient nur als Platzhalter —
    // bei Fehlern wird er weder geschrieben noch weiterverarbeitet.
    return { graph: results[0]!.graph, validation: { errors: versionErrors, warnings: [] } };
  }

  // Die Config (app:-Sektion der ductus.config.yaml) ist die maßgebliche
  // Quelle für App-Metadaten.
  const app: AppInfo = {
    name: config.app.name,
    locale: config.app.locale,
    ...(config.app.platforms !== undefined ? { platforms: config.app.platforms } : {}),
  };
  const graph = mergeGraphs(results.map((r) => r.graph), { app });
  return { graph, validation: validateGraph(graph) };
}

/**
 * extract: Adapter → Merge → Validierung; bei 0 Fehlern werden
 * journey-graph.json und ductus-report.json neben die Config geschrieben
 * (rootDir; Cache und Graph-HTML liegen dagegen unter .ductus/).
 * Mit write:false bleibt alles im Speicher (check/graph).
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
  /** Fehlt bei Validierungsfehlern (Abbruch vor der Generierung, Exit 1). */
  result?: GenerateResult;
  pages: MdxPage[];
  /** Geschriebene Doku-Pfade (MDX-Modus) bzw. leer im Website-Modus. */
  writtenDocs: string[];
  reportPath?: string;
  violationsTotal: number;
  costUsd?: number;
}

/** Muss mit ESTIMATED_OUTPUT_CAP in llm/generate.ts übereinstimmen (NFR3). */
const ESTIMATED_OUTPUT_CAP = 800;

/** Kostenschätzung VOR der Generierung (NFR3) — gleiche Rechnung wie generateDocs. */
function logEstimate(config: DuctusConfig, graph: JourneyGraph, log?: (m: string) => void): void {
  if (log === undefined) return;
  const segments = segmentGraph(graph, config.style.granularity);
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
      const judge = buildJudgePrompt(segment, '');
      inputTokens += estimateTokens(judge.system + judge.messages.map((m) => m.content).join('\n')) + perCallOutput;
      outputTokens += perCallOutput;
    }
  }

  const cost = estimateCostUsd({ inputTokens, outputTokens }, config.llm.pricing);
  log(
    `Kostenschätzung (vorab): ${segments.length} Segment(e), ` +
      `~${inputTokens} Input-Token, ~${outputTokens} Output-Token` +
      (cost !== undefined ? `, ~${cost.toFixed(4)} USD` : ''),
  );
}

/** Wurzelverzeichnis des @ductus/core-Pakets — dieses Modul liegt in <corePkg>/src bzw. <corePkg>/dist. */
function corePackageDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Template-Auflösung für den Website-Modus: Config-Pfad → Paket-Assets → Repo-Vorlage. */
function resolveTemplateDir(config: DuctusConfig, generator: WebsiteGenerator): string {
  if (config.output.website.template !== undefined) {
    const custom = resolve(config.rootDir, config.output.website.template);
    if (!existsSync(custom)) {
      throw new ConfigError(`"output.website.template": Verzeichnis nicht gefunden: "${custom}".`);
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
    `Website-Template "${generator}" nicht gefunden (gesucht: ${candidates.join(', ')}). ` +
      'Alternativ output.website.template setzen.',
  );
}

/**
 * Version von @ductus/core deterministisch zur Laufzeit aus der package.json
 * des Pakets lesen (KEIN Hardcoding — Muster analog resolveTemplateDir mit
 * import.meta.url). Wird in ductus.data.json als site.ductusVersion eingebettet.
 */
function resolveDuctusVersion(): string {
  const pkgPath = join(corePackageDir(), 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version;
  } catch {
    // fällt unten auf den ConfigError durch
  }
  throw new ConfigError(`Version von @ductus/core nicht ermittelbar (package.json: "${pkgPath}").`);
}

export async function runGenerate(
  config: DuctusConfig,
  opts: PipelineOptions = {},
): Promise<GenerateRunResult> {
  const extract = await runExtract(config, opts);
  if (extract.validation.errors.length > 0) {
    // Abbruch: Der Aufrufer signalisiert Exit-Code 1 (Validierungsfehler).
    return { extract, pages: [], writtenDocs: [], violationsTotal: 0 };
  }

  // --offline erlaubt generate nur mit dem netzfreien mock-Provider
  // (extract/check/graph bleiben uneingeschränkt), sonst Exit 3.
  if (opts.offline === true && config.llm.provider !== 'mock') {
    throw new LlmError(
      `--offline erlaubt "generate" nur mit llm.provider "mock" (konfiguriert: "${config.llm.provider}").`,
    );
  }
  if (config.output.format === 'website' && config.output.website.generator === 'docusaurus') {
    throw new ConfigError(
      'output.website.generator "docusaurus" ist in Phase 1 nicht enthalten — bitte "journey" (Default) oder "starlight" verwenden.',
    );
  }

  let provider;
  try {
    provider = createProvider(config.llm);
  } catch (error) {
    throw new LlmError(error instanceof Error ? error.message : String(error));
  }

  // NFR3: Schätzung VOR dem ersten Provider-Aufruf ausgeben.
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

  const pages = buildMdxPages(result, { diagrams: config.output.website.diagrams });
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
      // journey-Modus: statt MDX/Sidebar wird genau eine ductus.data.json geschrieben.
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
  /** Faithfulness-Verstöße aus den Cache-Einträgen der aktuellen Segmente. */
  faithfulnessViolations: Array<{ segmentId: string; violations: FaithfulnessViolation[] }>;
  /** Unbestätigte Judge-/Lexikon-Hinweise — informativ, zählen nicht gegen den Schwellwert. */
  faithfulnessHints: Array<{ segmentId: string; hints: FaithfulnessViolation[] }>;
  /** Segmente ohne Cache-Eintrag — „noch nicht generiert". */
  notGenerated: string[];
}

/**
 * check: Extract + Validierung im Speicher (KEINE Dateien schreiben);
 * Faithfulness ausschließlich aus dem Segment-Cache — kein LLM-Aufruf,
 * keine Kosten (CI-tauglich, offline-sicher).
 */
export async function runCheck(config: DuctusConfig, opts: PipelineOptions = {}): Promise<CheckResult> {
  const { graph, validation } = await extractGraph(config, opts);
  if (validation.errors.length > 0) {
    return { validation, faithfulnessViolations: [], faithfulnessHints: [], notGenerated: [] };
  }

  const segments = segmentGraph(graph, config.style.granularity);
  const cacheDir = join(config.rootDir, '.ductus', 'cache');
  if (!existsSync(cacheDir)) {
    // Kein Cache ⇒ nichts generiert; Verzeichnis NICHT anlegen (B.8: nichts schreiben).
    return {
      validation,
      faithfulnessViolations: [],
      faithfulnessHints: [],
      notGenerated: segments.map((s) => s.id),
    };
  }

  const cache = new SegmentCache(cacheDir);
  // Cache-Key exakt wie in generateDocs (llm/generate.ts): PROMPT_VERSION, model, voice|locale.
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
