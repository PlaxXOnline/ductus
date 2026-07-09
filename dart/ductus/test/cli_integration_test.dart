import 'dart:convert';
import 'dart:io';

import 'package:ductus/adapter.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

/// Integrationstests gegen das echte CLI (DD §H):
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

  test('Erfolg: Exit 0, parsebares JSON, erwartete Nodes/Edges, Debug-Datei',
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

    // Manuelle Annotation überschreibt abgeleiteten Screen.
    final login = nodes.firstWhere((n) => n['id'] == 'login');
    expect(login['title'], 'Anmeldung');
    expect(login['source'], 'annotation');
    expect(login['tags'], ['auth', 'entry']); // sortiert

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

    // Nicht zuordenbare Navigation landet als Hinweis auf stderr.
    expect(result.stderr as String, contains('/unbekannt'));

    // Debug-Datei mit identischem Inhalt.
    expect(debugFile.existsSync(), isTrue);
    expect(debugFile.readAsStringSync(), result.stdout);
  });

  test('Determinismus: zwei Läufe liefern byte-identisches stdout', () async {
    final first = await runAdapterCli(['--project', fullApp, '--no-debug-file']);
    final second = await runAdapterCli(['--project', fullApp, '--no-debug-file']);

    expect(first.exitCode, 0);
    expect(second.exitCode, 0);
    expect(second.stdout, first.stdout);
    expect(utf8.encode(second.stdout as String),
        utf8.encode(first.stdout as String));
    // Kanonische Form: LF + abschließender Zeilenumbruch.
    expect((first.stdout as String).endsWith('}\n'), isTrue);
    expect(first.stdout as String, isNot(contains('\r')));
    expect(first.stdout as String, isNot(contains('generatedAt')));
  });

  test('--no-debug-file unterdrückt die Debug-Datei', () async {
    final result = await runAdapterCli(['--project', fullApp, '--no-debug-file']);

    expect(result.exitCode, 0);
    expect(debugFile.existsSync(), isFalse);
  });

  test('Konflikt: Exit ungleich 0, stderr nennt beide Quellen', () async {
    final result = await runAdapterCli(['--project', conflict]);

    expect(result.exitCode, isNot(0));
    final stderrText = result.stderr as String;
    expect(stderrText, contains('lib/a.dart:2'));
    expect(stderrText, contains('lib/b.dart:2'));
    // Kein Graph auf stdout im Fehlerfall.
    expect(result.stdout, isEmpty);
  });

  test('fehlendes --project: Exit ungleich 0 mit Usage auf stderr', () async {
    final result = await runAdapterCli([]);

    expect(result.exitCode, isNot(0));
    expect(result.stderr as String, contains('--project'));
  });

  test('--config schaltet Ableitungen ab', () async {
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
    // Nur manuell annotierte Nodes, keine abgeleiteten Routen.
    expect(nodeIds, unorderedEquals(['login', 'dashboard']));
  });

  test('adapterVersion stimmt mit version: in pubspec.yaml überein (DD §H)',
      () {
    final pubspec =
        File(p.join(packageDir, 'pubspec.yaml')).readAsStringSync();
    final match =
        RegExp(r'^version:\s*(\S+)\s*$', multiLine: true).firstMatch(pubspec);
    expect(match, isNotNull,
        reason: 'pubspec.yaml enthält keine version:-Zeile.');
    // Die Konstante ist hartkodiert — beim Release-Bump beide nachziehen,
    // sonst verletzt meta.adapters.version die DD-§N-Zusage
    // "version: <Paketversion>".
    expect(adapterVersion, match!.group(1));
  });
}
