import 'dart:convert';
import 'dart:io';

import 'package:ductus/adapter.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

/// Integrationstests für den Weg-D-Zubringer des Adapter-CLI:
/// `--from-builder` bzw. Config-Key `fromBuilder: true` reichen das
/// build_runner-Artefakt `ductus_builder.g.json` durch — kein eigener Scan.
void main() {
  final packageDir = Directory.current.path;

  Future<ProcessResult> runAdapterCli(List<String> args) =>
      Process.run('dart', ['run', 'ductus:adapter', ...args],
          workingDirectory: packageDir,
          stdoutEncoding: utf8,
          stderrEncoding: utf8);

  /// Temporäres Zielprojekt, wird nach dem Test entfernt.
  Directory tempProject() {
    final dir = Directory.systemTemp.createTempSync('ductus_from_builder_');
    addTearDown(() => dir.deleteSync(recursive: true));
    return dir;
  }

  /// Ein minimales, schema-valides Builder-Artefakt in kanonischer Form.
  String writeArtifact(Directory project, {String? content}) {
    final artifact = content ??
        encodeCanonicalGraph(
          flows: const [],
          nodes: const [
            GraphNode(
              id: 'login',
              type: 'screen',
              title: 'Anmeldung',
              source: SourceKind.annotation,
              sourceRef: SourceRef(file: 'lib/main.dart', line: 3),
            ),
          ],
          edges: const [],
          adapterName: builderAdapterName,
        );
    File(p.join(project.path, builderArtifactFileName))
        .writeAsStringSync(artifact);
    return artifact;
  }

  test('--from-builder reicht das Artefakt byte-genau nach stdout durch',
      () async {
    final project = tempProject();
    final artifact = writeArtifact(project);

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, 0, reason: result.stderr as String);
    expect(result.stdout, artifact);
    expect(utf8.encode(result.stdout as String), utf8.encode(artifact));
    // Kein eigener Scan ⇒ auch keine Debug-Datei ductus_graph.g.json.
    expect(
        File(p.join(project.path, 'ductus_graph.g.json')).existsSync(), isFalse);
  });

  test('Config-Key fromBuilder: true wirkt wie das Flag', () async {
    final project = tempProject();
    final artifact = writeArtifact(project);
    final configFile = File(p.join(project.path, 'config.json'))
      ..writeAsStringSync('{"fromBuilder": true}');

    final result = await runAdapterCli(
        ['--project', project.path, '--config', configFile.path]);

    expect(result.exitCode, 0, reason: result.stderr as String);
    expect(result.stdout, artifact);
  });

  test('fehlendes Artefakt: Exit ungleich 0 mit build_runner-Hinweis',
      () async {
    final project = tempProject();

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, isNot(0));
    final stderrText = result.stderr as String;
    expect(stderrText, contains(builderArtifactFileName));
    expect(stderrText, contains('dart run build_runner build'));
    expect(result.stdout, isEmpty);
  });

  test('inkompatible schemaVersion: V6-Fehler mit Exit ungleich 0', () async {
    final project = tempProject();
    writeArtifact(project,
        content: '{\n  "schemaVersion": "2.0",\n  "flows": [],\n'
            '  "nodes": [],\n  "edges": []\n}\n');

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, isNot(0));
    final stderrText = result.stderr as String;
    expect(stderrText, contains('V6'));
    expect(stderrText, contains('schemaVersion "2.0"'));
    expect(result.stdout, isEmpty);
  });

  test('ungültiges JSON im Artefakt: Exit ungleich 0 mit klarem Fehler',
      () async {
    final project = tempProject();
    writeArtifact(project, content: '{kein json');

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, isNot(0));
    expect(result.stderr as String, contains('ungültiges JSON'));
    expect(result.stdout, isEmpty);
  });
}
