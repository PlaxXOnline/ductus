/**
 * Prompt construction for generation and the faithfulness judge: graph segment
 * as structured data + injected style guide + few-shot example.
 *
 * The segment is embedded into the prompt with a stable serialization (sorted
 * keys); the same string is the basis of the cache key. The prompt texts and
 * few-shot examples themselves are product data in the target voice's language
 * — do not translate them.
 */

import type { GraphSegment, LlmMessage, Voice } from '../contracts.js';

/** Bump on every substantive prompt change — invalidates the cache. */
export const PROMPT_VERSION = '3';

/** Marker by which providers (esp. mock) recognize a judge call. */
export const JUDGE_MARKER = 'FAITHFULNESS-JUDGE';

export interface PromptParts {
  system: string;
  messages: LlmMessage[];
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

/** Stable serialization: identical segment ⇒ byte-identical string (NFR2). */
export function serializeSegment(segment: GraphSegment): string {
  return JSON.stringify(sortKeysDeep(segment), null, 2);
}

// ─────────── Few-shot example (minimal login→dashboard auth flow) ────────────

const EXAMPLE_SEGMENT: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung',
  order: 1,
  nodes: [
    { id: 'dashboard', type: 'screen', title: 'Dashboard', source: 'derived' },
    {
      id: 'login',
      type: 'screen',
      title: 'Login',
      description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
      source: 'derived',
    },
  ],
  edges: [
    {
      id: 'e_login_dashboard',
      from: 'login',
      to: 'dashboard',
      trigger: 'tap',
      label: 'Anmelden',
      condition: 'Zugangsdaten gültig',
      source: 'annotation',
    },
  ],
  exits: [],
};

const EXAMPLE_MARKDOWN: Record<Voice, string> = {
  'formal-sie': [
    'Dieser Abschnitt zeigt Ihnen, wie Sie sich anmelden.',
    '',
    '## Anmelden',
    '',
    '1. Öffnen Sie den Bildschirm **Login**.',
    '2. Tippen Sie auf **Anmelden**. Voraussetzung: Zugangsdaten gültig.',
    '3. Sie gelangen zum **Dashboard**.',
  ].join('\n'),
  'informal-du': [
    'Dieser Abschnitt zeigt dir, wie du dich anmeldest.',
    '',
    '## Anmelden',
    '',
    '1. Öffne den Bildschirm **Login**.',
    '2. Tippe auf **Anmelden**. Voraussetzung: Zugangsdaten gültig.',
    '3. Du gelangst zum **Dashboard**.',
  ].join('\n'),
  'en-you': [
    'This section shows you how to sign in.',
    '',
    '## Signing in',
    '',
    '1. Open the **Login** screen.',
    '2. Tap **Anmelden**. Prerequisite: Zugangsdaten gültig.',
    '3. You arrive at the **Dashboard**.',
  ].join('\n'),
};

// ───────────────────────── System prompt (style guide) ───────────────────────

function buildSystem(voice: Voice, locale: string, appName?: string): string {
  if (voice === 'en-you') {
    const lines = [
      'You are a technical writer producing end-user documentation from a user-journey graph segment.',
      ...(appName ? [`The app is called "${appName}".`] : []),
      `Target language: ${locale}.`,
      'Address the reader as "you".',
      'Write active, instructional prose: step-by-step instructions, prerequisites first.',
      'Never invent UI elements, steps or conditions that are not present as a node, edge or label in the segment.',
      'Mark gaps explicitly (e.g. "No further information is available.") instead of inventing content.',
      'Output ONLY the Markdown body: no YAML frontmatter, no H1 heading. Start with an introductory paragraph, then use ## sections.',
    ];
    return lines.join('\n');
  }
  const address =
    voice === 'formal-sie'
      ? 'Sprich die Leserinnen und Leser mit „Sie“ an.'
      : 'Sprich die Leserinnen und Leser mit „du“ an.';
  const lines = [
    'Du bist technischer Redakteur und erzeugst Endnutzer-Dokumentation aus einem User-Journey-Graph-Segment.',
    ...(appName ? [`Die App heißt „${appName}“.`] : []),
    `Zielsprache: ${locale}.`,
    address,
    'Schreibe aktiv und anleitend: Schritt-für-Schritt-Anleitungen, Voraussetzungen zuerst.',
    'Erfinde keine UI-Elemente, Schritte oder Bedingungen, die nicht als Node, Edge oder label im Segment stehen.',
    'Kennzeichne Lücken explizit (z. B. „Hierzu liegen keine weiteren Informationen vor.“), statt Inhalte zu erfinden.',
    'Gib NUR den Markdown-Body aus: kein YAML-Frontmatter, keine H1-Überschrift. Beginne mit einem Einleitungsabsatz, danach ##-Abschnitte.',
  ];
  return lines.join('\n');
}

