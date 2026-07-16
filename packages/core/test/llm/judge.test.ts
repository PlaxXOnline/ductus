import { describe, expect, it } from 'vitest';
import type { GraphSegment, LlmProvider, LlmRequest } from '../../src/contracts.js';
import {
  JUDGE_RESPONSE_FORMAT,
  judgeParseFailed,
  judgeResponseFormat,
  parseJudgeFindings,
  runFaithfulnessCheck,
  verifyJudgeFindings,
} from '../../src/llm/judge.js';

const segment: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung',
  order: 1,
  nodes: [{ id: 'login', type: 'screen', title: 'Login', source: 'derived' }],
  edges: [
    {
      id: 'e1',
      from: 'login',
      to: 'login',
      trigger: 'tap',
      label: 'Anmelden',
      condition: 'Zugangsdaten gültig',
      source: 'annotation',
    },
  ],
  exits: [],
};

const markdown =
  '## Anmelden\n\n1. Tippen Sie auf **Anmelden**.\n2. Tippen Sie auf **Exportieren**, um die Daten zu sichern.';

describe('parseJudgeFindings', () => {
  it('parses raw JSON', () => {
    expect(parseJudgeFindings('{"violations":[{"quote":"X","element":"Y","reason":"Z"}]}')).toEqual([
      { quote: 'X', element: 'Y', reason: 'Z' },
    ]);
    expect(parseJudgeFindings('{"violations": []}')).toEqual([]);
  });

  it('parses JSON inside a ```json fence', () => {
    const fenced = 'Hier das Ergebnis:\n```json\n{"violations":[{"quote":"A","element":"B","reason":"C"}]}\n```\n';
    expect(parseJudgeFindings(fenced)).toEqual([{ quote: 'A', element: 'B', reason: 'C' }]);
  });

  it('parses JSON embedded in prose without a fence', () => {
    const prose = 'Nach Prüfung: {"violations":[{"quote":"C","element":"D","reason":"E"}]} — fertig.';
    expect(parseJudgeFindings(prose)).toEqual([{ quote: 'C', element: 'D', reason: 'E' }]);
    // Curly braces inside strings must not break the balance.
    const tricky = 'Ergebnis: {"violations":[{"quote":"mit } Klammer","element":"X","reason":"R"}]}';
    expect(parseJudgeFindings(tricky)).toEqual([{ quote: 'mit } Klammer', element: 'X', reason: 'R' }]);
  });

  it('returns undefined for unparsable input', () => {
    for (const garbage of ['lorem ipsum', '{"foo": 1}', '{"violations": "kaputt"}', '']) {
      expect(parseJudgeFindings(garbage)).toBeUndefined();
    }
  });
});

