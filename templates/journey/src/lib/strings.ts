/**
 * Zentrale UI-Strings (de-Default; en, wenn site.locale mit "en" beginnt).
 * Die Strings werden ausschließlich zur Buildzeit aufgelöst — client-seitige
 * Skripte erhalten fertig übersetzte Texte über data-Attribute bzw. JSON-Inseln.
 */

export interface UiStrings {
  handbook: string;
  navOverview: string;
  navJourneys: string;
  searchButton: string;
  heroKicker: (appName: string) => string;
  heroTitle: string;
  heroSubtitle: string;
  heroSearchPlaceholder: string;
  frequentlySearched: string;
  journeysHeading: string;
  journeysDocumented: (n: number) => string;
  stations: string;
  steps: (n: number) => string;
  actions: (n: number) => string;
  openJourney: string;
  footerGenerated: string;
  footerAdapters: string;
  footerFaithfulness: (n: number) => string;
  journeyKicker: (nn: string) => string;
  playPath: string;
  warningsChip: (n: number) => string;
  graphTitle: string;
  graphHint: string;
  graphHintStacked: string;
  stepBadge: (i: number, n: number) => string;
  legendScreen: string;
  legendDecision: string;
  legendMainPath: string;
  mainPathHeading: (title: string) => string;
  furtherActionsHeading: string;
  elementsHeading: string;
  detailedGuideHeading: string;
  doneKicker: string;
  startPoint: string;
  typeLabel: (type: 'screen' | 'action' | 'decision') => string;
  decisionAuto: string;
  decisionIntro: string;
  actionHint: (trigger: string | null, label: string) => string;
  branchGoesTo: (label: string, target: string) => string;
  conditionPrefix: (condition: string) => string;
  actionCardDescription: (from: string, to: string, trigger: string | null, condition: string | null) => string;
  faithfulnessOk: string;
  faithfulnessOkMeta: string;
  faithfulnessWarn: (n: number) => string;
  faithfulnessWarnMeta: string;
  searchPlaceholder: string;
  searchEmpty: string;
  searchSelect: string;
  searchOpen: string;
  searchClose: string;
  searchIndexSummary: (journeys: number, steps: number, actions: number) => string;
  badgeJourney: string;
  badgeStep: string;
  badgeDecision: string;
  badgeAction: string;
  searchJourneySub: (steps: number, actions: number, start: string | null) => string;
  backToOverview: string;
}

/** Trigger-Vokabular (TriggerType aus @ductus/schema) → Handlungsaufforderung. */
function actionHintDe(trigger: string | null, label: string): string {
  const l = label !== '' ? label : null;
  switch (trigger) {
    case 'tap':
      return l ? `Tippen Sie auf „${l}“` : 'Tippen Sie';
    case 'submit':
      return l ? `Senden Sie „${l}“ ab` : 'Senden Sie ab';
    case 'auto':
      return l ? `Automatisch: ${l}` : 'Automatisch';
    case 'back':
      return l ? `Zurück-Geste: ${l}` : 'Zurück-Geste';
    case 'deeplink':
      return l ? `Über einen Link: ${l}` : 'Über einen Link';
    case 'system':
      return l ? `Systemereignis: ${l}` : 'Systemereignis';
    default:
      return l ?? '';
  }
}

function actionHintEn(trigger: string | null, label: string): string {
  const l = label !== '' ? label : null;
  switch (trigger) {
    case 'tap':
      return l ? `Tap “${l}”` : 'Tap';
    case 'submit':
      return l ? `Submit “${l}”` : 'Submit';
    case 'auto':
      return l ? `Automatic: ${l}` : 'Automatic';
    case 'back':
      return l ? `Back gesture: ${l}` : 'Back gesture';
    case 'deeplink':
      return l ? `Via link: ${l}` : 'Via link';
    case 'system':
      return l ? `System event: ${l}` : 'System event';
    default:
      return l ?? '';
  }
}

