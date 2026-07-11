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
  it('entfernt Markdown-Auszeichnung, Satzzeichen und kollabiert Whitespace', () => {
    expect(normalizeTerm('**Notiz öffnen:**')).toBe('notiz öffnen');
    expect(normalizeTerm('  Titel\n fehlt. ')).toBe('titel fehlt');
    expect(normalizeTerm('„Eingaben gültig?“')).toBe('eingaben gültig');
  });
});

describe('termCoverage', () => {
  const vocab = buildVocabulary(segment, 'comment_demo');

  it('deckt exakte Einträge, Einzelwörter und Wort-Kombinationen aus dem Vokabular', () => {
    expect(termCoverage('Notiz öffnen', vocab)).toBe('covered');
    expect(termCoverage('Notizliste', vocab)).toBe('covered');
    // Kombination aus Vokabelwörtern verschiedener Einträge (Heading-Stil).
    expect(termCoverage('Notizliste öffnen', vocab)).toBe('covered');
    // App-Name zählt zum Vokabular.
    expect(termCoverage('comment_demo', vocab)).toBe('covered');
    // Strukturwörter des Styleguides sind keine Graph-Elemente.
    expect(termCoverage('Voraussetzung:', vocab)).toBe('covered');
  });

  it('stuft Flexionen und verwandte Komposita als near ein (Präfix-Regeln)', () => {
    // "Notizen" — Vokabelwort "notiz" ist Präfix ≥ 4 ⇒ covered.
    expect(termCoverage('Notizen', vocab)).toBe('covered');
    // "Fehlermeldung" vs. "Fehlerhinweis" — gemeinsames Präfix "fehler" (6) ⇒ near.
    expect(termCoverage('Fehlermeldung', vocab)).toBe('near');
  });

  it('meldet Begriffe ohne jede Entsprechung als uncovered', () => {
    expect(termCoverage('Exportieren', vocab)).toBe('uncovered');
    expect(termCoverage('Dark Mode aktivieren', vocab)).toBe('uncovered');
  });
});

describe('checkLexicon', () => {
  it('prüft nur Bold-Terme in Schritt-/Aufzählungszeilen', () => {
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
    expect(result.violations[0]!.reason).toContain('Vokabular-Check');
  });

  it('meldet lexikalisch verwandte Terme als Hinweis, nicht als Verstoß', () => {
    const markdown = '1. Es erscheint eine **Fehlermeldung**.';
    const result = checkLexicon(markdown, segment);
    expect(result.violations).toEqual([]);
    expect(result.hints).toHaveLength(1);
    expect(result.hints[0]!.claim).toBe('**Fehlermeldung**');
  });

  it('dedupliziert wiederholte Terme und ist ohne Befund leer', () => {
    const clean = '1. Tippen Sie auf **Notiz öffnen**.\n2. Erneut **Notiz öffnen**.';
    expect(checkLexicon(clean, segment)).toEqual({ violations: [], hints: [] });
    const dupes = '1. **Exportieren**\n2. **Exportieren**';
    expect(checkLexicon(dupes, segment).violations).toHaveLength(1);
  });
});
