/**
 * Canonical serialization of the journey graph (NFR2).
 *
 * Byte stability is a core promise: same input ⇒ byte-identical output.
 * Therefore object keys are sorted recursively, arrays with a defined order
 * (ids, tags, platforms, adapter names) are sorted, and `meta.generatedAt`
 * is removed (a timestamp belongs only in the report).
 */

import type {
  AdapterInfo,
  AppInfo,
  GraphMeta,
  JourneyEdge,
  JourneyFlow,
  JourneyGraph,
  JourneyNode,
} from '@ductus/schema';

/** Deterministic string comparison over UTF-16 code units (locale-independent). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rebuilds the value recursively with lexicographically sorted object keys. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b));
    const result: Record<string, unknown> = {};
    for (const [key, v] of entries) {
      result[key] = sortKeysDeep(v);
    }
    return result;
  }
  return value;
}

/**
 * JSON with lexicographically sorted object keys (recursive), 2-space indent,
 * LF, and a trailing newline.
 */
export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortedStrings(values: string[]): string[] {
  return [...values].sort(compareStrings);
}

function canonicalizeNode(node: JourneyNode): JourneyNode {
  return {
    ...node,
    ...(node.sourceRef !== undefined ? { sourceRef: { ...node.sourceRef } } : {}),
    ...(node.tags !== undefined ? { tags: sortedStrings(node.tags) } : {}),
  };
}

function canonicalizeEdge(edge: JourneyEdge): JourneyEdge {
  return {
    ...edge,
    ...(edge.sourceRef !== undefined ? { sourceRef: { ...edge.sourceRef } } : {}),
  };
}

function canonicalizeApp(app: AppInfo): AppInfo {
  return {
    ...app,
    ...(app.platforms !== undefined ? { platforms: sortedStrings(app.platforms) } : {}),
  };
}

/** Removes `generatedAt` (byte stability) and sorts adapters by name (then version). */
function canonicalizeMeta(meta: GraphMeta): GraphMeta {
  const result: GraphMeta = {};
  if (meta.adapters !== undefined) {
    result.adapters = [...meta.adapters]
      .map((adapter): AdapterInfo => ({ ...adapter }))
      .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.version, b.version));
  }
  return result;
}

/**
 * Canonical form of the graph: flows/nodes/edges sorted by id, tags and
 * app.platforms sorted, meta.adapters by name, no generatedAt.
 * The input is not mutated.
 */
export function canonicalizeGraph(graph: JourneyGraph): JourneyGraph {
  const byId = <T extends { id: string }>(a: T, b: T): number => compareStrings(a.id, b.id);

  return {
    schemaVersion: graph.schemaVersion,
    ...(graph.app !== undefined ? { app: canonicalizeApp(graph.app) } : {}),
    flows: graph.flows.map((flow): JourneyFlow => ({ ...flow })).sort(byId),
    nodes: graph.nodes.map(canonicalizeNode).sort(byId),
    edges: graph.edges.map(canonicalizeEdge).sort(byId),
    ...(graph.meta !== undefined ? { meta: canonicalizeMeta(graph.meta) } : {}),
  };
}

/** Canonicalization + canonical stringification in one step. */
export function serializeGraph(graph: JourneyGraph): string {
  return canonicalStringify(canonicalizeGraph(graph));
}
