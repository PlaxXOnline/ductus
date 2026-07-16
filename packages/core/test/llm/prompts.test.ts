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
  it('is exported and set', () => {
    // '3': voice-dependent judge prompt (en-you gets an English judge); the
    // cache key does not hash prompt text, so the version carries the change.
    expect(PROMPT_VERSION).toBe('3');
  });
});

describe('serializeSegment', () => {
  it('serializes stably with sorted keys, regardless of insertion order', () => {
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

describe('buildGenerationPrompt — system prompt (style guide injected into the prompt)', () => {
  it('contains the core rules: invent nothing, mark gaps, no frontmatter/H1', () => {
    const { system } = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' });
    expect(system).toContain('Erfinde keine UI-Elemente');
    expect(system).toContain('Lücken');
    expect(system).toContain('kein YAML-Frontmatter');
    expect(system).toContain('keine H1-Überschrift');
    expect(system).toContain('Zielsprache: de');
    expect(system).toContain('Voraussetzungen zuerst');
  });

  it('sets the form of address per voice', () => {
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

  it('mentions the app name only when it is provided', () => {
    const withName = buildGenerationPrompt(segment, {
      voice: 'formal-sie',
      locale: 'de',
      appName: 'MeineApp',
    }).system;
    expect(withName).toContain('MeineApp');
    const withoutName = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' }).system;
    expect(withoutName).not.toContain('MeineApp');
  });

  it('embeds the segment as the last ```json block in the user message (few-shot before it)', () => {
    const { messages } = buildGenerationPrompt(segment, { voice: 'formal-sie', locale: 'de' });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    const content = messages[0]!.content;
    const blocks = [...content.matchAll(/```json\n([\s\S]*?)\n```/g)];
    // Few-shot example + the real segment.
    expect(blocks.length).toBe(2);
    expect(blocks.at(-1)![1]).toBe(serializeSegment(segment));
  });
});

describe('buildJudgePrompt', () => {
  it('contains the marker, the check instruction and the pure-JSON response format', () => {
    const { system, messages } = buildJudgePrompt(segment, '## Doku\n\nText.', 'formal-sie');
    expect(system).toContain(JUDGE_MARKER);
    expect(system).toContain('FAITHFULNESS-JUDGE');
    expect(system).toContain('NICHT im Graph-Segment');
    expect(system).toContain('{"violations":[{"quote":"…","element":"…","reason":"…"}]}');
    expect(system).toContain('maschinell verifiziert');
    expect(messages[0]!.content).toContain(serializeSegment(segment));
    expect(messages[0]!.content).toContain('## Doku');
  });

  // Regression guard: the German judge prompt must stay byte-identical for the
  // German voices (cache-friendly for existing German projects).
  it('keeps the original German judge prompt byte-identical for German voices', () => {
    const expectedSystem = [
      'FAITHFULNESS-JUDGE: Du prüfst generierte Endnutzer-Dokumentation gegen das zugrunde liegende Graph-Segment.',
      'Prüfe, ob der Text Schritte, Bedingungen oder UI-Elemente behauptet, die NICHT im Graph-Segment stehen.',
      'Antworte AUSSCHLIESSLICH mit JSON der Form {"violations":[{"quote":"…","element":"…","reason":"…"}]}.',
      '"quote": wörtliches, unverändertes Zitat der beanstandeten Passage aus dem generierten Text.',
      '"element": das behauptete UI-Element, der Schritt oder die Bedingung, die im Graph-Segment fehlt.',
      '"reason": kurze Begründung.',
      'Deine Angaben werden maschinell verifiziert: Ein quote, das nicht wörtlich im Text steht, oder ein element, das doch im Segment vorkommt, wird verworfen.',
      'Keine Verstöße ⇒ {"violations": []}. Keine weiteren Erklärungen, kein Markdown.',
    ].join('\n');
    for (const voice of ['formal-sie', 'informal-du'] as const) {
      const { system, messages } = buildJudgePrompt(segment, 'Text.', voice);
      expect(system).toBe(expectedSystem);
      expect(messages[0]!.content).toContain('Graph-Segment:');
      expect(messages[0]!.content).toContain('Generierter Text:');
    }
  });

  it('produces an English judge prompt for "en-you" (marker retained)', () => {
    const { system, messages } = buildJudgePrompt(segment, '## Docs\n\nText.', 'en-you');
    expect(system).toContain(JUDGE_MARKER);
    expect(system).toContain('NOT present in the graph segment');
    expect(system).toContain('{"violations":[{"quote":"…","element":"…","reason":"…"}]}');
    expect(system).toContain('verified mechanically');
    expect(system).not.toContain('Du prüfst');
    expect(messages[0]!.content).toContain('Graph segment:');
    expect(messages[0]!.content).toContain('Generated text:');
    expect(messages[0]!.content).toContain(serializeSegment(segment));
  });
});
