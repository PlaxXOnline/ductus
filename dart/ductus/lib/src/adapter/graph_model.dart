/// Internes Graph-Modell des Dart-Adapters + kanonische Serialisierung
/// (SPEC §6, DD §C).
library;

import 'dart:collection';
import 'dart:convert';

/// Muss mit `version:` in pubspec.yaml übereinstimmen (DD §H) — abgesichert
/// durch einen Regressionstest in test/cli_integration_test.dart.
const String adapterVersion = '0.2.0';

const String schemaVersion = '1.0';

/// meta.adapters-Name des Adapter-CLI (Scan via `dart run ductus:adapter`).
const String cliAdapterName = 'dart';

/// meta.adapters-Name des build_runner-Builders (Weg D).
const String builderAdapterName = 'dart-builder';

/// Artefakt des build_runner-Builders im Projekt-Root des Zielpakets (Weg D).
/// NICHT zu verwechseln mit `ductus_graph.g.json` — das ist die Debug-Datei,
/// die das Adapter-CLI bei jedem Scan schreibt.
const String builderArtifactFileName = 'ductus_builder.g.json';

/// Vom Adapter unterstützte Schema-Major-Version (V6/NFR7, wie im Core).
const int supportedSchemaMajor = 1;

/// V6-Logik wie im Core: „major.minor“ mit unterstütztem Major ⇒ kompatibel
/// (Minor-Erweiterungen sind rückwärtskompatibel zu pflegen, SPEC §6).
bool isSupportedSchemaVersion(String version) {
  final match = RegExp(r'^(\d+)\.(\d+)$').firstMatch(version);
  return match != null && int.parse(match.group(1)!) == supportedSchemaMajor;
}

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
///
/// [adapterName] ist der meta.adapters-Eintrag: [cliAdapterName] für den
/// CLI-Scan, [builderAdapterName] für das build_runner-Artefakt (Weg D) —
/// ansonsten sind beide Ausgaben byte-identisch (Paritätsgarantie).
String encodeCanonicalGraph({
  required List<GraphFlow> flows,
  required List<GraphNode> nodes,
  required List<GraphEdge> edges,
  String adapterName = cliAdapterName,
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
        {'name': adapterName, 'version': adapterVersion},
      ],
    },
  };
  final encoded =
      const JsonEncoder.withIndent('  ').convert(_canonicalize(graph));
  return '$encoded\n';
}
