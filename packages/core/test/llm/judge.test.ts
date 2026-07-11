import { describe, expect, it } from 'vitest';
import type { GraphSegment, LlmProvider, LlmRequest } from '../../src/contracts.js';
import { judgeParseFailed, parseJudgeResponse, runFaithfulnessCheck } from '../../src/llm/judge.js';

const segment: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung',
  order: 1,
  nodes: [{ id: 'login', type: 'screen', title: 'Login', source: 'derived' }],
  edges: [],
  exits: [],
};

describe('parseJudgeResponse', () => {
  it('parst rohes JSON', () => {
    expect(
      parseJudgeResponse('{"violations":[{"claim":"X behauptet","reason":"nicht im Graph"}]}'),
    ).toEqual([{ claim: 'X behauptet', reason: 'nicht im Graph' }]);
    expect(parseJudgeResponse('{"violations": []}')).toEqual([]);
  });

  it('parst JSON in einem ```json-Fence', () => {
    const fenced = 'Hier das Ergebnis:\n```json\n{"violations":[{"claim":"A","reason":"B"}]}\n```\n';
    expect(parseJudgeResponse(fenced)).toEqual([{ claim: 'A', reason: 'B' }]);
  });

  it('parst JSON, das ohne Fence in Prosa eingebettet ist', () => {
    const prose =
      'Nach Prüfung des Textes: {"violations":[{"claim":"C","reason":"D"}]} — keine weiteren Auffälligkeiten.';
    expect(parseJudgeResponse(prose)).toEqual([{ claim: 'C', reason: 'D' }]);
    // Geschweifte Klammern in Strings dürfen die Balance nicht stören.
    const tricky = 'Ergebnis: {"violations":[{"claim":"Text mit } Klammer","reason":"R"}]}';
    expect(parseJudgeResponse(tricky)).toEqual([{ claim: 'Text mit } Klammer', reason: 'R' }]);
  });

  it('meldet Unparsebares konservativ als eine Violation', () => {
    for (const garbage of ['lorem ipsum', '{"foo": 1}', '{"violations": "kaputt"}', '']) {
      const violations = parseJudgeResponse(garbage);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.claim).toBe('(Judge-Antwort unparsebar)');
      expect(violations[0]!.reason.length).toBeGreaterThan(0);
      expect(judgeParseFailed(violations)).toBe(true);
    }
  });

  it('nimmt bei Parse-Fehlern ein Snippet der Roh-Antwort in die Begründung auf', () => {
    const violations = parseJudgeResponse('Entschuldigung, ich kann kein JSON liefern.');
    expect(violations[0]!.reason).toContain('Entschuldigung, ich kann kein JSON liefern.');
    // Lange Antworten werden gekürzt, damit der Report lesbar bleibt.
    const long = parseJudgeResponse('x'.repeat(1000));
    expect(long[0]!.reason.length).toBeLessThan(400);
    // Leere Antworten werden als solche benannt.
    expect(parseJudgeResponse('')[0]!.reason).toContain('leer');
  });

  it('judgeParseFailed ist für reguläre Ergebnisse false', () => {
    expect(judgeParseFailed([])).toBe(false);
    expect(judgeParseFailed([{ claim: 'A', reason: 'B' }])).toBe(false);
  });
});

describe('runFaithfulnessCheck', () => {
  it('ruft den Provider mit dem Judge-Prompt auf und liefert Violations plus usage', async () => {
    const seen: LlmRequest[] = [];
    const provider: LlmProvider = {
      name: 'fake',
      complete: (request) => {
        seen.push(request);
        return Promise.resolve({
          text: '{"violations":[{"claim":"A","reason":"B"}]}',
          usage: { inputTokens: 5, outputTokens: 2 },
        });
      },
    };
    const result = await runFaithfulnessCheck(provider, segment, '## Doku', {
      maxTokens: 123,
      temperature: 0.1,
    });

    expect(result.violations).toEqual([{ claim: 'A', reason: 'B' }]);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toContain('FAITHFULNESS-JUDGE');
    expect(seen[0]!.messages[0]!.content).toContain('## Doku');
    expect(seen[0]!.maxTokens).toBe(123);
    expect(seen[0]!.temperature).toBe(0.1);
  });

  it('lässt usage weg, wenn der Provider keins liefert', async () => {
    const provider: LlmProvider = {
      name: 'fake',
      complete: () => Promise.resolve({ text: '{"violations": []}' }),
    };
    const result = await runFaithfulnessCheck(provider, segment, 'Text', {
      maxTokens: 10,
      temperature: 0,
    });
    expect(result.violations).toEqual([]);
    expect('usage' in result).toBe(false);
  });
});
