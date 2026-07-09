/// Orchestriert die Extraktions-Pipeline des Dart-Adapters:
/// Scan → Weg A/B (manuell) → Weg C (Ableitung) → from-Auflösung → Merge →
/// kanonisches JSON.
library;

import 'annotation_extractor.dart';
import 'candidates.dart';
import 'comment_parser.dart';
import 'config.dart';
import 'derive_auto_route.dart';
import 'derive_go_router.dart';
import 'graph_model.dart';
import 'merger.dart';
import 'scanner.dart';

/// Führt die komplette Extraktion aus und liefert das kanonische Graph-JSON.
/// Diagnostik geht über [warn] (stderr); Fehler werfen [AdapterException].
String runAdapter({
  required String projectDir,
  AdapterConfig config = const AdapterConfig(),
  required void Function(String) warn,
}) {
  final files = scanProject(projectDir, config, warn);

  final errors = <String>[];
  final nodes = <GraphNode>[];
  final flows = <GraphFlow>[];
  final actions = <ActionCandidate>[];
  final manualScreenClasses = <String, String>{};

  // Weg A + B — manuelle Quellen, Dateien in sortierter Reihenfolge.
  for (final file in files) {
    for (final extraction in [
      parseComments(file, warn, errors),
      extractAnnotations(file, warn, errors),
    ]) {
      nodes.addAll(extraction.nodes);
      flows.addAll(extraction.flows);
      actions.addAll(extraction.actions);
      extraction.screenClassNames.forEach(
          (cls, id) => manualScreenClasses.putIfAbsent(cls, () => id));
    }
  }

  // Weg C — Ableitungen.
  var autoRoute = AutoRouteDerivation();
  if (config.deriveAutoRoute) {
    autoRoute = deriveAutoRoute(files, warn);
    nodes.addAll(autoRoute.nodes);
  }

  final edges = <GraphEdge>[];
  var builderClassToScreen = const <String, String>{};
  if (config.deriveGoRouter) {
    final goRouter = deriveGoRouter(
      files,
      warn,
      manualScreenClasses: manualScreenClasses,
      extraClassToScreen: autoRoute.classToScreen,
      extraPathToScreen: autoRoute.pathToScreen,
    );
    nodes.addAll(goRouter.nodes);
    flows.addAll(goRouter.flows);
    edges.addAll(goRouter.edges);
    builderClassToScreen = goRouter.builderClassToScreen;
  }

  // from-Inferenz für Actions ohne explizites `from` (DD §B.3): umschließende
  // Klasse muss als Screen bekannt sein (Annotation, Kommentar oder
  // builder-/auto_route-Zuordnung).
  for (final action in actions) {
    var from = action.from;
    if (from == null) {
      final cls = action.enclosingClassName;
      from = cls == null
          ? null
          : manualScreenClasses[cls] ??
              autoRoute.classToScreen[cls] ??
              builderClassToScreen[cls];
      if (from == null) {
        errors.add('${action.sourceRef}: Action "${action.label}" ohne "from" '
            '— umschließende Klasse ${cls ?? '(keine)'} ist kein bekannter '
            'Screen.');
        continue;
      }
    }
    edges.add(GraphEdge(
      id: action.id,
      from: from,
      to: action.to,
      trigger: action.trigger,
      label: action.label,
      condition: action.condition,
      source: SourceKind.annotation,
      sourceRef: action.sourceRef,
    ));
  }

  if (errors.isNotEmpty) {
    throw AdapterException(errors);
  }

  final merged = mergeGraph(nodes: nodes, edges: edges, flows: flows);
  return encodeCanonicalGraph(
    flows: merged.flows,
    nodes: merged.nodes,
    edges: merged.edges,
  );
}
