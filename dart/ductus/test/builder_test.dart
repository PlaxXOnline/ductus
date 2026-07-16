import 'dart:convert';
import 'dart:io';

import 'package:build/build.dart';
import 'package:build_test/build_test.dart';
import 'package:ductus/adapter.dart';
import 'package:ductus/builder.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import 'test_util.dart';

/// Result of a builder run in the build_test harness.
class BuilderRun {
  final String? artifact;
  final List<String> warnings;
  final List<String> severe;
  final bool succeeded;

  const BuilderRun({
    required this.artifact,
    required this.warnings,
    required this.severe,
    required this.succeeded,
  });
}

/// The package's real annotation sources as test assets so the resolver can
/// resolve `package:ductus/ductus.dart` in the target package.
Map<String, String> ductusSources() => {
      'ductus|lib/ductus.dart': File('lib/ductus.dart').readAsStringSync(),
      'ductus|lib/src/annotations.dart':
          File(p.join('lib', 'src', 'annotations.dart')).readAsStringSync(),
    };

/// Runs the journey builder on the in-memory package `app`.
Future<BuilderRun> runJourneyBuilder(
  Map<String, String> appSources, {
  BuilderOptions options = BuilderOptions.empty,
}) async {
  final warnings = <String>[];
  final severe = <String>[];
  final result = await testBuilder(
    ductusJourneyBuilder(options),
    {...ductusSources(), ...appSources},
    rootPackage: 'app',
    // flattenOutput: outputs are readable under their regular AssetId.
    flattenOutput: true,
    onLog: (record) {
      if (record.level.name == 'WARNING') warnings.add(record.message);
      if (record.level.name == 'SEVERE') severe.add(record.message);
    },
  );
  final artifactId = AssetId('app', 'ductus_builder.g.json');
  final testing = result.readerWriter.testing;
  return BuilderRun(
    artifact: testing.exists(artifactId) ? testing.readString(artifactId) : null,
    warnings: warnings,
    severe: severe,
    succeeded: result.succeeded,
  );
}

/// Normalizes the builder artifact's meta.adapters name to the CLI scan's —
/// the only intended difference under the parity guarantee.
String normalizeAdapterName(String artifact) => artifact.replaceFirst(
    '"name": "dart-builder"', '"name": "dart"');

