import { describe, expect, it } from 'vitest';
import type { GraphSegment } from '../../src/contracts.js';
import {
  buildGenerationPrompt,
  buildJudgePrompt,
  JUDGE_MARKER,
  PROMPT_VERSION,
  serializeSegment,
} from '../../src/llm/prompts.js';

const segment: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung',
  order: 1,
  nodes: [{ id: 'login', type: 'screen', title: 'Login', source: 'derived' }],
  edges: [],
  exits: [],
};

describe('PROMPT_VERSION', () => {
  it('ist exportiert und gesetzt', () => {
    expect(PROMPT_VERSION).toBe('2');
  });
});

describe('serializeSegment', () => {
  it('serialisiert stabil mit sortierten Schlüsseln, unabhängig von der Einfügereihenfolge', () => {
    const reordered = {
      exits: [],
      edges: [],
      nodes: [{ source: 'derived', title: 'Login', type: 'screen', id: 'login' }],
      order: 1,
      title: 'Anmeldung',
      kind: 'flow',
      id: 'auth',
    } as unknown as GraphSegment;
    expect(serializeSegment(reordered)).toBe(serializeSegment(segment));
    const json = serializeSegment(segment);
    expect(json.indexOf('"edges"')).toBeLessThan(json.indexOf('"exits"'));
    expect(json.indexOf('"exits"')).toBeLessThan(json.indexOf('"id"'));
  });
});

describe('buildGenerationPrompt — System-Prompt (in den Prompt injizierter Styleguide)', () => {
  it('enthält die Kernregeln: nichts erfinden, Lücken kennzeichnen, kein Frontmatter/H1', () => {
    const { system } = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' });
    expect(system).toContain('Erfinde keine UI-Elemente');
    expect(system).toContain('Lücken');
    expect(system).toContain('kein YAML-Frontmatter');
    expect(system).toContain('keine H1-Überschrift');
    expect(system).toContain('Zielsprache: de');
    expect(system).toContain('Voraussetzungen zuerst');
  });

  it('setzt die Anrede je voice', () => {
    const sie = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' }).system;
    expect(sie).toContain('mit „Sie“ an');

    const du = buildGenerationPrompt(segment, { voice: 'informal-du', locale: 'de' }).system;
    expect(du).toContain('mit „du“ an');

    const en = buildGenerationPrompt(segment, { voice: 'en-you', locale: 'en' }).system;
    expect(en).toContain('Address the reader as "you".');
    expect(en).toContain('Never invent UI elements');
    expect(en).toContain('Mark gaps explicitly');
    expect(en).toContain('Target language: en');
  });

  it('erwähnt den App-Namen nur, wenn er übergeben wird', () => {
    const withName = buildGenerationPrompt(segment, {
      voice: 'formal-sie',
      locale: 'de',
      appName: 'MeineApp',
    }).system;
    expect(withName).toContain('MeineApp');
    const withoutName = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' }).system;
    expect(withoutName).not.toContain('MeineApp');
  });

  it('bettet das Segment als letzten ```json-Block in die User-Message ein (Few-Shot davor)', () => {
    const { messages } = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    const content = messages[0]!.content;
    const blocks = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)];
    // Few-Shot-Beispiel + echtes Segment.
    expect(blocks.length).toBe(2);
    expect(blocks.at(-1)![1]).toBe(serializeSegment(segment));
  });
});

describe('buildJudgePrompt', () => {
  it('enthält den Marker, die Prüf-Anweisung und das reine JSON-Antwortformat', () => {
    const { system, messages } = buildJudgePrompt(segment, '## Doku\n\nText.');
    expect(system).toContain(JUDGE_MARKER);
    expect(system).toContain('FAITHFULNESS-JUDGE');
    expect(system).toContain('NICHT im Graph-Segment');
    expect(system).toContain('{"violations":[{"quote":"…","element":"…","reason":"…"}]}');
    expect(system).toContain('maschinell verifiziert');
    expect(messages[0]!.content).toContain(serializeSegment(segment));
    expect(messages[0]!.content).toContain('## Doku');
  });
});
