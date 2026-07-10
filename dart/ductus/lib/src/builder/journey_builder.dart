/// Weg D — build_runner-Builder: extrahiert den Journey-Graphen als
/// Builder-Schritt und schreibt `ductus_builder.g.json` in den Projekt-Root
/// des Zielpakets (build_to: source, aggregierend über den synthetischen
/// Input `$package$`).
///
/// Wiederverwendung statt Kopie: es läuft die BESTEHENDE Adapter-Pipeline
/// ([runPipeline]); einziger Unterschied ist der zusätzliche
/// Resolutions-Schritt für nicht-literale konstante Annotation-Argumente.
/// Für rein literale Projekte ist das Artefakt daher byte-identisch mit der
/// stdout-Ausgabe des parse-only-Adapters — bis auf den meta.adapters-Namen
/// ([builderAdapterName] statt [cliAdapterName]).
library;

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:build/build.dart';
import 'package:glob/glob.dart';

import '../adapter/config.dart';
import '../adapter/graph_model.dart';
import '../adapter/runner.dart';
import '../adapter/scanner.dart';
import 'annotation_resolver.dart';

/// Factory für build.yaml (`builder_factories: ["ductusJourneyBuilder"]`).
///
/// Optionen (build.yaml `options:`) entsprechen der `--config`-JSON des CLI:
/// `deriveFrom` und `include` (jeweils Listen von Strings).
Builder ductusJourneyBuilder(BuilderOptions options) =>
    DuctusJourneyBuilder(_configFromOptions(options));

/// Baut die [AdapterConfig] aus den build.yaml-Optionen — gleiche Schlüssel
/// und Defaults wie beim Adapter-CLI.
AdapterConfig _configFromOptions(BuilderOptions options) {
  List<String>? stringList(String key) {
    final value = options.config[key];
    if (value == null) return null;
    if (value is! List || value.any((e) => e is! String)) {
      throw ArgumentError(
          'build.yaml: "$key" muss eine Liste von Strings sein.');
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
        // Synthetischer Input im Paket-Root ⇒ genau ein Output pro Paket,
        // ebenfalls im Paket-Root (ductus_builder.g.json).
        r'$package$': [builderArtifactFileName],
      };

  @override
  Future<void> build(BuildStep buildStep) async {
    final package = buildStep.inputId.package;

    // 1. Quelldateien einsammeln — gleiche include-Globs, .dart-Filter und
    //    Sortierung wie scanProject im Adapter-CLI (Paritätsgarantie).
    //    Hinweis: sichtbar sind nur Assets der build_runner-Target-Sources
    //    (Standard: lib/, test/, web/, …) — Muster außerhalb davon liefern
    //    keine Dateien und würden ohne Warnung stillschweigend vom
    //    Adapter-CLI abweichen.
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
        log.warning('Warnung: include-Muster "$pattern" trifft keine '
            'Dateien — liegt der Pfad außerhalb der build_runner-'
            'Target-Sources (Default u. a. lib/)? Dann in der build.yaml '
            'des Zielpakets targets.\$default.sources erweitern oder das '
            'Adapter-CLI nutzen.');
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
        // Gleiche Meldung wie der Scanner des Adapter-CLI.
        log.warning('Warnung: $rel enthält Syntaxfehler; '
            'Analyse ist best effort.');
      }
      files.add(ScannedFile(
        relPath: rel,
        content: content,
        unit: result.unit,
        lineInfo: result.lineInfo,
      ));
    }

    // 2. Resolutions-Schritt (der Mehrwert von Weg D): konstante, aber
    //    nicht-literale Annotation-Argumente auflösen.
    final resolution = await resolveJourneyAnnotations(buildStep, files);

    // 3. Bestehende Pipeline — Merge, Sortierung und kanonische
    //    Serialisierung sind identisch zum Adapter-CLI.
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
      // Gleiche Fehlersemantik wie das CLI (Meldungen einzeln, Exit ≠ 0):
      // severe-Logs markieren den Build-Schritt als fehlgeschlagen, es wird
      // kein Artefakt geschrieben.
      for (final message in e.messages) {
        log.severe(message);
      }
      return;
    }

    await buildStep.writeAsString(buildStep.allowedOutputs.single, json);
  }
}
