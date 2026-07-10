/**
 * Interne Merge- & Präzedenzregeln des Adapters — 1:1-Port von
 * dart/ductus/lib/src/adapter/merger.dart.
 *
 * `annotation` überschreibt `derived` feldweise; zwei manuelle Quellen mit
 * unterschiedlichen Werten für dasselbe Feld sind ein Fehler (fail-fast) mit
 * beiden Quellenangaben.
 */

import {
  AdapterException,
  refToString,
  SourceKind,
  type GraphEdge,
  type GraphFlow,
  type GraphNode,
  type SourceRef,
} from './graph-model.js';

export interface MergeResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  flows: GraphFlow[];
}

function byRef(a: SourceRef, b: SourceRef): number {
  const byFile = a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  return byFile !== 0 ? byFile : a.line - b.line;
}

/** Stabil nach (Datei, Zeile) sortieren (Array.prototype.sort ist stabil). */
function sortedByRef<T>(items: readonly T[], ref: (item: T) => SourceRef): T[] {
  return [...items].sort((a, b) => byRef(ref(a), ref(b)));
}

function equalValues(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  return a === b;
}

/** Konfliktwert-Format wie im Dart-Adapter: Listen als `[a, b]`. */
function formatValue(value: unknown): string {
  return Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
}

/**
 * Feldweiser Merge einer Kandidatenliste: erster manueller Wert gewinnt,
 * sonst erster abgeleiteter; zwei verschiedene manuelle Werte ⇒ Konflikt.
 */
class FieldMerger<T> {
  readonly manual: T[];
  readonly derived: T[];

  constructor(
    private readonly kind: string,
    private readonly id: string,
    candidates: readonly T[],
    sourceOf: (candidate: T) => string,
    private readonly conflicts: string[],
  ) {
    this.manual = candidates.filter((c) => sourceOf(c) === SourceKind.annotation);
    this.derived = candidates.filter((c) => sourceOf(c) !== SourceKind.annotation);
  }

  merge<V>(
    field: string,
    get: (candidate: T) => V | undefined,
    ref: (candidate: T) => SourceRef,
  ): V | undefined {
    let value: V | undefined;
    let valueSource: T | undefined;
    for (const candidate of this.manual) {
      const v = get(candidate);
      if (v === undefined) continue;
      if (value === undefined) {
        value = v;
        valueSource = candidate;
      } else if (!equalValues(value, v)) {
        this.conflicts.push(
          `Konflikt: ${this.kind} "${this.id}", Feld "${field}": ` +
            `"${formatValue(value)}" (${refToString(ref(valueSource as T))}) vs. "${formatValue(v)}" (${refToString(ref(candidate))}).`,
        );
      }
    }
    if (value !== undefined) return value;
    for (const candidate of this.derived) {
      const v = get(candidate);
      if (v !== undefined) return v;
    }
    return undefined;
  }
}

function mergeNodes(nodes: readonly GraphNode[], conflicts: string[]): GraphNode[] {
  const byId = new Map<string, GraphNode[]>();
  for (const node of sortedByRef(nodes, (n) => n.sourceRef)) {
    const group = byId.get(node.id);
    if (group === undefined) {
      byId.set(node.id, [node]);
    } else {
      group.push(node);
    }
  }

  const merged: GraphNode[] = [];
  for (const [id, candidates] of byId) {
    if (candidates.length === 1) {
      merged.push(candidates[0]!);
      continue;
    }
    const m = new FieldMerger('Node', id, candidates, (n) => n.source, conflicts);
    const ref = (n: GraphNode): SourceRef => n.sourceRef;
    const winner = m.manual.length > 0 ? m.manual[0]! : m.derived[0]!;
    const title = m.merge('title', (n) => n.title, ref);
    const flow = m.merge('flow', (n) => n.flow, ref);
    const description = m.merge('description', (n) => n.description, ref);
    merged.push({
      id,
      type: m.merge('type', (n) => n.type, ref) ?? winner.type,
      ...(title !== undefined ? { title } : {}),
      ...(flow !== undefined ? { flow } : {}),
      ...(description !== undefined ? { description } : {}),
      tags: m.merge('tags', (n) => (n.tags.length === 0 ? undefined : n.tags), ref) ?? [],
      source: winner.source,
      sourceRef: winner.sourceRef,
    });
  }
  return merged;
}

