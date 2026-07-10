/**
 * Zwischenstrukturen der manuellen Extraktion (Weg A), deren `from` ggf.
 * erst nach dem Scan ALLER Dateien aufgelöst wird.
 */

import type { GraphFlow, GraphNode, SourceRef } from './graph-model.js';

/** Eine @journey:action, deren `from` ggf. noch aufzulösen ist. */
export interface ActionCandidate {
  id?: string;
  label: string;
  to: string;
  from?: string;
  trigger: string;
  condition?: string;
  /** Name der umschließenden Komponente für die from-Inferenz. */
  enclosingName?: string;
  sourceRef: SourceRef;
}

/** Ergebnis der manuellen Extraktion einer Datei. */
export class ManualExtraction {
  readonly nodes: GraphNode[] = [];
  readonly flows: GraphFlow[] = [];
  readonly actions: ActionCandidate[] = [];
  /** Komponenten-Name → Screen-Id (für from-Inferenz und Nav-Zuordnung). */
  readonly screenSymbols = new Map<string, string>();
}
