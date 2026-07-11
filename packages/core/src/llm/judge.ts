/**
 * Faithfulness-Judge: zweiter LLM-Aufruf, der die generierte Prosa gegen das
 * Graph-Segment prüft (behauptet der Text Schritte/Elemente, die nicht im
 * Graphen stehen?).
 *
 * Dem Judge wird nicht geglaubt, er wird verifiziert: Jedes Finding muss ein
 * wörtliches Zitat aus dem Text und das angeblich fehlende Element nennen.
 * Code prüft beides deterministisch — nur mechanisch bestätigte Findings
 * werden Violations, Grenzfälle werden Hinweise, widerlegte Findings
 * (Zitat nicht im Text oder Element doch im Graphen) werden verworfen.
 */

import type {
  FaithfulnessViolation,
  GraphSegment,
  LlmProvider,
  LlmResponseFormat,
  LlmUsage,
} from '../contracts.js';
import { buildVocabulary, normalizeTerm, termCoverage } from './lexicon.js';
import { buildJudgePrompt } from './prompts.js';

const UNPARSABLE_CLAIM = '(Judge-Antwort unparsebar)';
const RAW_SNIPPET_MAX_CHARS = 200;

/** Erkennt das konservative Fallback-Ergebnis eines gescheiterten Judge-Parses. */
export function judgeParseFailed(violations: FaithfulnessViolation[]): boolean {
  return violations.some((v) => v.claim === UNPARSABLE_CLAIM);
}

/**
 * Schema der Judge-Antwort — Provider mit Structured Output (anthropic,
 * openai, mistral) garantieren damit API-seitig gültiges JSON.
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

/**
 * Akzeptiert rohes JSON, einen ```json-Fence oder ein in Prosa eingebettetes
 * JSON-Objekt. Liefert das rohe violations-Array oder undefined, wenn kein
 * Kandidat ein gültiges {"violations": [...]}-Objekt ergibt.
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
      // nächster Kandidat
    }
  }
  return undefined;
}

/** Konservatives Fallback: Unparsebares wird als eine Violation gemeldet (lieber warnen als schlucken). */
function unparsableViolation(text: string): FaithfulnessViolation {
  const snippet = text.trim().slice(0, RAW_SNIPPET_MAX_CHARS);
  return {
    claim: UNPARSABLE_CLAIM,
    reason:
      snippet === ''
        ? 'Die Judge-Antwort war leer.'
        : `Die Judge-Antwort war kein gültiges JSON mit "violations"-Array. Antwort begann mit: ${JSON.stringify(snippet)}`,
  };
}

export interface VerifiedJudgeResult {
  /** Mechanisch bestätigt: Zitat steht im Text UND Element fehlt im Segment. */
  violations: FaithfulnessViolation[];
  /** Nicht verifizierbar oder nur lexikalisch grenzwertig — manuell nachprüfen. */
  hints: FaithfulnessViolation[];
  /** Nachweislich falsche Findings (Zitat erfunden oder Element existiert) — verworfen. */
  refuted: number;
}

/**
 * Verifiziert die rohen Judge-Findings deterministisch gegen Text und Segment.
 * Findings ohne quote/element (z. B. Altformat) können nicht geprüft werden
 * und werden als Hinweis geführt.
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
    const reason = typeof record['reason'] === 'string' ? record['reason'] : '(keine Begründung)';

    if (quote === undefined || element === undefined || normalizeTerm(quote) === '') {
      // Unverifizierbar (fehlende Felder / Altformat {claim, reason}) ⇒ Hinweis.
      const claim = typeof record['claim'] === 'string' ? record['claim'] : JSON.stringify(finding);
      hints.push({ claim, reason: `Unverifizierbares Judge-Finding (ohne Zitat/Element): ${reason}` });
      continue;
    }

    if (!normalizedMarkdown.includes(normalizeTerm(quote))) {
      // Das "Zitat" steht gar nicht im generierten Text — Judge widerlegt.
      refuted += 1;
      continue;
    }

    const coverage = termCoverage(element, vocab);
    if (coverage === 'covered') {
      // Das angeblich fehlende Element steht im Segment — Judge widerlegt.
      refuted += 1;
    } else if (coverage === 'near') {
      hints.push({
        claim: quote,
        reason: `Element „${element}“ ist nur lexikalisch verwandt mit dem Graph-Vokabular — ${reason}`,
      });
    } else {
      violations.push({
        claim: quote,
        reason: `Behauptet „${element}“, das im Graph-Segment nicht belegt ist — ${reason}`,
      });
    }
  }

  return { violations, hints, refuted };
}

export async function runFaithfulnessCheck(
  provider: LlmProvider,
  segment: GraphSegment,
  markdown: string,
  opts: { maxTokens: number; temperature: number; appName?: string },
): Promise<{ violations: FaithfulnessViolation[]; hints: FaithfulnessViolation[]; refuted: number; usage?: LlmUsage }> {
  const { system, messages } = buildJudgePrompt(segment, markdown);
  const response = await provider.complete({
    system,
    messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    responseFormat: JUDGE_RESPONSE_FORMAT,
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
