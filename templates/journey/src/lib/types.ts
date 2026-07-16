/**
 * Types of the ductus.data.json data contract (dataVersion "1").
 * The file is written deterministically into the site root by `scaffoldWebsite`
 * (mode generator="journey") (NFR2: stable sorting, LF, no timestamps).
 */

export interface DuctusData {
  dataVersion: string;
  site: SiteInfo;
  journeys: Journey[];
}

export interface SiteInfo {
  /** config.app.name */
  title: string;
  /** config.app.locale, e.g. "en" */
  locale: string;
  /** version of @ductus/core */
  ductusVersion: string;
  /** extract.adapterInfos, sorted by name */
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
  /** toSlug(segment.id) — URL segment */
  slug: string;
  kind: 'flow' | 'screen' | 'misc';
  order: number;
  title: string;
  description: string;
  /** flow.start (flows only) */
  startNodeId: string | null;
  /** sorted by id */
  nodes: JourneyNode[];
  /** sorted by id */
  edges: JourneyEdge[];
  /** node ids of the main path; empty when not a flow segment or path < 2 nodes */
  mainPath: string[];
  /** generated LLM markdown, plain (no Mermaid appendices, no aside) */
  markdown: string;
  violations: Violation[];
}

export interface JourneyNode {
  id: string;
  type: 'screen' | 'action' | 'decision';
  /** for type=action label ?? title ?? id, otherwise title ?? id */
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
  /** 0-based index of the main-path edge, otherwise null */
  main: number | null;
}

export interface Violation {
  claim: string;
  reason: string;
}

/** sourceRef as a mono line ("file:line" or "file · symbol"). */
export function formatSourceRef(ref: SourceRef | null): string | null {
  if (!ref) return null;
  let text = ref.file;
  if (ref.line !== undefined) text += `:${ref.line}`;
  if (ref.symbol !== undefined && ref.symbol !== '') text += ` · ${ref.symbol}`;
  return text;
}
