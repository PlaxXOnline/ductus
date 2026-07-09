import 'dart:convert';
import 'dart:io';

import 'package:build/build.dart';
import 'package:build_test/build_test.dart';
import 'package:ductus/adapter.dart';
import 'package:ductus/builder.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import 'test_util.dart';

/// Ergebnis eines Builder-Laufs im build_test-Harness.
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

/// Die echten Annotations-Quellen des Pakets als Test-Assets, damit der
/// Resolver `package:ductus/ductus.dart` im Zielpaket auflösen kann.
Map<String, String> ductusSources() => {
      'ductus|lib/ductus.dart': File('lib/ductus.dart').readAsStringSync(),
      'ductus|lib/src/annotations.dart':
          File(p.join('lib', 'src', 'annotations.dart')).readAsStringSync(),
    };

/// Führt den Journey-Builder auf dem In-Memory-Paket `app` aus.
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
    // flattenOutput: Outputs sind unter ihrer regulären AssetId lesbar.
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

/// Normalisiert den meta.adapters-Namen des Builder-Artefakts auf den des
/// CLI-Scans — der einzige gewollte Unterschied bei der Paritätsgarantie.
String normalizeAdapterName(String artifact) => artifact.replaceFirst(
    '"name": "dart-builder"', '"name": "dart"');

void main() {
  group('DuctusJourneyBuilder', () {
    test(
        'Paritäts-Garantie: Artefakt byte-identisch zur parse-only-'
        'Adapterausgabe bis auf den meta.adapters-Namen '
        '(full_app-Fixture, ohne Auflösung)', () async {
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
        'Paritäts-Garantie: rein literale Annotationen mit ductus-Import '
        '⇒ byte-identisch zum parse-only-Adapter bis auf den '
        'meta.adapters-Namen', () async {
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

      // Dieselbe Quelle als echtes Projektverzeichnis für das Adapter-CLI.
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
        'Resolution: nicht-literale konstante Argumente (String, Liste, '
        'Trigger) werden aufgelöst', () async {
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
      expect(login['tags'], ['auth', 'entry']); // sortiert

      final edges = (graph['edges'] as List).cast<Map<String, dynamic>>();
      final edge = edges.singleWhere((e) => e['id'] == 'e_login_dashboard');
      expect(edge['to'], 'dashboard');
      expect(edge['trigger'], 'submit');
      // from-Inferenz über die per Resolution gelesene Screen-Id.
      expect(edge['from'], 'login');
    });

    test(
        'Unauflösbarer Ausdruck: gleiche Fehlersemantik wie parse-only '
        '(Build schlägt fehl, kein Artefakt)', () async {
      const source = '''
import 'package:ductus/ductus.dart';

abstract class AppStrings {
  static String get runtimeTitle => 'Anmeldung';
}

@JourneyScreen(id: 'login', title: AppStrings.runtimeTitle)
class LoginScreen {}
''';

      // Referenz: exakte Fehlermeldungen des parse-only-Extraktors.
      final expectedErrors = <String>[];
      extractAnnotations(
          scanSource(source), WarnLog().call, expectedErrors);
      expect(expectedErrors, isNotEmpty);

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isFalse);
      expect(run.artifact, isNull);
      // build_runner stellt den Meldungen den Builder-Kontext voran —
      // entscheidend ist die byte-gleiche Adapter-Meldung darin.
      for (final message in expectedErrors) {
        expect(run.severe, contains(contains(message)));
      }
    });

    test(
        'Unauflösbare tags-Liste: gleiche Warnsemantik wie parse-only '
        '(Warnung, tags ignoriert)', () async {
      const source = '''
import 'package:ductus/ductus.dart';

List<String> runtimeTags() => ['x'];

@JourneyScreen(id: 'login', title: 'Anmeldung', tags: runtimeTags)
class LoginScreen {}
''';

      // Referenz: exakte Warnungen des parse-only-Extraktors.
      final expectedWarnings = WarnLog();
      extractAnnotations(scanSource(source), expectedWarnings.call, []);
      expect(expectedWarnings.messages, isNotEmpty);

      final run = await runJourneyBuilder({'app|lib/main.dart': source});

      expect(run.succeeded, isTrue, reason: run.severe.join('\n'));
      // Wie oben: Builder-Kontext-Präfix ignorieren, Meldungstext vergleichen.
      for (final message in expectedWarnings.messages) {
        expect(run.warnings, contains(contains(message)));
      }
      final graph = jsonDecode(run.artifact!) as Map<String, dynamic>;
      final login = ((graph['nodes'] as List).cast<Map<String, dynamic>>())
          .singleWhere((n) => n['id'] == 'login');
      expect(login.containsKey('tags'), isFalse);
    });

    test(
        'include-Muster ohne Treffer (z. B. außerhalb der Target-Sources): '
        'Warnung statt stillem Ignorieren', () async {
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
      // Das Muster außerhalb der sichtbaren Sources löst eine Warnung aus …
      expect(
        run.warnings,
        contains(allOf(
          contains('include-Muster "extra/**"'),
          contains('Target-Sources'),
        )),
      );
      // … das treffende Muster nicht.
      expect(run.warnings.where((w) => w.contains('lib/**')), isEmpty);
    });

    test('Artefakt: schemaVersion und meta.adapters (dart-builder)', () async {
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
      // Kanonische Form (NFR2): LF + abschließender Zeilenumbruch.
      expect(run.artifact!.endsWith('}\n'), isTrue);
      expect(run.artifact, isNot(contains('\r')));
      expect(run.artifact, isNot(contains('generatedAt')));
    });
  });
}
