import { describe, expect, it } from 'vitest';
import type { GraphSegment, LlmProvider, LlmRequest } from '../../src/contracts.js';
import {
  JUDGE_RESPONSE_FORMAT,
  judgeParseFailed,
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
  it('parst rohes JSON', () => {
    expect(parseJudgeFindings('{"violations":[{"quote":"X","element":"Y","reason":"Z"}]}')).toEqual([
      { quote: 'X', element: 'Y', reason: 'Z' },
    ]);
    expect(parseJudgeFindings('{"violations": []}')).toEqual([]);
  });

  it('parst JSON in einem ```json-Fence', () => {
    const fenced = 'Hier das Ergebnis:\n```json\n{"violations":[{"quote":"A","element":"B","reason":"C"}]}\n```\n';
    expect(parseJudgeFindings(fenced)).toEqual([{ quote: 'A', element: 'B', reason: 'C' }]);
  });

  it('parst JSON, das ohne Fence in Prosa eingebettet ist', () => {
    const prose = 'Nach Prüfung: {"violations":[{"quote":"C","element":"D","reason":"E"}]} — fertig.';
    expect(parseJudgeFindings(prose)).toEqual([{ quote: 'C', element: 'D', reason: 'E' }]);
    // Geschweifte Klammern in Strings dürfen die Balance nicht stören.
    const tricky = 'Ergebnis: {"violations":[{"quote":"mit } Klammer","element":"X","reason":"R"}]}';
    expect(parseJudgeFindings(tricky)).toEqual([{ quote: 'mit } Klammer', element: 'X', reason: 'R' }]);
  });

  it('liefert undefined für Unparsebares', () => {
    for (const garbage of ['lorem ipsum', '{"foo": 1}', '{"violations": "kaputt"}', '']) {
      expect(parseJudgeFindings(garbage)).toBeUndefined();
    }
  });
});

describe('verifyJudgeFindings', () => {
  it('bestätigt ein Finding nur, wenn das Zitat im Text steht UND das Element im Segment fehlt', () => {
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

  it('verwirft ein Finding, dessen angeblich fehlendes Element im Segment steht', () => {
    const result = verifyJudgeFindings(
      [{ quote: 'Tippen Sie auf **Anmelden**', element: 'Anmelden', reason: 'angeblich erfunden' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toEqual([]);
    expect(result.refuted).toBe(1);
  });

  it('verwirft ein Finding, dessen Zitat nicht im Text vorkommt', () => {
    const result = verifyJudgeFindings(
      [{ quote: 'Dieser Satz existiert nirgendwo', element: 'Exportieren', reason: 'x' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.refuted).toBe(1);
  });

  it('stuft Findings ohne Zitat/Element als unverifizierbaren Hinweis ein', () => {
    const result = verifyJudgeFindings(
      [{ claim: 'Altformat-Behauptung', reason: 'alte Judge-Antwort' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.claim).toBe('Altformat-Behauptung');
    expect(result.hints[0]!.reason).toContain('Unverifizierbar');
  });

  it('stuft lexikalisch nur verwandte Elemente als Hinweis ein', () => {
    // "Anmeldung" (Flexion von "Anmelden") — gemeinsames Präfix ≥ 6, aber kein voller Treffer …
    // hier über den Segment-Titel gedeckt, daher ein erfundenes verwandtes Kompositum nutzen:
    const result = verifyJudgeFindings(
      [{ quote: 'Tippen Sie auf **Anmelden**', element: 'Anmeldeformular', reason: 'r' }],
      markdown,
      segment,
    );
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.reason).toContain('lexikalisch verwandt');
  });
});

describe('runFaithfulnessCheck', () => {
  it('ruft den Provider mit Judge-Prompt + responseFormat auf und verifiziert die Findings', async () => {
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

  it('meldet Unparsebares konservativ als eine Violation mit Roh-Snippet', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      complete: () => Promise.resolve({ text: 'Entschuldigung, ich kann kein JSON liefern.' }),
    };
    const result = await runFaithfulnessCheck(provider, segment, markdown, {
      maxTokens: 10,
      temperature: 0,
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.claim).toBe('(Judge-Antwort unparsebar)');
    expect(result.violations[0]!.reason).toContain('Entschuldigung, ich kann kein JSON liefern.');
    expect(judgeParseFailed(result.violations)).toBe(true);
    expect('usage' in result).toBe(false);
  });

  it('kennzeichnet leere Antworten als leer und kürzt lange Roh-Antworten', async () => {
    const emptyProvider: LlmProvider = { name: 'fake', complete: () => Promise.resolve({ text: '' }) };
    const empty = await runFaithfulnessCheck(emptyProvider, segment, markdown, { maxTokens: 1, temperature: 0 });
    expect(empty.violations[0]!.reason).toContain('leer');

    const longProvider: LlmProvider = {
      name: 'fake',
      complete: () => Promise.resolve({ text: 'x'.repeat(1000) }),
    };
    const long = await runFaithfulnessCheck(longProvider, segment, markdown, { maxTokens: 1, temperature: 0 });
    expect(long.violations[0]!.reason.length).toBeLessThan(400);
  });
});

describe('judgeParseFailed', () => {
  it('ist für reguläre Ergebnisse false', () => {
    expect(judgeParseFailed([])).toBe(false);
    expect(judgeParseFailed([{ claim: 'A', reason: 'B' }])).toBe(false);
  });
});