// ───────────────────────── Public prompt builders ────────────────────────────

export function buildGenerationPrompt(
  segment: GraphSegment,
  opts: { voice: Voice; locale: string; appName?: string },
): PromptParts {
  const system = buildSystem(opts.voice, opts.locale, opts.appName);
  const en = opts.voice === 'en-you';
  // The real segment is deliberately the LAST ```json block of the message.
  const user = [
    en ? 'Example:' : 'Beispiel:',
    '',
    'Segment:',
    '```json',
    serializeSegment(EXAMPLE_SEGMENT),
    '```',
    '',
    en ? 'Expected output:' : 'Gewünschte Ausgabe:',
    '```markdown',
    EXAMPLE_MARKDOWN[opts.voice],
    '```',
    '',
    en
      ? 'Now write the documentation for this segment:'
      : 'Erzeuge nun die Dokumentation für dieses Segment:',
    '```json',
    serializeSegment(segment),
    '```',
  ].join('\n');
  return { system, messages: [{ role: 'user', content: user }] };
}

export function buildJudgePrompt(
  segment: GraphSegment,
  markdown: string,
  voice: Voice,
): PromptParts {
  // 'en-you' gets an English judge; the German voices keep the original prompt
  // byte-identical (German judge reasons flow into German asides and reports).
  if (voice === 'en-you') {
    const system = [
      `${JUDGE_MARKER}: You are checking generated end-user documentation against the underlying graph segment.`,
      'Check whether the text claims steps, conditions or UI elements that are NOT present in the graph segment.',
      'Respond ONLY with JSON of the form {"violations":[{"quote":"…","element":"…","reason":"…"}]}.',
      '"quote": verbatim, unaltered quote of the offending passage from the generated text.',
      '"element": the claimed UI element, step or condition that is missing from the graph segment.',
      '"reason": a short justification.',
      'Your findings are verified mechanically: a quote that does not appear verbatim in the text, or an element that does occur in the segment, is discarded.',
      'No violations ⇒ {"violations": []}. No further explanations, no Markdown.',
    ].join('\n');
    const user = [
      'Graph segment:',
      '```json',
      serializeSegment(segment),
      '```',
      '',
      'Generated text:',
      '```markdown',
      markdown,
      '```',
    ].join('\n');
    return { system, messages: [{ role: 'user', content: user }] };
  }
  const system = [
    `${JUDGE_MARKER}: Du prüfst generierte Endnutzer-Dokumentation gegen das zugrunde liegende Graph-Segment.`,
    'Prüfe, ob der Text Schritte, Bedingungen oder UI-Elemente behauptet, die NICHT im Graph-Segment stehen.',
    'Antworte AUSSCHLIESSLICH mit JSON der Form {"violations":[{"quote":"…","element":"…","reason":"…"}]}.',
    '"quote": wörtliches, unverändertes Zitat der beanstandeten Passage aus dem generierten Text.',
    '"element": das behauptete UI-Element, der Schritt oder die Bedingung, die im Graph-Segment fehlt.',
    '"reason": kurze Begründung.',
    'Deine Angaben werden maschinell verifiziert: Ein quote, das nicht wörtlich im Text steht, oder ein element, das doch im Segment vorkommt, wird verworfen.',
    'Keine Verstöße ⇒ {"violations": []}. Keine weiteren Erklärungen, kein Markdown.',
  ].join('\n');
  const user = [
    'Graph-Segment:',
    '```json',
    serializeSegment(segment),
    '```',
    '',
    'Generierter Text:',
    '```markdown',
    markdown,
    '```',
  ].join('\n');
  return { system, messages: [{ role: 'user', content: user }] };
}
