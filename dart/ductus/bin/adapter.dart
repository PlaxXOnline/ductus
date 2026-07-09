/// Adapter-CLI (SPEC §7, DD §H):
///
///     dart run ductus:adapter --project <dir> [--config <json>] [--no-debug-file]
///
/// stdout: genau ein kanonisches Graph-JSON; Diagnostik auf stderr;
/// Exit 0 Erfolg / ≠0 Fehler.
library;

import 'dart:convert';
import 'dart:io';

import 'package:args/args.dart';
import 'package:path/path.dart' as p;

import 'package:ductus/src/adapter/config.dart';
import 'package:ductus/src/adapter/graph_model.dart';
import 'package:ductus/src/adapter/runner.dart';

void main(List<String> argv) {
  final parser = ArgParser()
    ..addOption('project', help: 'Projektverzeichnis (Pflicht).')
    ..addOption('config', help: 'Pfad zu einer JSON-Konfigurationsdatei.')
    ..addFlag('debug-file',
        defaultsTo: true,
        help: 'Schreibt ductus_graph.g.json ins Projektverzeichnis '
            '(--no-debug-file schaltet ab).');

  final ArgResults args;
  try {
    args = parser.parse(argv);
  } on FormatException catch (e) {
    stderr.writeln('Fehler: ${e.message}');
    stderr.writeln(parser.usage);
    exitCode = 64;
    return;
  }

  final project = args['project'] as String?;
  if (project == null || project.isEmpty) {
    stderr.writeln('Fehler: --project <dir> ist erforderlich.');
    stderr.writeln(parser.usage);
    exitCode = 64;
    return;
  }
  // Absolut auflösen, damit der Aufruf aus beliebigem cwd funktioniert.
  final projectDir = p.normalize(p.absolute(project));

  try {
    final config = AdapterConfig.load(args['config'] as String?);
    final json = runAdapter(
      projectDir: projectDir,
      config: config,
      warn: stderr.writeln,
    );
    stdout.add(utf8.encode(json));
    if (args['debug-file'] as bool) {
      File(p.join(projectDir, 'ductus_graph.g.json'))
          .writeAsStringSync(json, flush: true);
    }
  } on AdapterException catch (e) {
    e.messages.forEach(stderr.writeln);
    exitCode = 1;
  } on FileSystemException catch (e) {
    stderr.writeln('Fehler: ${e.message} (${e.path ?? projectDir})');
    exitCode = 1;
  }
}
