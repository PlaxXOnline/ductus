/// Internal merge & precedence rules of the adapter.
///
/// `annotation` overrides `derived` field by field; two manual sources with
/// different values for the same field are an error (fail-fast) that cites
/// both source locations.
library;

import 'graph_model.dart';

class MergeResult {
  final List<GraphNode> nodes;
  final List<GraphEdge> edges;
  final List<GraphFlow> flows;

  const MergeResult({
    required this.nodes,
    required this.edges,
    required this.flows,
  });
}

int _byRef(SourceRef a, SourceRef b) {
  final byFile = a.file.compareTo(b.file);
  return byFile != 0 ? byFile : a.line.compareTo(b.line);
}

/// Stable sort by (file, line).
List<T> _sortedByRef<T>(Iterable<T> items, SourceRef Function(T) ref) {
  final indexed = items.toList();
  final order = {for (var i = 0; i < indexed.length; i++) indexed[i]: i};
  indexed.sort((a, b) {
    final c = _byRef(ref(a), ref(b));
    return c != 0 ? c : order[a]!.compareTo(order[b]!);
  });
  return indexed;
}

/// Field-wise merge of a candidate list: first manual value wins, otherwise
/// first derived one; two different manual values ⇒ conflict.
class _FieldMerger<T> {
  final String kind;
  final String id;
  final List<T> manual;
  final List<T> derived;
  final List<String> conflicts;

  _FieldMerger({
    required this.kind,
    required this.id,
    required List<T> candidates,
    required String Function(T) sourceOf,
    required this.conflicts,
  })  : manual = candidates
            .where((c) => sourceOf(c) == SourceKind.annotation)
            .toList(),
        derived = candidates
            .where((c) => sourceOf(c) != SourceKind.annotation)
            .toList();

  V? merge<V>(String field, V? Function(T) get, SourceRef Function(T) ref) {
    V? value;
    T? valueSource;
    for (final c in manual) {
      final v = get(c);
      if (v == null) continue;
      if (value == null) {
        value = v;
        valueSource = c;
      } else if (!_equalValues(value, v)) {
        conflicts.add('Conflict: $kind "$id", field "$field": '
            '"$value" (${ref(valueSource as T)}) vs. "$v" (${ref(c)}).');
      }
    }
    if (value != null) return value;
    for (final c in derived) {
      final v = get(c);
      if (v != null) return v;
    }
    return null;
  }

  static bool _equalValues(Object a, Object b) {
    if (a is List && b is List) {
      if (a.length != b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (a[i] != b[i]) return false;
      }
      return true;
    }
    return a == b;
  }
}

List<GraphNode> _mergeNodes(List<GraphNode> nodes, List<String> conflicts) {
  final byId = <String, List<GraphNode>>{};
  final idOrder = <String>[];
  for (final node in _sortedByRef(nodes, (n) => n.sourceRef)) {
    byId.putIfAbsent(node.id, () {
      idOrder.add(node.id);
      return [];
    }).add(node);
  }

  final merged = <GraphNode>[];
  for (final id in idOrder) {
    final candidates = byId[id]!;
    if (candidates.length == 1) {
      merged.add(candidates.single);
      continue;
    }
    final m = _FieldMerger<GraphNode>(
      kind: 'Node',
      id: id,
      candidates: candidates,
      sourceOf: (n) => n.source,
      conflicts: conflicts,
    );
    SourceRef ref(GraphNode n) => n.sourceRef;
    final winner = m.manual.isNotEmpty ? m.manual.first : m.derived.first;
    merged.add(GraphNode(
      id: id,
      type: m.merge('type', (n) => n.type, ref) ?? winner.type,
      title: m.merge('title', (n) => n.title, ref),
      flow: m.merge('flow', (n) => n.flow, ref),
      description: m.merge('description', (n) => n.description, ref),
      tags: m.merge('tags', (n) => n.tags.isEmpty ? null : n.tags, ref) ??
          const [],
      source: winner.source,
      sourceRef: winner.sourceRef,
    ));
  }
  return merged;
}

List<GraphFlow> _mergeFlows(List<GraphFlow> flows, List<String> conflicts) {
  final byId = <String, List<GraphFlow>>{};
  final idOrder = <String>[];
  for (final flow in _sortedByRef(flows, (f) => f.sourceRef)) {
    byId.putIfAbsent(flow.id, () {
      idOrder.add(flow.id);
      return [];
    }).add(flow);
  }

  final merged = <GraphFlow>[];
  for (final id in idOrder) {
    final candidates = byId[id]!;
    if (candidates.length == 1) {
      merged.add(candidates.single);
      continue;
    }
    final m = _FieldMerger<GraphFlow>(
      kind: 'Flow',
      id: id,
      candidates: candidates,
      sourceOf: (f) => f.source,
      conflicts: conflicts,
    );
    SourceRef ref(GraphFlow f) => f.sourceRef;
    final winner = m.manual.isNotEmpty ? m.manual.first : m.derived.first;
    merged.add(GraphFlow(
      id: id,
      title: m.merge('title', (f) => f.title, ref),
      start: m.merge('start', (f) => f.start, ref),
      description: m.merge('description', (f) => f.description, ref),
      source: winner.source,
      sourceRef: winner.sourceRef,
    ));
  }
  return merged;
}

