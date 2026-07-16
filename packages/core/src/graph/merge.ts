/**
 * Merge of multiple adapter graphs into one graph (SPEC §5.4, DD §D).
 *
 * Precedence: annotation overrides derived per field. Two manual sources
 * with different values for the same field ⇒ fail fast with a MergeError
 * carrying ALL collected conflicts (no silent ambiguity).
 */

import type {
  AdapterInfo,
  AppInfo,
  JourneyEdge,
  JourneyFlow,
  JourneyGraph,
  JourneyNode,
  SourceRef,
} from '@ductus/schema';
import { SCHEMA_VERSION } from '@ductus/schema';
import type { MergeConflict, MergeConflictSide } from '../contracts.js';
import { compareStrings } from './canonical-json.js';

// ─────────────────────────────── MergeError ─────────────────────────────────

function formatSide(side: MergeConflictSide): string {
  const value = JSON.stringify(side.value);
  if (side.sourceRef !== undefined) {
    const line = side.sourceRef.line !== undefined ? `:${side.sourceRef.line}` : '';
    return `${value} (${side.sourceRef.file}${line})`;
  }
  if (side.adapter !== undefined) {
    return `${value} (adapter "${side.adapter}")`;
  }
  return `${value} (unknown source)`;
}

function formatConflict(conflict: MergeConflict): string {
  return (
    `${conflict.kind} "${conflict.id}", field "${conflict.field}": ` +
    `${formatSide(conflict.a)} vs. ${formatSide(conflict.b)}`
  );
}

/** Fail-fast error for contradictory manual sources (§5.4, DD §D). */
export class MergeError extends Error {
  readonly conflicts: MergeConflict[];

  constructor(conflicts: MergeConflict[]) {
    const lines = conflicts.map((c) => `  - ${formatConflict(c)}`);
    super(
      `Merge conflict: ${conflicts.length} contradictory manual value(s):\n${lines.join('\n')}`,
    );
    this.name = 'MergeError';
    this.conflicts = conflicts;
  }
}

// ─────────────────────────────── Helpers ────────────────────────────────────

/** Structural equality (sufficient for scalar fields and tags arrays). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object).sort(compareStrings);
    const keysB = Object.keys(b as object).sort(compareStrings);
    return (
      deepEqual(keysA, keysB) &&
      keysA.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/** One occurrence of an entity in one of the input graphs. */
interface Occurrence<T> {
  item: T;
  /** Adapter names of the originating graph (context for conflicts without a sourceRef). */
  adapter?: string;
}

/** Groups occurrences by id — the order of first appearance is preserved. */
function groupById<T extends { id: string }>(occurrences: Occurrence<T>[]): Map<string, Occurrence<T>[]> {
  const groups = new Map<string, Occurrence<T>[]>();
  for (const occ of occurrences) {
    const group = groups.get(occ.item.id);
    if (group) {
      group.push(occ);
    } else {
      groups.set(occ.item.id, [occ]);
    }
  }
  return groups;
}

function conflictSide<T extends { sourceRef?: SourceRef }>(
  occ: Occurrence<T>,
  value: unknown,
): MergeConflictSide {
  return {
    value,
    ...(occ.item.sourceRef !== undefined ? { sourceRef: occ.item.sourceRef } : {}),
    ...(occ.adapter !== undefined ? { adapter: occ.adapter } : {}),
  };
}

interface Sourced {
  id: string;
  source: 'annotation' | 'derived';
  sourceRef?: SourceRef;
}

/**
 * Field-wise merge of a group sharing one id (DD §D):
 * annotation > derived per field; annotation/annotation with unequal values ⇒
 * conflict (collected); derived/derived: the first one wins (fills gaps).
 */
function mergeSourcedGroup<T extends Sourced>(
  kind: 'node' | 'edge',
  group: Occurrence<T>[],
  fields: readonly string[],
  conflicts: MergeConflict[],
): T {
  const annotations = group.filter((occ) => occ.item.source === 'annotation');
  const deriveds = group.filter((occ) => occ.item.source === 'derived');
  // The highest-precedence source determines the result's source/sourceRef.
  const winner = annotations[0] ?? deriveds[0] ?? group[0];
  if (!winner) throw new Error('empty merge group'); // unreachable

  const merged: Record<string, unknown> = {
    id: winner.item.id,
    source: winner.item.source,
    ...(winner.item.sourceRef !== undefined ? { sourceRef: { ...winner.item.sourceRef } } : {}),
  };

  for (const field of fields) {
    const annSetters = annotations.filter(
      (occ) => (occ.item as Record<string, unknown>)[field] !== undefined,
    );
    if (annSetters.length > 0) {
      const first = annSetters[0]!;
      const firstValue = (first.item as Record<string, unknown>)[field];
      for (const other of annSetters.slice(1)) {
        const otherValue = (other.item as Record<string, unknown>)[field];
        if (!deepEqual(firstValue, otherValue)) {
          conflicts.push({
            kind,
            id: winner.item.id,
            field,
            a: conflictSide(first, firstValue),
            b: conflictSide(other, otherValue),
          });
        }
      }
      merged[field] = firstValue;
      continue;
    }
    // Only derived sources: the first set value wins, no error.
    const derivedSetter = deriveds.find(
      (occ) => (occ.item as Record<string, unknown>)[field] !== undefined,
    );
    if (derivedSetter) {
      merged[field] = (derivedSetter.item as Record<string, unknown>)[field];
    }
  }

  return merged as unknown as T;
}

