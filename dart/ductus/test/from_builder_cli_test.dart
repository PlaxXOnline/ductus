import 'dart:convert';
import 'dart:io';

import 'package:ductus/adapter.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

/// Integration tests for the adapter CLI's path-D feeder:
/// `--from-builder` (or config key `fromBuilder: true`) passes through the
/// build_runner artifact `ductus_builder.g.json` — no own scan.
void main() {
  final packageDir = Directory.current.path;

  Future<ProcessResult> runAdapterCli(List<String> args) =>
      Process.run('dart', ['run', 'ductus:adapter', ...args],
          workingDirectory: packageDir,
          stdoutEncoding: utf8,
          stderrEncoding: utf8);

  /// Temporary target project, removed after the test.
  Directory tempProject() {
    final dir = Directory.systemTemp.createTempSync('ductus_from_builder_');
    addTearDown(() => dir.deleteSync(recursive: true));
    return dir;
  }

  /// A minimal, schema-valid builder artifact in canonical form.
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

  test('--from-builder passes the artifact byte-exact to stdout',
      () async {
    final project = tempProject();
    final artifact = writeArtifact(project);

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, 0, reason: result.stderr as String);
    expect(result.stdout, artifact);
    expect(utf8.encode(result.stdout as String), utf8.encode(artifact));
    // No own scan ⇒ no debug file ductus_graph.g.json either.
    expect(
        File(p.join(project.path, 'ductus_graph.g.json')).existsSync(), isFalse);
  });

  test('config key fromBuilder: true acts like the flag', () async {
    final project = tempProject();
    final artifact = writeArtifact(project);
    final configFile = File(p.join(project.path, 'config.json'))
      ..writeAsStringSync('{"fromBuilder": true}');

    final result = await runAdapterCli(
        ['--project', project.path, '--config', configFile.path]);

    expect(result.exitCode, 0, reason: result.stderr as String);
    expect(result.stdout, artifact);
  });

  test('missing artifact: non-zero exit with a build_runner hint',
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

  test('incompatible schemaVersion: V6 error with non-zero exit', () async {
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

  test('invalid JSON in the artifact: non-zero exit with a clear error',
      () async {
    final project = tempProject();
    writeArtifact(project, content: '{not json');

    final result =
        await runAdapterCli(['--project', project.path, '--from-builder']);

    expect(result.exitCode, isNot(0));
    expect(result.stderr as String, contains('invalid JSON'));
    expect(result.stdout, isEmpty);
  });
}
