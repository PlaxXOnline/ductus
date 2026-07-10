/**
 * Suchindex für das ⌘K-Overlay: zur Buildzeit aus den Journeys erzeugt und als
 * JSON in die Seite eingebettet; das Filtern (Substring) läuft client-seitig.
 */

import type { DuctusData } from './types';
import type { UiStrings } from './strings';

/** Badge-Kategorien: J = Journey, S = Schritt, E = Entscheidung, A = Aktion. */
export type SearchKind = 'J' | 'S' | 'E' | 'A';

export interface SearchItem {
  /** Badge-Text (JOURNEY/SCHRITT/ENTSCHEIDUNG/AKTION, lokalisiert) */
  t: string;
  k: SearchKind;
  title: string;
  sub: string;
  /** Ziel-URL (relativ zur Site-Basis) */
  href: string;
}

export interface SearchIndex {
  items: SearchItem[];
  summary: string;
}

export function buildSearchIndex(data: DuctusData, t: UiStrings, base: string): SearchIndex {
  const items: SearchItem[] = [];
  let nodeCount = 0;
  let edgeCount = 0;

  for (const journey of data.journeys) {
    const journeyHref = `${base}journeys/${journey.slug}/`;
    const startTitle =
      journey.startNodeId !== null
        ? (journey.nodes.find((n) => n.id === journey.startNodeId)?.title ?? null)
        : null;
    items.push({
      t: t.badgeJourney,
      k: 'J',
      title: journey.title,
      sub: t.searchJourneySub(journey.nodes.length, journey.edges.length, startTitle),
      href: journeyHref,
    });
    for (const node of journey.nodes) {
      nodeCount += 1;
      items.push({
        t: node.type === 'decision' ? t.badgeDecision : t.badgeStep,
        k: node.type === 'decision' ? 'E' : 'S',
        title: node.title,
        sub: node.description !== '' ? node.description : journey.title,
        href: `${journeyHref}#node-${node.id}`,
      });
    }
    for (const edge of journey.edges) {
      edgeCount += 1;
      const fromTitle = journey.nodes.find((n) => n.id === edge.from)?.title ?? edge.from;
      const toTitle = journey.nodes.find((n) => n.id === edge.to)?.title ?? edge.to;
      const parts = [`${fromTitle} → ${toTitle}`];
      if (edge.condition !== null && edge.condition !== '') parts.push(t.conditionPrefix(edge.condition));
      const hint = t.actionHint(edge.trigger, '');
      if (hint !== '') parts.push(hint);
      items.push({
        t: t.badgeAction,
        k: 'A',
        title: edge.label !== '' ? edge.label : `${fromTitle} → ${toTitle}`,
        sub: parts.join(' · '),
        href: `${journeyHref}#node-${edge.from}`,
      });
    }
  }

  return {
    items,
    summary: t.searchIndexSummary(data.journeys.length, nodeCount, edgeCount),
  };
}