/** Flows carry no source ⇒ all occurrences count as equally-ranked manual. */
function mergeFlowGroup(group: Occurrence<JourneyFlow>[], conflicts: MergeConflict[]): JourneyFlow {
  const first = group[0]!;
  const merged: Record<string, unknown> = { id: first.item.id };

  for (const field of ['title', 'start', 'description'] as const) {
    const setters = group.filter((occ) => occ.item[field] !== undefined);
    const winner = setters[0];
    if (!winner) continue;
    for (const other of setters.slice(1)) {
      if (!deepEqual(winner.item[field], other.item[field])) {
        conflicts.push({
          kind: 'flow',
          id: first.item.id,
          field,
          a: { value: winner.item[field], ...(winner.adapter !== undefined ? { adapter: winner.adapter } : {}) },
          b: { value: other.item[field], ...(other.adapter !== undefined ? { adapter: other.adapter } : {}) },
        });
      }
    }
    merged[field] = winner.item[field];
  }

  return merged as unknown as JourneyFlow;
}

// ─────────────────────────────── mergeGraphs ────────────────────────────────

const NODE_FIELDS = ['type', 'title', 'label', 'flow', 'description', 'tags'] as const;
const EDGE_FIELDS = ['from', 'to', 'trigger', 'label', 'condition'] as const;
/** Fields an annotation edge inherits from a displaced derived edge. */
const EDGE_INHERIT_FIELDS = ['trigger', 'label', 'condition'] as const;

function collectOccurrences<T>(
  graphs: JourneyGraph[],
  select: (graph: JourneyGraph) => T[],
): Occurrence<T>[] {
  const occurrences: Occurrence<T>[] = [];
  for (const graph of graphs) {
    const adapterNames = graph.meta?.adapters?.map((a) => a.name).join(', ');
    for (const item of select(graph)) {
      occurrences.push({
        item,
        ...(adapterNames !== undefined && adapterNames !== '' ? { adapter: adapterNames } : {}),
      });
    }
  }
  return occurrences;
}

/**
 * Special rule DD §D: derived edge D and annotation edge A with the same
 * (from, to) but different ids ⇒ D is dropped, A inherits fields from D that
 * A does not set. Two manual edges with the same (from, to) both remain.
 */
function collapseDerivedEdges(edges: JourneyEdge[]): JourneyEdge[] {
  const annotationByFromTo = new Map<string, JourneyEdge>();
  for (const edge of edges) {
    const key = `${edge.from} ${edge.to}`;
    // The first annotation edge per (from, to) inherits — deterministic.
    if (edge.source === 'annotation' && !annotationByFromTo.has(key)) {
      annotationByFromTo.set(key, edge);
    }
  }

  const result: JourneyEdge[] = [];
  for (const edge of edges) {
    if (edge.source === 'derived') {
      const heir = annotationByFromTo.get(`${edge.from} ${edge.to}`);
      if (heir && heir.id !== edge.id) {
        for (const field of EDGE_INHERIT_FIELDS) {
          if (heir[field] === undefined && edge[field] !== undefined) {
            (heir as unknown as Record<string, unknown>)[field] = edge[field];
          }
        }
        continue; // D is dropped
      }
    }
    result.push(edge);
  }
  return result;
}

/** Unions meta.adapters of all inputs (dedupe by name+version). */
function unionAdapters(graphs: JourneyGraph[]): AdapterInfo[] {
  const seen = new Map<string, AdapterInfo>();
  for (const graph of graphs) {
    for (const adapter of graph.meta?.adapters ?? []) {
      const key = `${adapter.name} ${adapter.version}`;
      if (!seen.has(key)) seen.set(key, { ...adapter });
    }
  }
  return [...seen.values()].sort(
    (a, b) => compareStrings(a.name, b.name) || compareStrings(a.version, b.version),
  );
}

/**
 * Merges multiple graphs (also: deduplicates within ONE graph) according to
 * the precedence rules from DD §D. Throws a MergeError with all collected
 * conflicts when manual sources contradict each other.
 */
export function mergeGraphs(
  graphs: JourneyGraph[],
  options?: { app?: AppInfo },
): JourneyGraph {
  const conflicts: MergeConflict[] = [];
  const byId = <T extends { id: string }>(a: T, b: T): number => compareStrings(a.id, b.id);

  const nodes: JourneyNode[] = [
    ...groupById(collectOccurrences(graphs, (g) => g.nodes)).values(),
  ].map((group) => mergeSourcedGroup<JourneyNode>('node', group, NODE_FIELDS, conflicts));

  const mergedEdges: JourneyEdge[] = [
    ...groupById(collectOccurrences(graphs, (g) => g.edges)).values(),
  ].map((group) => mergeSourcedGroup<JourneyEdge>('edge', group, EDGE_FIELDS, conflicts));

  const flows: JourneyFlow[] = [
    ...groupById(collectOccurrences(graphs, (g) => g.flows)).values(),
  ].map((group) => mergeFlowGroup(group, conflicts));

  if (conflicts.length > 0) {
    throw new MergeError(conflicts);
  }

  const edges = collapseDerivedEdges(mergedEdges);

  const app = options?.app ?? graphs.find((g) => g.app !== undefined)?.app;
  const adapters = unionAdapters(graphs);

  return {
    schemaVersion: SCHEMA_VERSION,
    ...(app !== undefined ? { app: { ...app } } : {}),
    flows: flows.sort(byId),
    nodes: nodes.sort(byId),
    edges: edges.sort(byId),
    meta: { adapters },
  };
}
