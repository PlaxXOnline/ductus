/**
 * Faithfulness judge: a second LLM call that checks the generated prose against
 * the graph segment (does the text claim steps/elements that are not in the
 * graph?).
 *
 * The judge is not trusted, it is verified: every finding must name a verbatim
 * quote from the text and the allegedly missing element. Code checks both
 * deterministically — only mechanically confirmed findings become violations,
 * borderline cases become hints, refuted findings (quote not in the text or
 * element present in the graph after all) are discarded.
 */

import type {
  FaithfulnessViolation,
  GraphSegment,
  LlmProvider,
  LlmResponseFormat,
  LlmUsage,
  Voice,
} from '../contracts.js';
import { buildVocabulary, normalizeTerm, termCoverage } from './lexicon.js';
import { buildJudgePrompt } from './prompts.js';

const UNPARSABLE_CLAIM = '(judge response unparsable)';
const RAW_SNIPPET_MAX_CHARS = 200;

/** Detects the conservative fallback result of a failed judge parse. */
export function judgeParseFailed(violations: FaithfulnessViolation[]): boolean {
  return violations.some((v) => v.claim === UNPARSABLE_CLAIM);
}

/**
 * Schema of the judge response — providers with structured output (anthropic,
 * openai, mistral) use it to guarantee valid JSON API-side. The descriptions
 * are model-visible prompt data and follow the judge prompt's language:
 * German for 'formal-sie'/'informal-du' (byte-identical to the original),
 * English for 'en-you'. Select via judgeResponseFormat(voice).
 */
export const JUDGE_RESPONSE_FORMAT: LlmResponseFormat = {
  name: 'faithfulness_violations',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      violations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string', description: 'Wörtliches Zitat der beanstandeten Passage.' },
            element: {
              type: 'string',
              description: 'Das behauptete UI-Element / der Schritt / die Bedingung, die im Graph-Segment fehlt.',
            },
            reason: { type: 'string', description: 'Kurze Begründung.' },
          },
          required: ['quote', 'element', 'reason'],
        },
      },
    },
    required: ['violations'],
  },
};

const JUDGE_RESPONSE_FORMAT_EN: LlmResponseFormat = {
  name: 'faithfulness_violations',
  description: 'Structured response in the given schema.',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      violations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            quote: { type: 'string', description: 'Verbatim quote of the offending passage.' },
            element: {
              type: 'string',
              description: 'The claimed UI element / step / condition that is missing from the graph segment.',
            },
            reason: { type: 'string', description: 'Short justification.' },
          },
          required: ['quote', 'element', 'reason'],
        },
      },
    },
    required: ['violations'],
  },
};

/** Response format matching the judge prompt's language for the given voice. */
export function judgeResponseFormat(voice: Voice): LlmResponseFormat {
  return voice === 'en-you' ? JUDGE_RESPONSE_FORMAT_EN : JUDGE_RESPONSE_FORMAT;
}

/** First balanced {…} object in the text (string literals are skipped). */
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

/**
 * Accepts raw JSON, a ```json fence, or a JSON object embedded in prose.
 * Returns the raw violations array, or undefined when no candidate yields a
 * valid {"violations": [...]} object.
 */
export function parseJudgeFindings(text: string): unknown[] | undefined {
  const candidates: string[] = [text.trim()];
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim());
  const embedded = extractFirstJsonObject(text);
  if (embedded !== undefined) candidates.push(embedded);
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const violations = (parsed as { violations?: unknown } | null)?.violations;
      if (Array.isArray(violations)) return violations;
    } catch {
      // next candidate
    }
  }
  return undefined;
}

/** Conservative fallback: unparsable output is reported as one violation (warn rather than swallow). */
function unparsableViolation(text: string): FaithfulnessViolation {
  const snippet = text.trim().slice(0, RAW_SNIPPET_MAX_CHARS);
  return {
    claim: UNPARSABLE_CLAIM,
    reason:
      snippet === ''
        ? 'The judge response was empty.'
        : `The judge response was not valid JSON with a "violations" array. Response began with: ${JSON.stringify(snippet)}`,
  };
}

export interface VerifiedJudgeResult {
  /** Mechanically confirmed: quote appears in the text AND element is missing from the segment. */
  violations: FaithfulnessViolation[];
  /** Not verifiable or only lexically borderline — review manually. */
  hints: FaithfulnessViolation[];
  /** Demonstrably false findings (fabricated quote or element does exist) — discarded. */
  refuted: number;
}

/**
 * Verifies the raw judge findings deterministically against text and segment.
 * Findings without quote/element (e.g. legacy format) cannot be checked and
 * are kept as hints.
 */
export function verifyJudgeFindings(
  findings: unknown[],
  markdown: string,
  segment: GraphSegment,
  opts: { appName?: string } = {},
): VerifiedJudgeResult {
  const vocab = buildVocabulary(segment, opts.appName);
  const normalizedMarkdown = normalizeTerm(markdown);
  const violations: FaithfulnessViolation[] = [];
  const hints: FaithfulnessViolation[] = [];
  let refuted = 0;

  for (const finding of findings) {
    const record =
      finding !== null && typeof finding === 'object' ? (finding as Record<string, unknown>) : {};
    const quote = typeof record['quote'] === 'string' ? record['quote'] : undefined;
    const element = typeof record['element'] === 'string' ? record['element'] : undefined;
    const reason = typeof record['reason'] === 'string' ? record['reason'] : '(no reason given)';

    if (quote === undefined || element === undefined || normalizeTerm(quote) === '') {
      // Unverifiable (missing fields / legacy format {claim, reason}) ⇒ hint.
      const claim = typeof record['claim'] === 'string' ? record['claim'] : JSON.stringify(finding);
      hints.push({ claim, reason: `Unverifiable judge finding (no quote/element): ${reason}` });
      continue;
    }

    if (!normalizedMarkdown.includes(normalizeTerm(quote))) {
      // The "quote" does not appear in the generated text at all — judge refuted.
      refuted += 1;
      continue;
    }

    const coverage = termCoverage(element, vocab);
    if (coverage === 'covered') {
      // The allegedly missing element is present in the segment — judge refuted.
      refuted += 1;
    } else if (coverage === 'near') {
      hints.push({
        claim: quote,
        reason: `Element “${element}” is only lexically related to the graph vocabulary — ${reason}`,
      });
    } else {
      violations.push({
        claim: quote,
        reason: `Claims “${element}”, which is not backed by the graph segment — ${reason}`,
      });
    }
  }

  return { violations, hints, refuted };
}

export async function runFaithfulnessCheck(
  provider: LlmProvider,
  segment: GraphSegment,
  markdown: string,
  opts: { maxTokens: number; temperature: number; voice: Voice; appName?: string },
): Promise<{ violations: FaithfulnessViolation[]; hints: FaithfulnessViolation[]; refuted: number; usage?: LlmUsage }> {
  const { system, messages } = buildJudgePrompt(segment, markdown, opts.voice);
  const response = await provider.complete({
    system,
    messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    responseFormat: judgeResponseFormat(opts.voice),
  });
  const findings = parseJudgeFindings(response.text);
  const result =
    findings === undefined
      ? { violations: [unparsableViolation(response.text)], hints: [], refuted: 0 }
      : verifyJudgeFindings(findings, markdown, segment, {
          ...(opts.appName !== undefined ? { appName: opts.appName } : {}),
        });
  return { ...result, ...(response.usage ? { usage: response.usage } : {}) };
}
