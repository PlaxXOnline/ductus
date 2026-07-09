/**
 * Faithfulness-Judge (SPEC §8.3 Schritt 4): zweiter LLM-Aufruf, der die
 * generierte Prosa gegen das Graph-Segment prüft.
 */

import type { FaithfulnessViolation, GraphSegment, LlmProvider, LlmUsage } from '../contracts.js';
import { buildJudgePrompt } from './prompts.js';

const UNPARSABLE_CLAIM = '(Judge-Antwort unparsebar)';

function toViolation(value: unknown): FaithfulnessViolation {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    claim: typeof record['claim'] === 'string' ? record['claim'] : JSON.stringify(value),
    reason: typeof record['reason'] === 'string' ? record['reason'] : '(keine Begründung)',
  };
}

/**
 * Akzeptiert rohes JSON oder einen ```json-Fence; alles Unparsebare wird
 * konservativ als eine Violation gemeldet (lieber falsch warnen als schlucken).
 */
export function parseJudgeResponse(text: string): FaithfulnessViolation[] {
  const candidates: string[] = [text.trim()];
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim());
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const violations = (parsed as { violations?: unknown } | null)?.violations;
      if (Array.isArray(violations)) return violations.map(toViolation);
    } catch {
      // nächster Kandidat
    }
  }
  return [
    {
      claim: UNPARSABLE_CLAIM,
      reason: 'Die Judge-Antwort war kein gültiges JSON mit "violations"-Array.',
    },
  ];
}

export async function runFaithfulnessCheck(
  provider: LlmProvider,
  segment: GraphSegment,
  markdown: string,
  opts: { maxTokens: number; temperature: number },
): Promise<{ violations: FaithfulnessViolation[]; usage?: LlmUsage }> {
  const { system, messages } = buildJudgePrompt(segment, markdown);
  const response = await provider.complete({
    system,
    messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  const violations = parseJudgeResponse(response.text);
  return { violations, ...(response.usage ? { usage: response.usage } : {}) };
}
