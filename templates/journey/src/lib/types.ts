/**
 * Typen des Datenvertrags ductus.data.json (dataVersion "1").
 * Die Datei wird von `scaffoldWebsite` (Modus generator="journey") deterministisch
 * in die Site-Wurzel geschrieben (NFR2: stabile Sortierung, LF, keine Zeitstempel).
 */

export interface DuctusData {
  dataVersion: string;
  site: SiteInfo;
  journeys: Journey[];
}

export interface SiteInfo {
  /** config.app.name */
  title: string;
  /** config.app.locale, z. B. "de" */
  locale: string;
  /** Version von @ductus/core */
  ductusVersion: string;
  /** extract.adapterInfos, nach name sortiert */
  adapters: AdapterInfo[];
  violationsTotal: number;
}

export interface AdapterInfo {
  name: string;
  version: string;
}

export interface Journey {
  /** segment.id */
  id: string;
  /** toSlug(segment.id) — URL-Segment */
  slug: string;
  kind: 'flow' | 'screen' | 'misc';
  order: number;
  title: string;
  description: string;
  /** flow.start (nur flows) */
  startNodeId: string | null;
  /** nach id sortiert */
  nodes: JourneyNode[];
  /** nach id sortiert */
  edges: JourneyEdge[];
  /** Node-IDs des Hauptpfads; leer wenn kein flow-Segment oder Pfad < 2 Nodes */
  mainPath: string[];
  /** generiertes LLM-Markdown pur (ohne Mermaid-Anhänge, ohne Aside) */
  markdown: string;
  violations: Violation[];
}

export interface JourneyNode {
  id: string;
  type: 'screen' | 'action' | 'decision';
  /** für type=action label ?? title ?? id, sonst title ?? id */
  title: string;
  description: string;
  start: boolean;
  sourceRef: SourceRef | null;
}

export interface SourceRef {
  file: string;
  line?: number;
  symbol?: string;
}

export interface JourneyEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  trigger: string | null;
  condition: string | null;
  /** 0-basierter Index der Hauptpfad-Kante, sonst null */
  main: number | null;
}

export interface Violation {
  claim: string;
  reason: string;
}

/** sourceRef als Mono-Zeile ("file:line" bzw. "file · symbol"). */
export function formatSourceRef(ref: SourceRef | null): string | null {
  if (!ref) return null;
  let text = ref.file;
  if (ref.line !== undefined) text += `:${ref.line}`;
  if (ref.symbol !== undefined && ref.symbol !== '') text += ` · ${ref.symbol}`;
  return text;
}
