/// Orchestrates the extraction pipeline of the Dart adapter:
/// scan → path A/B (manual) → path C (derivation) → from resolution → merge →
/// canonical JSON.
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

/// Runs the full extraction and returns the canonical graph JSON.
/// Diagnostics go through [warn] (stderr); errors throw [AdapterException].
String runAdapter({
  required String projectDir,
  AdapterConfig config = const AdapterConfig(),
  required void Function(String) warn,
}) {
  final files = scanProject(projectDir, config, warn);
  return runPipeline(files: files, config: config, warn: warn);
}

/// Pipeline on already scanned files — shared base of the adapter CLI and
/// the build_runner builder (path D). Same merge/sort/serialization logic
/// for both feeders (parity guarantee): differences only arise from
/// [resolution] (additionally resolved values) and [adapterName]
/// (meta.adapters entry).
String runPipeline({
  required List<ScannedFile> files,
  AdapterConfig config = const AdapterConfig(),
  required void Function(String) warn,
  AnnotationResolution? resolution,
  String adapterName = cliAdapterName,
}) {
  final errors = <String>[];
  final nodes = <GraphNode>[];
  final flows = <GraphFlow>[];
  final actions = <ActionCandidate>[];
  final manualScreenClasses = <String, String>{};

  // Path A + B — manual sources, files in sorted order.
  for (final file in files) {
    for (final extraction in [
      parseComments(file, warn, errors),
      extractAnnotations(file, warn, errors, resolution: resolution),
    ]) {
      nodes.addAll(extraction.nodes);
      flows.addAll(extraction.flows);
      actions.addAll(extraction.actions);
      extraction.screenClassNames.forEach(
          (cls, id) => manualScreenClasses.putIfAbsent(cls, () => id));
    }
  }

  // Path C — derivations.
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

  // from inference for actions without an explicit `from`: the enclosing
  // class must be known as a screen (annotation, comment, or
  // builder/auto_route mapping).
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
        errors.add('${action.sourceRef}: action "${action.label}" without '
            '"from" — enclosing class ${cls ?? '(none)'} is not a known '
            'screen.');
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
    adapterName: adapterName,
  );
}
