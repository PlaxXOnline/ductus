/**
 * Intermediate structures of the manual extraction (path A) whose `from`
 * may only be resolved after ALL files have been scanned.
 */

import type { GraphFlow, GraphNode, SourceRef } from './graph-model.js';

/** A @journey:action whose `from` may still need to be resolved. */
export interface ActionCandidate {
  id?: string;
  label: string;
  to: string;
  from?: string;
  trigger: string;
  condition?: string;
  /** Name of the enclosing component for `from` inference. */
  enclosingName?: string;
  sourceRef: SourceRef;
}

/** Result of the manual extraction of a single file. */
export class ManualExtraction {
  readonly nodes: GraphNode[] = [];
  readonly flows: GraphFlow[] = [];
  readonly actions: ActionCandidate[] = [];
  /** Component name → screen id (for `from` inference and nav mapping). */
  readonly screenSymbols = new Map<string, string>();
}
