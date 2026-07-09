/// Gemeinsame Zwischenstrukturen der manuellen Eingabewege (A: Kommentare,
/// B: Dart-Annotationen).
library;

import 'graph_model.dart';

/// Eine `@journey:action` / `@JourneyAction`, deren `from` ggf. erst nach dem
/// Scan aller Dateien über die umschließende Klasse aufgelöst wird (DD §B.3).
class ActionCandidate {
  final String? id;
  final String label;
  final String to;
  final String? from;
  final String trigger;
  final String? condition;

  /// Name der umschließenden Klasse (für die from-Inferenz), falls vorhanden.
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

/// Ergebnis eines manuellen Eingabewegs für eine Datei.
class ManualExtraction {
  final List<GraphNode> nodes = [];
  final List<GraphFlow> flows = [];
  final List<ActionCandidate> actions = [];

  /// Klassenname -> Screen-Id (für from-Inferenz und context.go-Zuordnung).
  final Map<String, String> screenClassNames = {};
}