void main() {
  group('DuctusJourneyBuilder', () {
    test(
        'parity guarantee: artifact byte-identical to the parse-only '
        'adapter output except for the meta.adapters name '
        '(full_app fixture, without resolution)', () async {
      final fixture = p.join(
          Directory.current.path, 'test', 'fixtures', 'full_app');
      final sources = <String, String>{};
      for (final entity in Directory(p.join(fixture, 'lib')).listSync()) {
        if (entity is File && entity.path.endsWith('.dart')) {
          sources['app|lib/${p.basename(entity.path)}'] =
              entity.readAsStringSync();
        }
      }

      final run = await runJourneyBuilder(sources);
      final adapterOutput =
          runAdapter(projectDir: fixture, warn: (_) {});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      expect(run.artifact, isNotNull);
      expect(normalizeAdapterName(run.artifact!), adapterOutput);
    });

    test(
        'parity guarantee: purely literal annotations with a ductus import '
        '⇒ byte-identical to the parse-only adapter except for the '
        'meta.adapters name', () async {
      const source = '''
import 'package:ductus/ductus.dart';

// @journey:flow id="auth" title="Anmeldung" start="login"

@JourneyScreen(
  id: 'login',
  title: 'Anmeldung',
  flow: 'auth',
  tags: ['auth', 'entry'],
)
class LoginScreen {
  @JourneyAction(
    label: 'Anmelden',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
  )
  void submit() {}
}
''';

      // The same source as a real project directory for the adapter CLI.
      final projectDir =
          Directory.systemTemp.createTempSync('ductus_parity_');
      addTearDown(() => projectDir.deleteSync(recursive: true));
      final libDir = Directory(p.join(projectDir.path, 'lib'))..createSync();
      File(p.join(libDir.path, 'main.dart')).writeAsStringSync(source);

      final run = await runJourneyBuilder({'app|lib/main.dart': source});
      final adapterOutput =
          runAdapter(projectDir: projectDir.path, warn: (_) {});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      expect(run.artifact, isNotNull);
      expect(normalizeAdapterName(run.artifact!), adapterOutput);
      expect(utf8.encode(normalizeAdapterName(run.artifact!)),
          utf8.encode(adapterOutput));
    });

    test(
        'resolution: non-literal constant arguments (string, list, '
        'trigger) are resolved', () async {
      const source = '''
import 'package:ductus/ductus.dart';

abstract class AppStrings {
  static const String loginTitle = 'Anmeldung';
  static const List<String> loginTags = ['auth', 'entry'];
  static const JourneyTrigger submitTrigger = JourneyTrigger.submit;
  static const String dashboardId = 'dashboard';
}

@JourneyScreen(id: 'login', title: AppStrings.loginTitle, tags: AppStrings.loginTags)
class LoginScreen {
  @JourneyAction(label: 'Anmelden', to: AppStrings.dashboardId, trigger: AppStrings.submitTrigger)
  void submit() {}
}
''';

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      expect(run.warnings, isEmpty);
      expect(run.artifact, isNotNull);

      final graph = jsonDecode(run.artifact!) as Map<String, dynamic>;
      final nodes = (graph['nodes'] as List).cast<Map<String, dynamic>>();
      final login = nodes.singleWhere((n) => n['id'] == 'login');
      expect(login['title'], 'Anmeldung');
      expect(login['tags'], ['auth', 'entry']); // sorted

      final edges = (graph['edges'] as List).cast<Map<String, dynamic>>();
      final edge = edges.singleWhere((e) => e['id'] == 'e_login_dashboard');
      expect(edge['to'], 'dashboard');
      expect(edge['trigger'], 'submit');
      // from inference via the screen id read through resolution.
      expect(edge['from'], 'login');
    });

    test(
        'unresolvable expression: same error semantics as parse-only '
        '(build fails, no artifact)', () async {
      const source = '''
import 'package:ductus/ductus.dart';

abstract class AppStrings {
  static String get runtimeTitle => 'Anmeldung';
}

@JourneyScreen(id: 'login', title: AppStrings.runtimeTitle)
class LoginScreen {}
''';

      // Reference: the exact error messages of the parse-only extractor.
      final expectedErrors = <String>[];
      extractAnnotations(
          scanSource(source), WarnLog().call, expectedErrors);
      expect(expectedErrors, isNotEmpty);

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isFalse);
      expect(run.artifact, isNull);
      // build_runner prefixes the messages with the builder context —
      // what matters is the byte-identical adapter message inside.
      for (final message in expectedErrors) {
        expect(run.severe, contains(contains(message)));
      }
    });

    test(
        'unresolvable tags list: same warning semantics as parse-only '
        '(warning, tags ignored)', () async {
      const source = '''
import 'package:ductus/ductus.dart';

List<String> runtimeTags() => ['x'];

@JourneyScreen(id: 'login', title: 'Anmeldung', tags: runtimeTags)
class LoginScreen {}
''';

      // Reference: the exact warnings of the parse-only extractor.
      final expectedWarnings = WarnLog();
      extractAnnotations(scanSource(source), expectedWarnings.call, []);
      expect(expectedWarnings.messages, isNotEmpty);

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      // As above: ignore the builder context prefix, compare the message text.
      for (final message in expectedWarnings.messages) {
        expect(run.warnings, contains(contains(message)));
      }
      final graph = jsonDecode(run.artifact!) as Map<String, dynamic>;
      final login = ((graph['nodes'] as List).cast<Map<String, dynamic>>())
          .singleWhere((n) => n['id'] == 'login');
      expect(login.containsKey('tags'), isFalse);
    });

    test(
        'include pattern without matches (e.g. outside the target sources): '
        'warning instead of silent ignoring', () async {
      const source = '''
import 'package:ductus/ductus.dart';

@JourneyScreen(id: 'login', title: 'Anmeldung')
class LoginScreen {}
''';

      final run = await runJourneyBuilder(
        {'app|lib/main.dart': source},
        options: BuilderOptions({
          'include': ['lib/**', 'extra/**'],
        }),
      );

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      expect(run.artifact, isNotNull);
      // The pattern outside the visible sources triggers a warning …
      expect(
        run.warnings,
        contains(allOf(
          contains('include pattern "extra/**"'),
          contains('target sources'),
        )),
      );
      // … the matching pattern does not.
      expect(run.warnings.where((w) => w.contains('lib/**')), isEmpty);
    });

    test('artifact: schemaVersion and meta.adapters (dart-builder)', () async {
      const source = '''
import 'package:ductus/ductus.dart';

@JourneyScreen(id: 'login', title: 'Anmeldung')
class LoginScreen {}
''';

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      final graph = jsonDecode(run.artifact!) as Map<String, dynamic>;
      expect(graph['schemaVersion'], '1.0');
      expect(
        (graph['meta'] as Map<String, dynamic>)['adapters'],
        [
          {'name': 'dart-builder', 'version': adapterVersion}
        ],
      );
      // Canonical form (NFR2): LF + trailing newline.
      expect(run.artifact!.endsWith('}\n'), isTrue);
      expect(run.artifact, isNot(contains('\r')));
      expect(run.artifact, isNot(contains('generatedAt')));
    });
  });
}
