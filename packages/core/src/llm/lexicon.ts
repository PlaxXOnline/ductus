/**
 * Deterministic vocabulary check: the generation prompt requires UI elements
 * in step lines to be marked bold (**…**). This module extracts all bold terms
 * from step/bullet lines and checks them against the graph segment's vocabulary
 * without an LLM — an invented UI element is thus guaranteed to be caught,
 * regardless of how reliable the judge is.
 *
 * Precision over recall: only what is certainly uncovered gets reported;
 * lexically borderline terms (e.g. inflected forms, related compounds) are
 * kept as hints instead of violations.
 */

import type { FaithfulnessViolation, GraphSegment } from '../contracts.js';

/** Structural words of the style guide (all voices) that do not name a graph element. */
const STRUCTURAL_TERMS = new Set([
  'voraussetzung',
  'voraussetzungen',
  'prerequisite',
  'prerequisites',
  'hinweis',
  'note',
]);

/** Full word coverage: vocabulary word is a prefix of the term (or vice versa) from this length. */
const MIN_AFFIX_CHARS = 4;
/** Lenient (“near”) coverage: shared prefix from this length, e.g. related compounds. */
const MIN_COMMON_PREFIX_CHARS = 6;

/** Lowercases, strips Markdown markup, turns punctuation into spaces, collapses whitespace. */
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
  /** Normalized full entries (titles, labels, conditions, …). */
  entries: Set<string>;
  /** All individual words of the entries. */
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
 * Coverage of a term against the segment vocabulary:
 * 'covered'   — fully backed (exact entry or every word covered),
 * 'near'      — lexically related (every word covered at least leniently),
 * 'uncovered' — at least one word without any match in the segment.
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

/** Step or bullet line — only there does the style guide require bold for UI elements. */
const STEP_LINE = /^\s*(?:\d+\.|[-*+])\s/;
// Content may contain single asterisks (italic inside bold, e.g. **Tap *Edit note***) —
// only a `**` run closes the span. A naive [^*]+ would close at the wrong delimiter of a
// nested ***…*** and report the prose BETWEEN two real spans as a bold term.
const BOLD_SPAN = /\*\*((?:[^*\n]|\*(?!\*))+?)\*\*/g;

export interface LexiconResult {
  /** Certainly uncovered bold terms — deterministically proven, count against the threshold. */
  violations: FaithfulnessViolation[];
  /** Only lexically related terms — for manual review. */
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
            'Term marked as a UI element does not appear in any node, edge, label or ' +
            'condition of the graph segment (deterministic vocabulary check).',
        });
      } else if (coverage === 'near') {
        hints.push({
          claim: `**${term}**`,
          reason:
            'Term is only lexically related to the graph vocabulary (e.g. an inflection or ' +
            'compound) — please check that it accurately reflects the intended graph element.',
        });
      }
    }
  }
  return { violations, hints };
}