function mergeFlows(flows: readonly GraphFlow[], conflicts: string[]): GraphFlow[] {
  const byId = new Map<string, GraphFlow[]>();
  for (const flow of sortedByRef(flows, (f) => f.sourceRef)) {
    const group = byId.get(flow.id);
    if (group === undefined) {
      byId.set(flow.id, [flow]);
    } else {
      group.push(flow);
    }
  }

  const merged: GraphFlow[] = [];
  for (const [id, candidates] of byId) {
    if (candidates.length === 1) {
      merged.push(candidates[0]!);
      continue;
    }
    const m = new FieldMerger('Flow', id, candidates, (f) => f.source, conflicts);
    const ref = (f: GraphFlow): SourceRef => f.sourceRef;
    const winner = m.manual.length > 0 ? m.manual[0]! : m.derived[0]!;
    const title = m.merge('title', (f) => f.title, ref);
    const start = m.merge('start', (f) => f.start, ref);
    const description = m.merge('description', (f) => f.description, ref);
    merged.push({
      id,
      ...(title !== undefined ? { title } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(description !== undefined ? { description } : {}),
      source: winner.source,
      sourceRef: winner.sourceRef,
    });
  }
  return merged;
}

function mergeEdges(edges: readonly GraphEdge[], conflicts: string[]): GraphEdge[] {
  const sorted = sortedByRef(edges, (e) => e.sourceRef);
  const manual = sorted.filter((e) => e.source === SourceKind.annotation);
  const derived = sorted.filter((e) => e.source !== SourceKind.annotation);

  // Manuelle Edges mit expliziter Id: Identität über id, feldweiser Merge.
  const result: GraphEdge[] = [];
  const manualById = new Map<string, GraphEdge[]>();
  for (const edge of manual) {
    if (edge.id === undefined) {
      result.push(edge);
    } else {
      const group = manualById.get(edge.id);
      if (group === undefined) {
        manualById.set(edge.id, [edge]);
      } else {
        group.push(edge);
      }
    }
  }
  for (const [id, candidates] of manualById) {
    if (candidates.length === 1) {
      result.push(candidates[0]!);
      continue;
    }
    const m = new FieldMerger('Edge', id, candidates, (e) => e.source, conflicts);
    const ref = (e: GraphEdge): SourceRef => e.sourceRef;
    const winner = candidates[0]!;
    const trigger = m.merge('trigger', (e) => e.trigger, ref);
    const label = m.merge('label', (e) => e.label, ref);
    const condition = m.merge('condition', (e) => e.condition, ref);
    result.push({
      id,
      from: m.merge('from', (e) => e.from, ref) ?? winner.from,
      to: m.merge('to', (e) => e.to, ref) ?? winner.to,
      ...(trigger !== undefined ? { trigger } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(condition !== undefined ? { condition } : {}),
      source: winner.source,
      sourceRef: winner.sourceRef,
    });
  }

  // Abgeleitete Edges: manuelle Edge mit gleichem (from, to) gewinnt feldweise
  // (die abgeleitete füllt nur fehlende Felder der ersten manuellen auf);
  // exakte Duplikate unter abgeleiteten Edges werden dedupliziert.
  const keptDerived: GraphEdge[] = [];
  for (const edge of derived) {
    const manualIndex = result.findIndex((m) => m.from === edge.from && m.to === edge.to);
    if (manualIndex >= 0) {
      const m = result[manualIndex]!;
      const trigger = m.trigger ?? edge.trigger;
      const label = m.label ?? edge.label;
      const condition = m.condition ?? edge.condition;
      result[manualIndex] = {
        ...(m.id !== undefined ? { id: m.id } : {}),
        from: m.from,
        to: m.to,
        ...(trigger !== undefined ? { trigger } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(condition !== undefined ? { condition } : {}),
        source: m.source,
        sourceRef: m.sourceRef,
      };
      continue;
    }
    const duplicate = keptDerived.some(
      (k) =>
        k.from === edge.from &&
        k.to === edge.to &&
        k.trigger === edge.trigger &&
        k.label === edge.label &&
        k.condition === edge.condition,
    );
    if (!duplicate) keptDerived.push(edge);
  }
  result.push(...keptDerived);

  // Id-Generierung: `e_<from>_<to>`, Kollisionen mit Suffix _2/_3 in
  // (Datei, Zeile)-Reihenfolge. result ist bereits so geordnet, dass
  // manuelle vor abgeleiteten kommen, jeweils nach (Datei, Zeile).
  const usedIds = new Set<string>();
  for (const edge of result) {
    if (edge.id !== undefined) usedIds.add(edge.id);
  }
  const withIds: GraphEdge[] = [];
  for (const edge of result) {
    if (edge.id !== undefined) {
      withIds.push(edge);
      continue;
    }
    const base = `e_${edge.from}_${edge.to}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}_${n}`;
      n++;
    }
    usedIds.add(id);
    withIds.push({ ...edge, id });
  }
  return withIds;
}

/**
 * Merged Nodes/Edges/Flows aller Quellen. Konflikte zwischen manuellen
 * Quellen führen zu einer [AdapterException] mit allen Fundstellen.
 */
export function mergeGraph(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  flows: readonly GraphFlow[];
}): MergeResult {
  const conflicts: string[] = [];
  const nodes = mergeNodes(input.nodes, conflicts);
  const flows = mergeFlows(input.flows, conflicts);
  const edges = mergeEdges(input.edges, conflicts);
  if (conflicts.length > 0) {
    throw new AdapterException(conflicts);
  }
  return { nodes, edges, flows };
}
