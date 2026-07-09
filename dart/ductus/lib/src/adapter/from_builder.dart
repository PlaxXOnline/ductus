/// Weg D — Zubringer `--from-builder` (bzw. Config-Key `fromBuilder: true`):
/// liest das vom build_runner-Builder erzeugte Artefakt `ductus_builder.g.json`
/// aus dem Projekt-Root und reicht es unverändert durch — KEIN eigener Scan.
///
/// Die Datei ist so aktuell wie der letzte `dart run build_runner build`-Lauf
/// (Staleness liegt in der Verantwortung des Zielprojekts).
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'graph_model.dart';

/// Liest das Builder-Artefakt und liefert den Dateiinhalt byte-genau für
/// stdout. Fehlende Datei, ungültiges JSON oder eine inkompatible
/// schemaVersion (V6-Logik wie im Core) werfen eine [AdapterException].
String readBuilderArtifact(String projectDir) {
  final file = File(p.join(projectDir, builderArtifactFileName));
  if (!file.existsSync()) {
    throw AdapterException([
      'Fehler: $builderArtifactFileName nicht gefunden in $projectDir. '
          'Zuerst im Zielprojekt "dart run build_runner build" ausführen '
          '(Weg D).',
    ]);
  }

  final content = file.readAsStringSync();
  final Object? graph;
  try {
    graph = jsonDecode(content);
  } on FormatException catch (e) {
    throw AdapterException([
      '$builderArtifactFileName: ungültiges JSON: ${e.message}',
    ]);
  }

  final version = graph is Map<String, Object?> ? graph['schemaVersion'] : null;
  if (version is! String || !isSupportedSchemaVersion(version)) {
    throw AdapterException([
      'V6: $builderArtifactFileName: schemaVersion '
          '"${version is String ? version : '(fehlt)'}" wird nicht '
          'unterstützt (erwartet Major $supportedSchemaMajor, '
          'z. B. "$supportedSchemaMajor.0").',
    ]);
  }
  return content;
}
