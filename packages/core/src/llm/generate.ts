/**
 * Generierungs-Pipeline: Segmentierung → Kostenschätzung (NFR3) →
 * sequenzielle Generierung mit Segment-Cache und Faithfulness-Judge.
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
import { buildGenerationPrompt, buildJudgePrompt, PROMPT_VERSION, serializeSegment } from './prompts.js';
import { segmentGraph } from './segment.js';

/** Obergrenze der Output-Schätzung je Aufruf (NFR3). */
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
  const segments = segmentGraph(opts.graph, opts.granularity);
  const promptOpts = {
    voice: opts.voice,
    locale: opts.locale,
    ...(opts.appName !== undefined ? { appName: opts.appName } : {}),
  };
  const perCallOutput = Math.min(opts.llm.maxTokens, ESTIMATED_OUTPUT_CAP);

  // Vorab-Schätzung über ALLE Segmente — vor dem ersten Provider-Aufruf,
  // unabhängig davon, was später aus dem Cache kommt (NFR3).
  let estimatedInput = 0;
  let estimatedOutput = 0;
  for (const segment of segments) {
    const generation = buildGenerationPrompt(segment, promptOpts);
    estimatedInput += estimateTokens(promptChars(generation));
    estimatedOutput += perCallOutput;
    if (opts.llm.faithfulnessCheck) {
      // Judge-Input = Judge-Prompt plus das (noch ungenerierte) Markdown ≈ perCallOutput Token.
      const judge = buildJudgePrompt(segment, '');
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

  // Sequenziell statt parallel: stabile Reihenfolge von Logs und usage (Determinismus).
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
      opts.log?.(`Segment "${segment.id}": aus Cache übernommen`);
      results.push({
        segment,
        markdown: cached.markdown,
        fromCache: true,
        violations: cached.violations,
      });
      continue;
    }

    misses += 1;
    opts.log?.(`Segment "${segment.id}": wird generiert`);
    const generation = buildGenerationPrompt(segment, promptOpts);
    const response = await opts.provider.complete({
      system: generation.system,
      messages: generation.messages,
      maxTokens: opts.llm.maxTokens,
      temperature: opts.llm.temperature,
    });
    addUsage(response.usage);
    let segmentUsage: LlmUsage | undefined = response.usage;

    let violations: FaithfulnessViolation[] = [];
    if (opts.llm.faithfulnessCheck) {
      const judged = await runFaithfulnessCheck(opts.provider, segment, response.text, {
        maxTokens: opts.llm.maxTokens,
        temperature: opts.llm.temperature,
      });
      violations = judged.violations;
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
      // Nicht cachen: ein Format-Ausrutscher des Judge soll beim nächsten
      // Lauf erneut versucht werden, statt dauerhaft im Cache zu liegen.
      opts.log?.(`Segment "${segment.id}": Judge-Antwort unparsebar — Ergebnis wird nicht gecacht`);
    } else {
      const entry: CacheEntry = {
        markdown: response.text,
        ...(segmentUsage ? { usage: segmentUsage } : {}),
        violations,
      };
      cache.set(key, entry);
    }
    results.push({
      segment,
      markdown: response.text,
      fromCache: false,
      ...(segmentUsage ? { usage: segmentUsage } : {}),
      violations,
    });
  }

  return {
    segments: results,
    cache: { hits, misses },
    usage: totalUsage,
    estimated: { inputTokens: estimatedInput, outputTokens: estimatedOutput },
  };
}
