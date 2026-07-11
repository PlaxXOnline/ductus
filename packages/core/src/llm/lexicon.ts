/**
 * Deterministischer Vokabular-Check: Der Generierungs-Prompt verlangt, dass
 * UI-Elemente in Schrittzeilen fett (**…**) ausgezeichnet werden. Dieses Modul
 * extrahiert alle Bold-Terme aus Schritt-/Aufzählungszeilen und prüft sie ohne
 * LLM gegen das Vokabular des Graph-Segments — ein erfundenes UI-Element fällt
 * damit garantiert auf, unabhängig von der Zuverlässigkeit des Judge.
 *
 * Präzision vor Recall: gemeldet wird nur, was sicher ungedeckt ist; lexikalisch
 * grenzwertige Terme (z. B. Flexionsformen, verwandte Komposita) werden als
 * Hinweis geführt statt als Verstoß.
 */

import type { FaithfulnessViolation, GraphSegment } from '../contracts.js';

/** Strukturwörter des Styleguides (alle Voices), die kein Graph-Element benennen. */
const STRUCTURAL_TERMS = new Set([
  'voraussetzung',
  'voraussetzungen',
  'prerequisite',
  'prerequisites',
  'hinweis',
  'note',
]);

/** Volle Wort-Deckung: Vokabelwort ist Präfix des Terms (oder umgekehrt) ab dieser Länge. */
const MIN_AFFIX_CHARS = 4;
/** Lenient-Deckung („near“): gemeinsames Präfix ab dieser Länge, z. B. Fehler-Komposita. */
const MIN_COMMON_PREFIX_CHARS = 6;

/** Kleinschreibung, Markdown-Auszeichnung raus, Satzzeichen zu Leerraum, Whitespace kollabiert. */
export function normalizeTerm(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/[.,:;!?"'’„“”«»()\[\]{}…→—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toWords(normalized: string): string[] {
  return normalized.split(' ').filter((w) => w !== '');
}

export interface SegmentVocabulary {
  /** Normalisierte vollständige Einträge (Titel, Labels, Conditions, …). */
  entries: Set<string>;
  /** Alle Einzelwörter der Einträge. */
  words: Set<string>;
}

export function buildVocabulary(segment: GraphSegment, appName?: string): SegmentVocabulary {
  const raw: Array<string | undefined> = [segment.title, appName];
  if (segment.flow) raw.push(segment.flow.title, segment.flow.description);
  for (const node of segment.nodes) {
    raw.push(node.id, node.title, node.label, node.description);
  }
  for (const edge of segment.edges) {
    raw.push(edge.label, edge.condition, edge.trigger);
  }
  for (const exit of segment.exits) {
    raw.push(exit.toTitle, exit.edge.label, exit.edge.condition);
  }
  const entries = new Set<string>();
  const words = new Set<string>();
  for (const value of raw) {
    if (value === undefined || value === '') continue;
    const normalized = normalizeTerm(value);
    if (normalized === '') continue;
    entries.add(normalized);
    for (const word of toWords(normalized)) words.add(word);
  }
  return { entries, words };
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function wordCoverage(word: string, vocab: SegmentVocabulary): 'covered' | 'near' | 'uncovered' {
  if (vocab.words.has(word) || STRUCTURAL_TERMS.has(word)) return 'covered';
  let near = false;
  for (const vocabWord of vocab.words) {
    const affixLen = Math.min(word.length, vocabWord.length);
    if (affixLen >= MIN_AFFIX_CHARS && (word.startsWith(vocabWord) || vocabWord.startsWith(word))) {
      return 'covered';
    }
    if (commonPrefixLength(word, vocabWord) >= MIN_COMMON_PREFIX_CHARS) near = true;
  }
  return near ? 'near' : 'uncovered';
}

/**
 * Deckungsgrad eines Terms gegen das Segment-Vokabular:
 * 'covered'   — vollständig belegt (exakter Eintrag oder jedes Wort gedeckt),
 * 'near'      — lexikalisch verwandt (jedes Wort mindestens lenient gedeckt),
 * 'uncovered' — mindestens ein Wort ohne jede Entsprechung im Segment.
 */
export function termCoverage(term: string, vocab: SegmentVocabulary): 'covered' | 'near' | 'uncovered' {
  const normalized = normalizeTerm(term);
  if (normalized === '') return 'covered';
  if (vocab.entries.has(normalized) || STRUCTURAL_TERMS.has(normalized)) return 'covered';
  let sawNear = false;
  for (const word of toWords(normalized)) {
    const coverage = wordCoverage(word, vocab);
    if (coverage === 'uncovered') return 'uncovered';
    if (coverage === 'near') sawNear = true;
  }
  return sawNear ? 'near' : 'covered';
}

/** Schritt- oder Aufzählungszeile — nur dort verlangt der Styleguide Bold für UI-Elemente. */
const STEP_LINE = /^\s*(?:\d+\.|[-*+])\s/;
const BOLD_SPAN = /\*\*([^*\n]+?)\*\*/g;

export interface LexiconResult {
  /** Sicher ungedeckte Bold-Terme — deterministisch belegt, zählen gegen den Schwellwert. */
  violations: FaithfulnessViolation[];
  /** Lexikalisch nur verwandte Terme — zum manuellen Nachprüfen. */
  hints: FaithfulnessViolation[];
}

export function checkLexicon(
  markdown: string,
  segment: GraphSegment,
  opts: { appName?: string } = {},
): LexiconResult {
  const vocab = buildVocabulary(segment, opts.appName);
  const violations: FaithfulnessViolation[] = [];
  const hints: FaithfulnessViolation[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split('\n')) {
    if (!STEP_LINE.test(line)) continue;
    for (const match of line.matchAll(BOLD_SPAN)) {
      const term = match[1]!;
      const key = normalizeTerm(term);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      const coverage = termCoverage(term, vocab);
      if (coverage === 'uncovered') {
        violations.push({
          claim: `**${term}**`,
          reason:
            'Als UI-Element ausgezeichneter Begriff kommt in keinem Node, Edge, Label oder ' +
            'keiner Condition des Graph-Segments vor (deterministischer Vokabular-Check).',
        });
      } else if (coverage === 'near') {
        hints.push({
          claim: `**${term}**`,
          reason:
            'Begriff ist nur lexikalisch verwandt mit dem Graph-Vokabular (z. B. Flexion oder ' +
            'Kompositum) — bitte prüfen, ob er das gemeinte Graph-Element korrekt wiedergibt.',
        });
      }
    }
  }
  return { violations, hints };
}
