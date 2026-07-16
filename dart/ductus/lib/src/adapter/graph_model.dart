/// Internal graph model of the Dart adapter + canonical serialization
/// into the journey graph JSON.
library;

import 'dart:collection';
import 'dart:convert';

/// Must match `version:` in pubspec.yaml — guarded by a regression test
/// in test/cli_integration_test.dart.
const String adapterVersion = '0.3.0';

const String schemaVersion = '1.0';

/// meta.adapters name of the adapter CLI (scan via `dart run ductus:adapter`).
const String cliAdapterName = 'dart';

/// meta.adapters name of the build_runner builder (path D).
const String builderAdapterName = 'dart-builder';

/// Artifact of the build_runner builder in the target package's project root
/// (path D). NOT to be confused with `ductus_graph.g.json` — that is the
/// debug file the adapter CLI writes on every scan.
const String builderArtifactFileName = 'ductus_builder.g.json';

/// Schema major version supported by the adapter (validation rule V6,
/// same as in the core).
const int supportedSchemaMajor = 1;

/// V6 logic as in the core: "major.minor" with a supported major ⇒ compatible
/// (minor extensions of the schema are backwards compatible).
bool isSupportedSchemaVersion(String version) {
  final match = RegExp(r'^(\d+)\.(\d+)$').firstMatch(version);
  return match != null && int.parse(match.group(1)!) == supportedSchemaMajor;
}

/// Origin of a graph element: manually annotated or derived.
class SourceKind {
  static const String annotation = 'annotation';
  static const String derived = 'derived';
}

/// Valid trigger values of a transition (matches `JourneyTrigger`).
const Set<String> validTriggers = {
  'tap',
  'submit',
  'auto',
  'back',
  'deeplink',
  'system',
};

/// Back-reference into the source code. [file] is always project-relative
/// with '/' separators.
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

/// Screen or decision node (the Dart adapter emits no action nodes;
/// actions are mapped directly to edges).
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

/// Transition (edge). [id] is optional until id generation in the merger.
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

/// Named flow. [source]/[sourceRef] are only relevant internally for merge
/// precedence and are not serialized.
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

/// Error that terminates the adapter with a non-zero exit code;
/// [messages] go to stderr.
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

/// Canonical, diff-stable graph JSON: recursively sorted keys, 2-space
/// indent, LF, trailing newline, no `generatedAt`.
///
/// [adapterName] is the meta.adapters entry: [cliAdapterName] for the CLI
/// scan, [builderAdapterName] for the build_runner artifact (path D) —
/// otherwise both outputs are byte-identical (parity guarantee).
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
