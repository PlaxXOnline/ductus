/**
 * Generation pipeline: segmentation → cost estimation (NFR3) →
 * sequential generation with segment cache and faithfulness judge.
 */

import type { JourneyGraph } from '@ductus/schema';
import type {
  FaithfulnessViolation,
  GeneratedSegment,
  GenerateResult,
  Granularity,
  LlmConfig,
  LlmProvider,
  LlmUsage,
  Voice,
} from '../contracts.js';
import { SegmentCache, type CacheEntry } from './cache.js';
import { estimateTokens } from './cost.js';
import { judgeParseFailed, runFaithfulnessCheck } from './judge.js';
import { checkLexicon } from './lexicon.js';
import { buildGenerationPrompt, buildJudgePrompt, PROMPT_VERSION, serializeSegment } from './prompts.js';
import { segmentGraph } from './segment.js';
import { outputStrings } from '../output/strings.js';

/** Upper bound of the output estimate per call (NFR3). */
const ESTIMATED_OUTPUT_CAP = 800;

export interface GenerateDocsOptions {
  graph: JourneyGraph;
  provider: LlmProvider;
  llm: LlmConfig;
  voice: Voice;
  locale: string;
  appName?: string;
  granularity: Granularity;
  cacheDir: string;
  log?: (msg: string) => void;
}

function promptChars(parts: { system: string; messages: Array<{ content: string }> }): string {
  return parts.system + parts.messages.map((m) => m.content).join('\n');
}

export async function generateDocs(opts: GenerateDocsOptions): Promise<GenerateResult> {
  const segments = segmentGraph(opts.graph, opts.granularity, {
    miscTitle: outputStrings(opts.locale).miscSegmentTitle,
  });
  const promptOpts = {
    voice: opts.voice,
    locale: opts.locale,
    ...(opts.appName !== undefined ? { appName: opts.appName } : {}),
  };
  const perCallOutput = Math.min(opts.llm.maxTokens, ESTIMATED_OUTPUT_CAP);

  // Upfront estimate across ALL segments — before the first provider call,
  // regardless of what the cache serves later (NFR3).
  let estimatedInput = 0;
  let estimatedOutput = 0;
  for (const segment of segments) {
    const generation = buildGenerationPrompt(segment, promptOpts);
    estimatedInput += estimateTokens(promptChars(generation));
    estimatedOutput += perCallOutput;
    if (opts.llm.faithfulnessCheck) {
      // Judge input = judge prompt plus the (not yet generated) Markdown ≈ perCallOutput tokens.
      const judge = buildJudgePrompt(segment, '', opts.voice);
      estimatedInput += estimateTokens(promptChars(judge)) + perCallOutput;
      estimatedOutput += perCallOutput;
    }
  }

  const cache = new SegmentCache(opts.cacheDir);
  const styleKey = `${opts.voice}|${opts.locale}`;
  const results: GeneratedSegment[] = [];
  let hits = 0;
  let misses = 0;
  const totalUsage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (usage: LlmUsage | undefined): void => {
    if (!usage) return;
    totalUsage.inputTokens += usage.inputTokens;
    totalUsage.outputTokens += usage.outputTokens;
  };

  // Sequential instead of parallel: stable ordering of logs and usage (determinism).
  for (const segment of segments) {
    const segmentJson = serializeSegment(segment);
    const key = cache.computeKey({
      segmentJson,
      promptVersion: PROMPT_VERSION,
      model: opts.llm.model,
      styleKey,
    });

    const cached = cache.get(key);
    if (cached) {
      hits += 1;
      opts.log?.(`Segment "${segment.id}": served from cache`);
      results.push({
        segment,
        markdown: cached.markdown,
        fromCache: true,
        violations: cached.violations,
        hints: cached.hints ?? [],
      });
      continue;
    }

    misses += 1;
    opts.log?.(`Segment "${segment.id}": generating`);
    const generation = buildGenerationPrompt(segment, promptOpts);
    const response = await opts.provider.complete({
      system: generation.system,
      messages: generation.messages,
      maxTokens: opts.llm.maxTokens,
      temperature: opts.llm.temperature,
    });
    addUsage(response.usage);
    let segmentUsage: LlmUsage | undefined = response.usage;

    // Deterministic vocabulary check — always runs (free, no LLM).
    const lexicon = checkLexicon(response.text, segment, {
      ...(opts.appName !== undefined ? { appName: opts.appName } : {}),
    });
    const violations: FaithfulnessViolation[] = [...lexicon.violations];
    const hints: FaithfulnessViolation[] = [...lexicon.hints];
    if (opts.llm.faithfulnessCheck) {
      const judged = await runFaithfulnessCheck(opts.provider, segment, response.text, {
        maxTokens: opts.llm.maxTokens,
        temperature: opts.llm.temperature,
        voice: opts.voice,
        ...(opts.appName !== undefined ? { appName: opts.appName } : {}),
      });
      violations.push(...judged.violations);
      hints.push(...judged.hints);
      if (judged.refuted > 0) {
        opts.log?.(
          `Segment "${segment.id}": ${judged.refuted} judge finding(s) mechanically refuted and discarded`,
        );
      }
      addUsage(judged.usage);
      if (judged.usage) {
        segmentUsage = segmentUsage
          ? {
              inputTokens: segmentUsage.inputTokens + judged.usage.inputTokens,
              outputTokens: segmentUsage.outputTokens + judged.usage.outputTokens,
            }
          : judged.usage;
      }
    }

    if (judgeParseFailed(violations)) {
      // Do not cache: a formatting slip by the judge should be retried on the
      // next run instead of being persisted in the cache.
      opts.log?.(`Segment "${segment.id}": judge response unparsable — result will not be cached`);
    } else {
      const entry: CacheEntry = {
        markdown: response.text,
        ...(segmentUsage ? { usage: segmentUsage } : {}),
        violations,
        hints,
      };
      cache.set(key, entry);
    }
    results.push({
      segment,
      markdown: response.text,
      fromCache: false,
      ...(segmentUsage ? { usage: segmentUsage } : {}),
      violations,
      hints,
    });
  }

  return {
    segments: results,
    cache: { hits, misses },
    usage: totalUsage,
    estimated: { inputTokens: estimatedInput, outputTokens: estimatedOutput },
  };
}