const de: UiStrings = {
  handbook: 'Handbuch',
  navOverview: 'Übersicht',
  navJourneys: 'Journeys',
  searchButton: 'Suchen',
  heroKicker: (appName) => `BENUTZERHANDBUCH · ${appName.toUpperCase()}`,
  heroTitle: 'Wie können wir helfen?',
  heroSubtitle: 'Jeder Weg durch die App, dokumentiert Schritt für Schritt — direkt aus dem Code erzeugt.',
  heroSearchPlaceholder: 'Schritte, Aktionen oder Journeys durchsuchen …',
  frequentlySearched: 'Häufig gesucht:',
  journeysHeading: 'Journeys',
  journeysDocumented: (n) => `${n} dokumentiert`,
  stations: 'STATIONEN',
  steps: (n) => `${n} ${n === 1 ? 'Schritt' : 'Schritte'}`,
  actions: (n) => `${n} ${n === 1 ? 'Aktion' : 'Aktionen'}`,
  openJourney: 'Journey öffnen →',
  footerGenerated: 'Automatisch generiert aus dem Quellcode',
  footerAdapters: 'Adapter',
  footerFaithfulness: (n) => `Faithfulness-Check: ${n} ${n === 1 ? 'Warnung' : 'Warnungen'}`,
  journeyKicker: (nn) => `JOURNEY ${nn}`,
  playPath: 'Pfad abspielen',
  warningsChip: (n) => `${n === 0 ? '✓ ' : ''}${n} ${n === 1 ? 'Warnung' : 'Warnungen'}`,
  graphTitle: 'ABLAUF — INTERAKTIV',
  graphHint: 'Knoten anklicken — rechts springt der passende Schritt auf.',
  graphHintStacked: 'Knoten antippen — unten springt der passende Schritt auf.',
  stepBadge: (i, n) => `SCHRITT ${i} / ${n}`,
  legendScreen: 'Screen',
  legendDecision: 'Entscheidung',
  legendMainPath: 'Hauptpfad',
  mainPathHeading: (title) => `HAUPTPFAD — ${title.toUpperCase()}`,
  furtherActionsHeading: 'WEITERE AKTIONEN',
  elementsHeading: 'BESTANDTEILE',
  detailedGuideHeading: 'Ausführliche Anleitung',
  doneKicker: 'GESCHAFFT',
  startPoint: 'STARTPUNKT',
  typeLabel: (type) => (type === 'decision' ? 'ENTSCHEIDUNG' : type === 'action' ? 'AKTION' : 'SCREEN'),
  decisionAuto: 'AUTOMATISCH',
  decisionIntro: 'Es gibt zwei Wege:',
  actionHint: actionHintDe,
  branchGoesTo: (label, target) => `${label} — weiter zu „${target}“.`,
  conditionPrefix: (condition) => `wenn ${condition}`,
  actionCardDescription: (from, to, trigger, condition) => {
    const hint = actionHintDe(trigger, '');
    const cond = condition ? ` — ${de.conditionPrefix(condition)}` : '';
    return `${hint !== '' ? `${hint}: ` : ''}führt von „${from}“ zu „${to}“${cond}.`;
  },
  faithfulnessOk:
    'Faithfulness-Judge: 0 ungedeckte Aussagen — jeder Satz dieser Seite ist durch den Journey-Graphen gedeckt.',
  faithfulnessOkMeta: 'ductus check · Exit 0',
  faithfulnessWarn: (n) =>
    `Faithfulness-Judge: ${n} ungedeckte ${n === 1 ? 'Aussage' : 'Aussagen'} — bitte Annotationen im Quellcode prüfen.`,
  faithfulnessWarnMeta: 'ductus check',
  searchPlaceholder: 'Schritte, Aktionen, Journeys …',
  searchEmpty: 'Keine Treffer. Versuchen Sie einen anderen Suchbegriff.',
  searchSelect: '↑↓ wählen',
  searchOpen: '↵ öffnen',
  searchClose: 'esc schließen',
  searchIndexSummary: (journeys, steps, actions) =>
    `Index: ${journeys} ${journeys === 1 ? 'Journey' : 'Journeys'} · ${steps} ${steps === 1 ? 'Schritt' : 'Schritte'} · ${actions} ${actions === 1 ? 'Aktion' : 'Aktionen'}`,
  badgeJourney: 'JOURNEY',
  badgeStep: 'SCHRITT',
  badgeDecision: 'ENTSCHEIDUNG',
  badgeAction: 'AKTION',
  searchJourneySub: (steps, actions, start) =>
    `Journey · ${de.steps(steps)} · ${de.actions(actions)}${start ? ` · Startpunkt: ${start}` : ''}`,
  backToOverview: 'Zurück zur Übersicht',
};

