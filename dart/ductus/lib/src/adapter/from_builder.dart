/// Path D — feeder `--from-builder` (or config key `fromBuilder: true`):
/// reads the artifact `ductus_builder.g.json` produced by the build_runner
/// builder from the project root and passes it through unchanged — NO own
/// scan.
///
/// The file is as fresh as the last `dart run build_runner build` run
/// (staleness is the target project's responsibility).
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'graph_model.dart';

/// Reads the builder artifact and returns the file content byte-exact for
/// stdout. A missing file, invalid JSON, or an incompatible schemaVersion
/// (V6 logic as in the core) throws an [AdapterException].
String readBuilderArtifact(String projectDir) {
  final file = File(p.join(projectDir, builderArtifactFileName));
  if (!file.existsSync()) {
    throw AdapterException([
      'Error: $builderArtifactFileName not found in $projectDir. '
          'Run "dart run build_runner build" in the target project first '
          '(path D).',
    ]);
  }

  final content = file.readAsStringSync();
  final Object? graph;
  try {
    graph = jsonDecode(content);
  } on FormatException catch (e) {
    throw AdapterException([
      '$builderArtifactFileName: invalid JSON: ${e.message}',
    ]);
  }

  final version = graph is Map<String, Object?> ? graph['schemaVersion'] : null;
  if (version is! String || !isSupportedSchemaVersion(version)) {
    throw AdapterException([
      'V6: $builderArtifactFileName: schemaVersion '
          '"${version is String ? version : '(missing)'}" is not '
          'supported (expected major $supportedSchemaMajor, '
          'e.g. "$supportedSchemaMajor.0").',
    ]);
  }
  return content;
}
