/// Internes Graph-Modell des Dart-Adapters + kanonische Serialisierung
/// (SPEC §6, DD §C).
library;

import 'dart:collection';
import 'dart:convert';

/// Muss mit `version:` in pubspec.yaml übereinstimmen (DD §H).
const String adapterVersion = '0.1.0';

const String schemaVersion = '1.0';

/// Herkunft eines Graph-Elements (SPEC §6.2).
class SourceKind {
  static const String annotation = 'annotation';
  static const String derived = 'derived';
}

/// Gültige Trigger-Werte (SPEC §6.3).
const Set<String> validTriggers = {
  'tap',
  'submit',
  'auto',
  'back',
  'deeplink',
  'system',
};

/// Rückverweis in den Quellcode (SPEC §6.2). [file] ist immer projekt-relativ
/// mit '/'-Separatoren.
class SourceRef {
  final String file;
  final int line;
  final String? symbol;

  const SourceRef({required this.file, required this.line, this.symbol});

  Map<String, Object?> toJson() => {
        'file': file,
        'line': line,
        if (symbol != null) 'symbol': symbol,
      };

  @override
  String toString() => '$file:$line';
}

/// Screen- oder Decision-Node (der Dart-Adapter emittiert keine Action-Nodes,
/// DD §B.2).
class GraphNode {
  final String id;
  final String type; // 'screen' | 'decision'
  final String? title;
  final String? flow;
  final String? description;
  final List<String> tags;
  final String source;
  final SourceRef sourceRef;

  const GraphNode({
    required this.id,
    required this.type,
    this.title,
    this.flow,
    this.description,
    this.tags = const [],
    required this.source,
    required this.sourceRef,
  });

  GraphNode copyWith({String? flow}) => GraphNode(
        id: id,
        type: type,
        title: title,
        flow: flow ?? this.flow,
        description: description,
        tags: tags,
        source: source,
        sourceRef: sourceRef,
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'type': type,
        if (title != null) 'title': title,
        if (flow != null) 'flow': flow,
        if (description != null) 'description': description,
        if (tags.isNotEmpty) 'tags': [...tags]..sort(),
        'source': source,
        'sourceRef': sourceRef.toJson(),
      };
}

/// Transition (SPEC §6.3). [id] ist bis zur Id-Generierung im Merger optional.
class GraphEdge {
  final String? id;
  final String from;
  final String to;
  final String? trigger;
  final String? label;
  final String? condition;
  final String source;
  final SourceRef sourceRef;

  const GraphEdge({
    this.id,
    required this.from,
    required this.to,
    this.trigger,
    this.label,
    this.condition,
    required this.source,
    required this.sourceRef,
  });

  Map<String, Object?> toJson() => {
        'id': id!,
        'from': from,
        'to': to,
        if (trigger != null) 'trigger': trigger,
        if (label != null) 'label': label,
        if (condition != null) 'condition': condition,
        'source': source,
        'sourceRef': sourceRef.toJson(),
      };
}

/// Benannter Flow (SPEC §6.4). [source]/[sourceRef] sind nur intern für die
/// Merge-Präzedenz relevant und werden nicht serialisiert.
class GraphFlow {
  final String id;
  final String? title;
  final String? start;
  final String? description;
  final String source;
  final SourceRef sourceRef;

  const GraphFlow({
    required this.id,
    this.title,
    this.start,
    this.description,
    required this.source,
    required this.sourceRef,
  });

  Map<String, Object?> toJson() => {
        'id': id,
        if (title != null) 'title': title,
        if (start != null) 'start': start,
        if (description != null) 'description': description,
      };
}

/// Fehler, der den Adapter mit Exit ≠0 beendet; [messages] gehen auf stderr.
class AdapterException implements Exception {
  final List<String> messages;

  AdapterException(this.messages);

  @override
  String toString() => messages.join('\n');
}

Object? _canonicalize(Object? value) {
  if (value is Map) {
    final sorted = SplayTreeMap<String, Object?>();
    value.forEach((key, v) => sorted[key as String] = _canonicalize(v));
    return sorted;
  }
  if (value is List) return value.map(_canonicalize).toList();
  return value;
}

/// Kanonisches Graph-JSON nach DD §C: rekursiv sortierte Schlüssel,
/// 2-Space-Indent, LF, abschließender Zeilenumbruch, kein `generatedAt`.
String encodeCanonicalGraph({
  required List<GraphFlow> flows,
  required List<GraphNode> nodes,
  required List<GraphEdge> edges,
}) {
  int byId(String a, String b) => a.compareTo(b);
  final graph = <String, Object?>{
    'schemaVersion': schemaVersion,
    'flows': ([...flows]..sort((a, b) => byId(a.id, b.id)))
        .map((f) => f.toJson())
        .toList(),
    'nodes': ([...nodes]..sort((a, b) => byId(a.id, b.id)))
        .map((n) => n.toJson())
        .toList(),
    'edges': ([...edges]..sort((a, b) => byId(a.id!, b.id!)))
        .map((e) => e.toJson())
        .toList(),
    'meta': {
      'adapters': [
        {'name': 'dart', 'version': adapterVersion},
      ],
    },
  };
  final encoded =
      const JsonEncoder.withIndent('  ').convert(_canonicalize(graph));
  return '$encoded\n';
}
