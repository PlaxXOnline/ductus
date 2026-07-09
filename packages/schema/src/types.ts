/**
 * TypeScript-Typen für das Ductus-Graph-Schema (SPEC §6).
 * Das Schema ist die einzige Vertragsfläche zwischen Adaptern und Core.
 */

export type NodeType = 'screen' | 'action' | 'decision';

export type TriggerType = 'tap' | 'submit' | 'auto' | 'back' | 'deeplink' | 'system';

export type SourceType = 'annotation' | 'derived';

/** Rückverweis in den Quellcode (§6.2). */
export interface SourceRef {
  file: string;
  line?: number;
  symbol?: string;
}

/** Screen-, Action- oder Decision-Node (§6.2). */
export interface JourneyNode {
  id: string;
  type: NodeType;
  /** Pflicht für screen/decision. */
  title?: string;
  /** Pflicht für action. */
  label?: string;
  flow?: string;
  description?: string;
  source: SourceType;
  sourceRef?: SourceRef;
  tags?: string[];
}

/** Gerichtete Transition zwischen Nodes (§6.3). */
export interface JourneyEdge {
  id: string;
  from: string;
  to: string;
  trigger?: TriggerType;
  label?: string;
  condition?: string;
  source: SourceType;
  sourceRef?: SourceRef;
}

/** Benannte Teilmenge des Graphen (§6.4). */
export interface JourneyFlow {
  id: string;
  title: string;
  /** Einstiegs-Node; muss existieren und vom Typ screen sein (V3). */
  start: string;
  description?: string;
}

export interface AppInfo {
  name: string;
  platforms?: string[];
  locale?: string;
}

export interface AdapterInfo {
  name: string;
  version: string;
}

export interface GraphMeta {
  /**
   * Optionaler Zeitstempel. Der Core schreibt ihn NICHT in journey-graph.json
   * (NFR2 Byte-Stabilität), sondern nur in ductus-report.json.
   */
  generatedAt?: string;
  adapters?: AdapterInfo[];
}

/** Top-Level-Dokument (§6.1). */
export interface JourneyGraph {
  schemaVersion: string;
  app?: AppInfo;
  flows: JourneyFlow[];
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  meta?: GraphMeta;
}
