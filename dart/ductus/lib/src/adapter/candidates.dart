/// Shared intermediate structures of the manual input paths (A: comments,
/// B: Dart annotations).
library;

import 'graph_model.dart';

/// A `@journey:action` / `@JourneyAction` whose `from` may only be resolved
/// after scanning all files, via the enclosing class.
class ActionCandidate {
  final String? id;
  final String label;
  final String to;
  final String? from;
  final String trigger;
  final String? condition;

  /// Name of the enclosing class (for from inference), if any.
  final String? enclosingClassName;
  final SourceRef sourceRef;

  const ActionCandidate({
    this.id,
    required this.label,
    required this.to,
    this.from,
    required this.trigger,
    this.condition,
    this.enclosingClassName,
    required this.sourceRef,
  });
}

/// Result of one manual input path for a file.
class ManualExtraction {
  final List<GraphNode> nodes = [];
  final List<GraphFlow> flows = [];
  final List<ActionCandidate> actions = [];

  /// Class name -> screen id (for from inference and context.go mapping).
  final Map<String, String> screenClassNames = {};
}
