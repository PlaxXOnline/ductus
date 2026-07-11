/**
 * Prompt-Bau für Generierung und Faithfulness-Judge: Graph-Segment als
 * strukturierte Daten + injizierter Styleguide + Few-Shot-Beispiel.
 *
 * Das Segment wird mit stabiler Serialisierung (sortierte Schlüssel) in den
 * Prompt eingebettet; derselbe String ist die Grundlage des Cache-Keys.
 */

import type { GraphSegment, LlmMessage, Voice } from '../contracts.js';

/** Bei jeder inhaltlichen Prompt-Änderung erhöhen — invalidiert den Cache. */
export const PROMPT_VERSION = '2';

/** Marker, an dem Provider (insb. mock) einen Judge-Aufruf erkennen. */
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

/** Stabile Serialisierung: identisches Segment ⇒ byte-gleicher String (NFR2). */
export function serializeSegment(segment: GraphSegment): string {
  return JSON.stringify(sortKeysDeep(segment), null, 2);
}

// ─────────── Few-Shot-Beispiel (minimaler Login→Dashboard-Auth-Flow) ─────────

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

// ───────────────────────── System-Prompt (Styleguide) ────────────────────────

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

// ───────────────────────── Öffentliche Prompt-Builder ────────────────────────

export function buildGenerationPrompt(
  segment: GraphSegment,
  opts: { voice: Voice; locale: string; appName?: string },
): PromptParts {
  const system = buildSystem(opts.voice, opts.locale, opts.appName);
  const en = opts.voice === 'en-you';
  // Das echte Segment ist bewusst der LETZTE ```json-Block der Nachricht.
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

export function buildJudgePrompt(segment: GraphSegment, markdown: string): PromptParts {
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
