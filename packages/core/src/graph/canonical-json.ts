/**
 * Kanonische Serialisierung des Journey-Graphen (NFR2).
 *
 * Byte-Stabilität ist ein Kernversprechen: gleiche Eingabe ⇒ byte-gleiche
 * Ausgabe. Deshalb werden Objekt-Schlüssel rekursiv sortiert, Arrays mit
 * definierter Ordnung (ids, tags, platforms, adapter-Namen) sortiert und
 * `meta.generatedAt` entfernt (ein Zeitstempel gehört nur in den Report).
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

/** Deterministischer String-Vergleich über UTF-16-Code-Units (locale-unabhängig). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Baut den Wert rekursiv mit lexikographisch sortierten Objekt-Schlüsseln nach. */
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
 * JSON mit lexikographisch sortierten Objekt-Schlüsseln (rekursiv),
 * 2-Space-Indent, LF und abschließendem Zeilenumbruch.
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

/** Entfernt `generatedAt` (Byte-Stabilität) und sortiert Adapter nach name (dann version). */
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
 * Kanonische Form des Graphen: flows/nodes/edges nach id, tags und
 * app.platforms sortiert, meta.adapters nach name, kein generatedAt.
 * Die Eingabe wird nicht mutiert.
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

/** Kanonisierung + kanonische Stringifizierung in einem Schritt. */
export function serializeGraph(graph: JourneyGraph): string {
  return canonicalStringify(canonicalizeGraph(graph));
}
