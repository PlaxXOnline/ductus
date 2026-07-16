/// Adapter CLI of the Ductus Dart adapter:
///
///     dart run ductus:adapter --project <dir> [--config <json-file>]
///         [--no-debug-file] [--from-builder]
///
/// stdout: exactly one canonical graph JSON; diagnostics on stderr;
/// exit 0 on success / non-zero on failure.
library;

import 'dart:convert';
import 'dart:io';

import 'package:args/args.dart';
import 'package:path/path.dart' as p;

import 'package:ductus/src/adapter/config.dart';
import 'package:ductus/src/adapter/from_builder.dart';
import 'package:ductus/src/adapter/graph_model.dart';
import 'package:ductus/src/adapter/runner.dart';

void main(List<String> argv) {
  final parser = ArgParser()
    ..addOption('project', help: 'Project directory (required).')
    ..addOption('config', help: 'Path to a JSON configuration file.')
    ..addFlag('debug-file',
        defaultsTo: true,
        help: 'Writes ductus_graph.g.json into the project directory '
            '(--no-debug-file disables it).')
    ..addFlag('from-builder',
        negatable: false,
        help: 'Path D: passes through the build_runner artifact '
            'ductus_builder.g.json from the project directory instead of '
            'scanning itself (equivalent: config key "fromBuilder": true).');

  final ArgResults args;
  try {
    args = parser.parse(argv);
  } on FormatException catch (e) {
    stderr.writeln('Error: ${e.message}');
    stderr.writeln(parser.usage);
    exitCode = 64;
    return;
  }

  final project = args['project'] as String?;
  if (project == null || project.isEmpty) {
    stderr.writeln('Error: --project <dir> is required.');
    stderr.writeln(parser.usage);
    exitCode = 64;
    return;
  }
  // Resolve to an absolute path so the CLI works from any cwd.
  final projectDir = p.normalize(p.absolute(project));

  try {
    final config = AdapterConfig.load(args['config'] as String?);

    // Path D: pass through the build_runner builder's artifact — no own
    // scan, no debug file (the artifact already lives in the project).
    // The flag wins over the config key.
    if ((args['from-builder'] as bool) || config.fromBuilder) {
      stdout.add(utf8.encode(readBuilderArtifact(projectDir)));
      return;
    }

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
    stderr.writeln('Error: ${e.message} (${e.path ?? projectDir})');
    exitCode = 1;
  }
}