const en: UiStrings = {
  handbook: 'Handbook',
  navOverview: 'Overview',
  navJourneys: 'Journeys',
  searchButton: 'Search',
  heroKicker: (appName) => `USER HANDBOOK · ${appName.toUpperCase()}`,
  heroTitle: 'How can we help?',
  heroSubtitle: 'Every path through the app, documented step by step — generated straight from the code.',
  heroSearchPlaceholder: 'Search steps, actions or journeys …',
  frequentlySearched: 'Frequently searched:',
  journeysHeading: 'Journeys',
  journeysDocumented: (n) => `${n} documented`,
  stations: 'STATIONS',
  steps: (n) => `${n} ${n === 1 ? 'step' : 'steps'}`,
  actions: (n) => `${n} ${n === 1 ? 'action' : 'actions'}`,
  openJourney: 'Open journey →',
  footerGenerated: 'Automatically generated from the source code',
  footerAdapters: 'Adapters',
  footerFaithfulness: (n) => `Faithfulness check: ${n} ${n === 1 ? 'warning' : 'warnings'}`,
  journeyKicker: (nn) => `JOURNEY ${nn}`,
  playPath: 'Play path',
  warningsChip: (n) => `${n === 0 ? '✓ ' : ''}${n} ${n === 1 ? 'warning' : 'warnings'}`,
  graphTitle: 'FLOW — INTERACTIVE',
  graphHint: 'Click a node — the matching step lights up on the right.',
  graphHintStacked: 'Tap a node — the matching step lights up below.',
  stepBadge: (i, n) => `STEP ${i} / ${n}`,
  legendScreen: 'Screen',
  legendDecision: 'Decision',
  legendMainPath: 'Main path',
  mainPathHeading: (title) => `MAIN PATH — ${title.toUpperCase()}`,
  furtherActionsHeading: 'FURTHER ACTIONS',
  elementsHeading: 'ELEMENTS',
  detailedGuideHeading: 'Detailed guide',
  doneKicker: 'DONE',
  startPoint: 'START',
  typeLabel: (type) => (type === 'decision' ? 'DECISION' : type === 'action' ? 'ACTION' : 'SCREEN'),
  decisionAuto: 'AUTOMATIC',
  decisionIntro: 'There are two ways:',
  actionHint: actionHintEn,
  branchGoesTo: (label, target) => `${label} — continues to “${target}”.`,
  conditionPrefix: (condition) => `if ${condition}`,
  actionCardDescription: (from, to, trigger, condition) => {
    const hint = actionHintEn(trigger, '');
    const cond = condition ? ` — ${en.conditionPrefix(condition)}` : '';
    return `${hint !== '' ? `${hint}: ` : ''}leads from “${from}” to “${to}”${cond}.`;
  },
  faithfulnessOk:
    'Faithfulness judge: 0 uncovered claims — every sentence on this page is covered by the journey graph.',
  faithfulnessOkMeta: 'ductus check · exit 0',
  faithfulnessWarn: (n) =>
    `Faithfulness judge: ${n} uncovered ${n === 1 ? 'claim' : 'claims'} — please review the annotations in the source code.`,
  faithfulnessWarnMeta: 'ductus check',
  searchPlaceholder: 'Steps, actions, journeys …',
  searchEmpty: 'No results. Try a different search term.',
  searchSelect: '↑↓ select',
  searchOpen: '↵ open',
  searchClose: 'esc close',
  searchIndexSummary: (journeys, steps, actions) =>
    `Index: ${journeys} ${journeys === 1 ? 'journey' : 'journeys'} · ${steps} ${steps === 1 ? 'step' : 'steps'} · ${actions} ${actions === 1 ? 'action' : 'actions'}`,
  badgeJourney: 'JOURNEY',
  badgeStep: 'STEP',
  badgeDecision: 'DECISION',
  badgeAction: 'ACTION',
  searchJourneySub: (steps, actions, start) =>
    `Journey · ${en.steps(steps)} · ${en.actions(actions)}${start ? ` · start: ${start}` : ''}`,
  backToOverview: 'Back to overview',
};

export function uiStrings(locale: string): UiStrings {
  return locale.toLowerCase().startsWith('en') ? en : de;
}
