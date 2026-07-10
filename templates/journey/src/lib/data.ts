/**
 * Buildzeit-Datenzugriff: astro.config.mjs liest ductus.data.json defensiv aus
 * der Site-Wurzel und bettet den Inhalt per Vite-`define` als __DUCTUS_DATA__
 * ein (fehlende/kaputte Datei ⇒ null). Hier wird der Wert normalisiert, damit
 * die Site auch ohne Daten baubar bleibt — nur ohne Journeys. Beim Scaffolding
 * schreibt Ductus die echte Datei über die mitgelieferte Demo-Datei.
 */

import type { DuctusData } from './types';

declare const __DUCTUS_DATA__: Partial<DuctusData> | null;

const FALLBACK: DuctusData = {
  dataVersion: '1',
  site: { title: 'Dokumentation', locale: 'de', ductusVersion: '', adapters: [], violationsTotal: 0 },
  journeys: [],
};

function normalize(parsed: Partial<DuctusData> | null): DuctusData {
  if (parsed === null || typeof parsed !== 'object') return FALLBACK;
  return {
    dataVersion: parsed.dataVersion ?? FALLBACK.dataVersion,
    site: { ...FALLBACK.site, ...(parsed.site ?? {}) },
    journeys: Array.isArray(parsed.journeys) ? parsed.journeys : [],
  };
}

/** Journeys sind laut Datenvertrag bereits nach order (Tie-Break slug) sortiert. */
export const data: DuctusData = normalize(typeof __DUCTUS_DATA__ === 'undefined' ? null : __DUCTUS_DATA__);

/** Häufigste Kanten-Labels über alle Journeys — Chips „Häufig gesucht“ (deterministisch). */
export function frequentEdgeLabels(source: DuctusData, max = 3): string[] {
  const counts = new Map<string, number>();
  for (const journey of source.journeys) {
    for (const edge of journey.edges) {
      if (edge.label === '') continue;
      counts.set(edge.label, (counts.get(edge.label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, max)
    .map(([label]) => label);
}
