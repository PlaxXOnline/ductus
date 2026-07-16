/// Path D — build_runner builder: extracts the journey graph as a builder
/// step and writes `ductus_builder.g.json` into the target package's
/// project root (build_to: source, aggregating over the synthetic input
/// `$package$`).
///
/// Reuse instead of a copy: the EXISTING adapter pipeline ([runPipeline])
/// runs; the only difference is the additional resolution step for
/// non-literal constant annotation arguments. For purely literal projects
/// the artifact is therefore byte-identical to the stdout output of the
/// parse-only adapter — except for the meta.adapters name
/// ([builderAdapterName] instead of [cliAdapterName]).
library;

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:build/build.dart';
import 'package:glob/glob.dart';

import '../adapter/config.dart';
import '../adapter/graph_model.dart';
import '../adapter/runner.dart';
import '../adapter/scanner.dart';
import 'annotation_resolver.dart';

/// Factory for build.yaml (`builder_factories: ["ductusJourneyBuilder"]`).
///
/// Options (build.yaml `options:`) match the CLI's `--config` JSON:
/// `deriveFrom` and `include` (each a list of strings).
Builder ductusJourneyBuilder(BuilderOptions options) =>
    DuctusJourneyBuilder(_configFromOptions(options));

/// Builds the [AdapterConfig] from the build.yaml options — same keys and
/// defaults as the adapter CLI.
AdapterConfig _configFromOptions(BuilderOptions options) {
  List<String>? stringList(String key) {
    final value = options.config[key];
    if (value == null) return null;
    if (value is! List || value.any((e) => e is! String)) {
      throw ArgumentError(
          'build.yaml: "$key" must be a list of strings.');
    }
    return value.cast<String>();
  }

  return AdapterConfig(
    deriveFrom:
        stringList('deriveFrom') ?? const ['go_router', 'auto_route'],
    include: stringList('include') ?? const ['lib/**'],
  );
}

class DuctusJourneyBuilder implements Builder {
  final AdapterConfig config;

  const DuctusJourneyBuilder(this.config);

  @override
  Map<String, List<String>> get buildExtensions => const {
        // Synthetic input in the package root ⇒ exactly one output per
        // package, also in the package root (ductus_builder.g.json).
        r'$package$': [builderArtifactFileName],
      };

  @override
  Future<void> build(BuildStep buildStep) async {
    final package = buildStep.inputId.package;

    // 1. Collect source files — same include globs, .dart filter, and
    //    sorting as scanProject in the adapter CLI (parity guarantee).
    //    Note: only assets of the build_runner target sources are visible
    //    (default: lib/, test/, web/, …) — patterns outside of them yield
    //    no files and would silently diverge from the adapter CLI without
    //    a warning.
    final paths = <String>{};
    for (final pattern in config.include) {
      var matched = false;
      await for (final asset in buildStep.findAssets(Glob(pattern))) {
        if (asset.package == package && asset.path.endsWith('.dart')) {
          matched = true;
          paths.add(asset.path);
        }
      }
      if (!matched) {
        log.warning('Warning: include pattern "$pattern" does not match '
            'any files — is the path outside the build_runner target '
            'sources (default includes lib/)? If so, extend '
            'targets.\$default.sources in the target package\'s build.yaml '
            'or use the adapter CLI.');
      }
    }
    final sorted = paths.toList()..sort();

    final files = <ScannedFile>[];
    for (final rel in sorted) {
      final content = await buildStep.readAsString(AssetId(package, rel));
      final result = parseString(
        content: content,
        path: rel,
        throwIfDiagnostics: false,
      );
      if (result.errors.isNotEmpty) {
        // Same message as the adapter CLI's scanner.
        log.warning('Warning: $rel contains syntax errors; '
            'analysis is best effort.');
      }
      files.add(ScannedFile(
        relPath: rel,
        content: content,
        unit: result.unit,
        lineInfo: result.lineInfo,
      ));
    }

    // 2. Resolution step (the added value of path D): resolve constant but
    //    non-literal annotation arguments.
    final resolution = await resolveJourneyAnnotations(buildStep, files);

    // 3. Existing pipeline — merge, sorting, and canonical serialization
    //    are identical to the adapter CLI.
    final String json;
    try {
      json = runPipeline(
        files: files,
        config: config,
        warn: log.warning,
        resolution: resolution,
        adapterName: builderAdapterName,
      );
    } on AdapterException catch (e) {
      // Same error semantics as the CLI (messages one by one, exit != 0):
      // severe logs mark the build step as failed, no artifact is written.
      for (final message in e.messages) {
        log.severe(message);
      }
      return;
    }

    await buildStep.writeAsString(buildStep.allowedOutputs.single, json);
  }
}
