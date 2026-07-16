import 'dart:convert';
import 'dart:io';

import 'package:ductus/adapter.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

/// Integration tests against the real CLI:
/// `dart run ductus:adapter --project <dir>`.
void main() {
  final packageDir = Directory.current.path;
  final fullApp = p.join(packageDir, 'test', 'fixtures', 'full_app');
  final conflict = p.join(packageDir, 'test', 'fixtures', 'conflict');
  final debugFile = File(p.join(fullApp, 'ductus_graph.g.json'));

  Future<ProcessResult> runAdapterCli(List<String> args) =>
      Process.run('dart', ['run', 'ductus:adapter', ...args],
          workingDirectory: packageDir, stdoutEncoding: utf8, stderrEncoding: utf8);

  tearDown(() {
    if (debugFile.existsSync()) debugFile.deleteSync();
  });

  test('success: exit 0, parseable JSON, expected nodes/edges, debug file',
      () async {
    final result = await runAdapterCli(['--project', fullApp]);

    expect(result.exitCode, 0, reason: result.stderr as String);
    final graph =
        jsonDecode(result.stdout as String) as Map<String, dynamic>;

    expect(graph['schemaVersion'], '1.0');
    expect(
      (graph['meta'] as Map<String, dynamic>)['adapters'],
      [
        {'name': 'dart', 'version': adapterVersion}
      ],
    );

    final nodes = (graph['nodes'] as List).cast<Map<String, dynamic>>();
    final nodeIds = nodes.map((n) => n['id']).toList();
    expect(
      nodeIds,
      containsAll([
        'login', 'dashboard', 'dashboard-settings', 'home', 'profile',
        'dashboard_redirect'
      ]),
    );

    // Manual annotation overrides the derived screen.
    final login = nodes.firstWhere((n) => n['id'] == 'login');
    expect(login['title'], 'Anmeldung');
    expect(login['source'], 'annotation');
    expect(login['tags'], ['auth', 'entry']); // sorted

    final edges = (graph['edges'] as List).cast<Map<String, dynamic>>();
    final edgeIds = edges.map((e) => e['id']).toList();
    expect(
      edgeIds,
      containsAll([
        'e_login_dashboard',
        'e_dashboard_login',
        'e_dashboard_redirect_dashboard',
        'e_dashboard_redirect_login',
        'e_profile_home',
      ]),
    );

    final flows = (graph['flows'] as List).cast<Map<String, dynamic>>();
    expect(flows.map((f) => f['id']), containsAll(['auth', 'shell-0']));

    // Unmappable navigation ends up as a note on stderr.
    expect(result.stderr as String, contains('/unbekannt'));

    // Debug file with identical content.
    expect(debugFile.existsSync(), isTrue);
    expect(debugFile.readAsStringSync(), result.stdout);
  });

  test('determinism: two runs produce byte-identical stdout', () async {
    final first = await runAdapterCli(['--project', fullApp, '--no-debug-file']);
    final second = await runAdapterCli(['--project', fullApp, '--no-debug-file']);

    expect(first.exitCode, 0);
    expect(second.exitCode, 0);
    expect(second.stdout, first.stdout);
    expect(utf8.encode(second.stdout as String),
        utf8.encode(first.stdout as String));
    // Canonical form: LF + trailing newline.
    expect((first.stdout as String).endsWith('}\n'), isTrue);
    expect(first.stdout as String, isNot(contains('\r')));
    expect(first.stdout as String, isNot(contains('generatedAt')));
  });

  test('--no-debug-file suppresses the debug file', () async {
    final result = await runAdapterCli(['--project', fullApp, '--no-debug-file']);

    expect(result.exitCode, 0);
    expect(debugFile.existsSync(), isFalse);
  });

  test('conflict: non-zero exit, stderr cites both sources', () async {
    final result = await runAdapterCli(['--project', conflict]);

    expect(result.exitCode, isNot(0));
    final stderrText = result.stderr as String;
    expect(stderrText, contains('lib/a.dart:2'));
    expect(stderrText, contains('lib/b.dart:2'));
    // No graph on stdout in the error case.
    expect(result.stdout, isEmpty);
  });

  test('missing --project: non-zero exit with usage on stderr', () async {
    final result = await runAdapterCli([]);

    expect(result.exitCode, isNot(0));
    expect(result.stderr as String, contains('--project'));
  });

  test('--config disables derivations', () async {
    final configFile = File(p.join(
        Directory.systemTemp.createTempSync('ductus_test_').path,
        'config.json'));
    configFile.writeAsStringSync('{"deriveFrom": []}');
    addTearDown(() => configFile.parent.deleteSync(recursive: true));

    final result = await runAdapterCli([
      '--project', fullApp,
      '--config', configFile.path,
      '--no-debug-file',
    ]);

    expect(result.exitCode, 0, reason: result.stderr as String);
    final graph = jsonDecode(result.stdout as String) as Map<String, dynamic>;
    final nodeIds =
        (graph['nodes'] as List).map((n) => (n as Map)['id']).toList();
    // Only manually annotated nodes, no derived routes.
    expect(nodeIds, unorderedEquals(['login', 'dashboard']));
  });

  test('adapterVersion matches version: in pubspec.yaml',
      () {
    final pubspec =
        File(p.join(packageDir, 'pubspec.yaml')).readAsStringSync();
    final match =
        RegExp(r'^version:\s*(\S+)\s*$', multiLine: true).firstMatch(pubspec);
    expect(match, isNotNull,
        reason: 'pubspec.yaml contains no version: line.');
    // The constant is hard-coded — bump both on a release, otherwise
    // meta.adapters.version no longer reports the actual package version
    // (the contract is "version: <package version>").
    expect(adapterVersion, match!.group(1));
  });
}
