/**
 * Faithfulness-Judge: zweiter LLM-Aufruf, der die generierte Prosa gegen das
 * Graph-Segment prüft (behauptet der Text Schritte/Elemente, die nicht im
 * Graphen stehen?).
 */

import type { FaithfulnessViolation, GraphSegment, LlmProvider, LlmUsage } from '../contracts.js';
import { buildJudgePrompt } from './prompts.js';

const UNPARSABLE_CLAIM = '(Judge-Antwort unparsebar)';
const RAW_SNIPPET_MAX_CHARS = 200;

/** Erkennt das konservative Fallback-Ergebnis eines gescheiterten Judge-Parses. */
export function judgeParseFailed(violations: FaithfulnessViolation[]): boolean {
  return violations.some((v) => v.claim === UNPARSABLE_CLAIM);
}

/** Erstes balanciertes {…}-Objekt im Text (String-Literale werden übersprungen). */
function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function toViolation(value: unknown): FaithfulnessViolation {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    claim: typeof record['claim'] === 'string' ? record['claim'] : JSON.stringify(value),
    reason: typeof record['reason'] === 'string' ? record['reason'] : '(keine Begründung)',
  };
}

/**
 * Akzeptiert rohes JSON, einen ```json-Fence oder ein in Prosa eingebettetes
 * JSON-Objekt; alles Unparsebare wird konservativ als eine Violation gemeldet
 * (lieber falsch warnen als schlucken).
 */
export function parseJudgeResponse(text: string): FaithfulnessViolation[] {
  const candidates: string[] = [text.trim()];
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim());
  const embedded = extractFirstJsonObject(text);
  if (embedded !== undefined) candidates.push(embedded);
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const violations = (parsed as { violations?: unknown } | null)?.violations;
      if (Array.isArray(violations)) return violations.map(toViolation);
    } catch {
      // nächster Kandidat
    }
  }
  const snippet = text.trim().slice(0, RAW_SNIPPET_MAX_CHARS);
  return [
    {
      claim: UNPARSABLE_CLAIM,
      reason:
        snippet === ''
          ? 'Die Judge-Antwort war leer.'
          : `Die Judge-Antwort war kein gültiges JSON mit "violations"-Array. Antwort begann mit: ${JSON.stringify(snippet)}`,
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