describe('verifyJudgeFindings', () => {
  it('confirms a finding only when the quote is in the text AND the element is missing from the segment', () => {
    const result = verifyJudgeFindings(
      [{ quote: 'Tippen Sie auf **Exportieren**', element: 'Exportieren', reason: 'nicht im Graph' }],
      markdown,
      segment,
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.claim).toContain('Exportieren');
    expect(result.violations[0]!.reason).toContain('nicht im Graph');
    expect(result.hints).toEqual([]);
    expect(result.refuted).toBe(0);
  });

  it('discards a finding whose allegedly missing element is in the segment', () => {
    const result = verifyJudgeFindings(
      [{ quote: 'Tippen Sie auf **Anmelden**', element: 'Anmelden', reason: 'angeblich erfunden' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toEqual([]);
    expect(result.refuted).toBe(1);
  });

  it('discards a finding whose quote does not appear in the text', () => {
    const result = verifyJudgeFindings(
      [{ quote: 'Dieser Satz existiert nirgendwo', element: 'Exportieren', reason: 'x' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.refuted).toBe(1);
  });

  it('classifies findings without quote/element as an unverifiable hint', () => {
    const result = verifyJudgeFindings(
      [{ claim: 'Altformat-Behauptung', reason: 'alte Judge-Antwort' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.claim).toBe('Altformat-Behauptung');
    expect(result.hints[0]!.reason).toContain('Unverifiable judge finding');
  });

  it('classifies merely lexically related elements as a hint', () => {
    // "Anmeldung" (inflection of "Anmelden") — shared prefix ≥ 6, but no full match …
    // covered here via the segment title, so use an invented related compound instead:
    const result = verifyJudgeFindings(
      [{ quote: 'Tippen Sie auf **Anmelden**', element: 'Anmeldeformular', reason: 'r' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.reason).toContain('only lexically related');
  });
});

describe('runFaithfulnessCheck', () => {
  it('calls the provider with the judge prompt + responseFormat and verifies the findings', async () => {
    const seen: LlmRequest[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      complete: (request) => {
        seen.push(request);
        return Promise.resolve({
          text: JSON.stringify({
            violations: [
              { quote: 'Tippen Sie auf **Exportieren**', element: 'Exportieren', reason: 'fehlt' },
              { quote: 'Tippen Sie auf **Anmelden**', element: 'Anmelden', reason: 'Irrtum' },
            ],
          }),
          usage: { inputTokens: 5, outputTokens: 2 },
        });
      },
    };
    const result = await runFaithfulnessCheck(provider, segment, markdown, {
      maxTokens: 123,
      temperature: 0.1,
      voice: 'formal-sie',
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.claim).toContain('Exportieren');
    expect(result.refuted).toBe(1);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toContain('FAITHFULNESS-JUDGE');
    expect(seen[0]!.messages[0]!.content).toContain('## Anmelden');
    expect(seen[0]!.maxTokens).toBe(123);
    expect(seen[0]!.temperature).toBe(0.1);
    expect(seen[0]!.responseFormat).toBe(JUDGE_RESPONSE_FORMAT);
  });

  it('uses the English judge prompt and response format for "en-you"', async () => {
    const seen: LlmRequest[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      complete: (request) => {
        seen.push(request);
        return Promise.resolve({ text: '{"violations": []}' });
      },
    };
    await runFaithfulnessCheck(provider, segment, markdown, {
      maxTokens: 10,
      temperature: 0,
      voice: 'en-you',
    });
    expect(seen[0]!.system).toContain('FAITHFULNESS-JUDGE');
    expect(seen[0]!.system).toContain('NOT present in the graph segment');
    expect(seen[0]!.responseFormat).toBe(judgeResponseFormat('en-you'));
    expect(seen[0]!.responseFormat!.description).toBe('Structured response in the given schema.');
    // German voices keep the original (description-less) format object.
    expect(judgeResponseFormat('formal-sie')).toBe(JUDGE_RESPONSE_FORMAT);
    expect(JUDGE_RESPONSE_FORMAT.description).toBeUndefined();
  });

  it('conservatively reports unparsable output as one violation with a raw snippet', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      complete: () => Promise.resolve({ text: 'Entschuldigung, ich kann kein JSON liefern.' }),
    };
    const result = await runFaithfulnessCheck(provider, segment, markdown, {
      maxTokens: 10,
      temperature: 0,
      voice: 'formal-sie',
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.claim).toBe('(judge response unparsable)');
    expect(result.violations[0]!.reason).toContain('Entschuldigung, ich kann kein JSON liefern.');
    expect(judgeParseFailed(result.violations)).toBe(true);
    expect('usage' in result).toBe(false);
  });

  it('flags empty responses as empty and truncates long raw responses', async () => {
    const emptyProvider: LlmProvider = { name: 'fake', complete: () => Promise.resolve({ text: '' }) };
    const empty = await runFaithfulnessCheck(emptyProvider, segment, markdown, { maxTokens: 1, temperature: 0, voice: 'formal-sie' });
    expect(empty.violations[0]!.reason).toContain('was empty');

    const longProvider: LlmProvider = {
      name: 'fake',
      complete: () => Promise.resolve({ text: 'x'.repeat(1000) }),
    };
    const long = await runFaithfulnessCheck(longProvider, segment, markdown, { maxTokens: 1, temperature: 0, voice: 'formal-sie' });
    expect(long.violations[0]!.reason.length).toBeLessThan(400);
  });
});

describe('judgeParseFailed', () => {
  it('is false for regular results', () => {
    expect(judgeParseFailed([])).toBe(false);
    expect(judgeParseFailed([{ claim: 'A', reason: 'B' }])).toBe(false);
  });
});
