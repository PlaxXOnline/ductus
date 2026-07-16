import { describe, expect, it } from 'vitest';
import type { GraphSegment } from '../../src/contracts.js';
import { buildVocabulary, checkLexicon, normalizeTerm, termCoverage } from '../../src/llm/lexicon.js';

const segment: GraphSegment = {
  id: 'notes',
  kind: 'flow',
  title: 'Notizen verwalten',
  order: 1,
  nodes: [
    { id: 'note-list', type: 'screen', title: 'Notizliste', source: 'annotation' },
    { id: 'note-detail', type: 'screen', title: 'Notiz-Detail', source: 'annotation' },
    {
      id: 'save-check',
      type: 'decision',
      title: 'Eingaben gültig?',
      description: 'Beim Speichern wird geprüft, ob die Notiz einen Titel hat.',
      source: 'annotation',
    },
  ],
  edges: [
    { id: 'e1', from: 'note-list', to: 'note-detail', trigger: 'tap', label: 'Notiz öffnen', source: 'annotation' },
    {
      id: 'e2',
      from: 'save-check',
      to: 'note-list',
      trigger: 'auto',
      label: 'Fehlerhinweis anzeigen',
      condition: 'Titel fehlt',
      source: 'annotation',
    },
  ],
  exits: [],
};

describe('normalizeTerm', () => {
  it('strips Markdown markup and punctuation and collapses whitespace', () => {
    expect(normalizeTerm('**Notiz öffnen:**')).toBe('notiz öffnen');
    expect(normalizeTerm('  Titel\n fehlt. ')).toBe('titel fehlt');
    expect(normalizeTerm('„Eingaben gültig?“')).toBe('eingaben gültig');
  });
});

describe('termCoverage', () => {
  const vocab = buildVocabulary(segment, 'comment_demo');

  it('covers exact entries, single words and word combinations from the vocabulary', () => {
    expect(termCoverage('Notiz öffnen', vocab)).toBe('covered');
    expect(termCoverage('Notizliste', vocab)).toBe('covered');
    // Combination of vocabulary words from different entries (heading style).
    expect(termCoverage('Notizliste öffnen', vocab)).toBe('covered');
    // The app name counts towards the vocabulary.
    expect(termCoverage('comment_demo', vocab)).toBe('covered');
    // Structural words of the style guide are not graph elements.
    expect(termCoverage('Voraussetzung:', vocab)).toBe('covered');
  });

  it('classifies inflections and related compounds as near (prefix rules)', () => {
    // "Notizen" — vocabulary word "notiz" is a prefix ≥ 4 ⇒ covered.
    expect(termCoverage('Notizen', vocab)).toBe('covered');
    // "Fehlermeldung" vs. "Fehlerhinweis" — shared prefix "fehler" (6) ⇒ near.
    expect(termCoverage('Fehlermeldung', vocab)).toBe('near');
  });

  it('reports terms without any match as uncovered', () => {
    expect(termCoverage('Exportieren', vocab)).toBe('uncovered');
    expect(termCoverage('Dark Mode aktivieren', vocab)).toBe('uncovered');
  });
});

describe('checkLexicon', () => {
  it('checks only bold terms in step/bullet lines', () => {
    const markdown = [
      'Einleitung über **Frei erfundenes** bleibt ungeprüft (kein Schritt).',
      '',
      '## **Auch Headings** bleiben ungeprüft',
      '',
      '1. Tippen Sie auf **Notiz öffnen**.',
      '2. Tippen Sie auf **Exportieren**.',
      '- **Notizliste** — Startbildschirm.',
    ].join('\n');
    const result = checkLexicon(markdown, segment, { appName: 'comment_demo' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.claim).toBe('**Exportieren**');
    expect(result.violations[0]!.reason).toContain('deterministic vocabulary check');
  });

  it('reports lexically related terms as a hint, not a violation', () => {
    const markdown = '1. Es erscheint eine **Fehlermeldung**.';
    const result = checkLexicon(markdown, segment);
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.claim).toBe('**Fehlermeldung**');
  });

  it('deduplicates repeated terms and is empty without findings', () => {
    const clean = '1. Tippen Sie auf **Notiz öffnen**.\n2. Erneut **Notiz öffnen**.';
    expect(checkLexicon(clean, segment)).toEqual({ violations: [], hints: [] });
    const dupes = '1. **Exportieren**\n2. **Exportieren**';
    expect(checkLexicon(dupes, segment).violations).toHaveLength(1);
  });
});