List<GraphEdge> _mergeEdges(List<GraphEdge> edges, List<String> conflicts) {
  final sorted = _sortedByRef(edges, (e) => e.sourceRef);
  final manual =
      sorted.where((e) => e.source == SourceKind.annotation).toList();
  final derived =
      sorted.where((e) => e.source != SourceKind.annotation).toList();

  // Manual edges with an explicit id: identity via id, field-wise merge.
  final result = <GraphEdge>[];
  final manualById = <String, List<GraphEdge>>{};
  for (final edge in manual) {
    if (edge.id == null) {
      result.add(edge);
    } else {
      manualById.putIfAbsent(edge.id!, () => []).add(edge);
    }
  }
  for (final entry in manualById.entries) {
    final candidates = entry.value;
    if (candidates.length == 1) {
      result.add(candidates.single);
      continue;
    }
    final m = _FieldMerger<GraphEdge>(
      kind: 'Edge',
      id: entry.key,
      candidates: candidates,
      sourceOf: (e) => e.source,
      conflicts: conflicts,
    );
    SourceRef ref(GraphEdge e) => e.sourceRef;
    final winner = candidates.first;
    result.add(GraphEdge(
      id: entry.key,
      from: m.merge('from', (e) => e.from, ref) ?? winner.from,
      to: m.merge('to', (e) => e.to, ref) ?? winner.to,
      trigger: m.merge('trigger', (e) => e.trigger, ref),
      label: m.merge('label', (e) => e.label, ref),
      condition: m.merge('condition', (e) => e.condition, ref),
      source: winner.source,
      sourceRef: winner.sourceRef,
    ));
  }

  // Derived edges: a manual edge with the same (from, to) wins field-wise
  // (the derived one only fills missing fields of the first manual one);
  // exact duplicates among derived edges are deduplicated.
  final keptDerived = <GraphEdge>[];
  for (final edge in derived) {
    final manualIndex =
        result.indexWhere((m) => m.from == edge.from && m.to == edge.to);
    if (manualIndex >= 0) {
      final m = result[manualIndex];
      result[manualIndex] = GraphEdge(
        id: m.id,
        from: m.from,
        to: m.to,
        trigger: m.trigger ?? edge.trigger,
        label: m.label ?? edge.label,
        condition: m.condition ?? edge.condition,
        source: m.source,
        sourceRef: m.sourceRef,
      );
      continue;
    }
    final duplicate = keptDerived.any((k) =>
        k.from == edge.from &&
        k.to == edge.to &&
        k.trigger == edge.trigger &&
        k.label == edge.label &&
        k.condition == edge.condition);
    if (!duplicate) keptDerived.add(edge);
  }
  result.addAll(keptDerived);

  // Id generation: `e_<from>_<to>`, collisions get a _2/_3 suffix in
  // (file, line) order. result is already ordered so that manual edges come
  // before derived ones, each sorted by (file, line).
  final usedIds = <String>{
    for (final e in result)
      if (e.id != null) e.id!,
  };
  final withIds = <GraphEdge>[];
  for (final edge in result) {
    if (edge.id != null) {
      withIds.add(edge);
      continue;
    }
    final base = 'e_${edge.from}_${edge.to}';
    var id = base;
    var n = 2;
    while (usedIds.contains(id)) {
      id = '${base}_$n';
      n++;
    }
    usedIds.add(id);
    withIds.add(GraphEdge(
      id: id,
      from: edge.from,
      to: edge.to,
      trigger: edge.trigger,
      label: edge.label,
      condition: edge.condition,
      source: edge.source,
      sourceRef: edge.sourceRef,
    ));
  }
  return withIds;
}

/// Merges nodes/edges/flows from all sources. Conflicts between manual
/// sources raise an [AdapterException] listing all source locations.
MergeResult mergeGraph({
  required List<GraphNode> nodes,
  required List<GraphEdge> edges,
  required List<GraphFlow> flows,
}) {
  final conflicts = <String>[];
  final mergedNodes = _mergeNodes(nodes, conflicts);
  final mergedFlows = _mergeFlows(flows, conflicts);
  final mergedEdges = _mergeEdges(edges, conflicts);
  if (conflicts.isNotEmpty) {
    throw AdapterException(conflicts);
  }
  return MergeResult(
    nodes: mergedNodes,
    edges: mergedEdges,
    flows: mergedFlows,
  );
}
