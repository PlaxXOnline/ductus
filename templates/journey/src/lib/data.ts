/**
 * Build-time data access: astro.config.mjs reads ductus.data.json defensively
 * from the site root and embeds the content via Vite `define` as __DUCTUS_DATA__
 * (missing/broken file ⇒ null). The value is normalized here so the site stays
 * buildable even without data — just without journeys. During scaffolding,
 * Ductus writes the real file over the bundled demo file.
 */

import type { DuctusData } from './types';

declare const __DUCTUS_DATA__: Partial<DuctusData> | null;

const FALLBACK: DuctusData = {
  dataVersion: '1',
  site: { title: 'Documentation', locale: 'en', ductusVersion: '', adapters: [], violationsTotal: 0 },
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

/** Per the data contract, journeys are already sorted by order (tie-break: slug). */
export const data: DuctusData = normalize(typeof __DUCTUS_DATA__ === 'undefined' ? null : __DUCTUS_DATA__);

/** Most frequent edge labels across all journeys — “Frequently searched” chips (deterministic). */
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
