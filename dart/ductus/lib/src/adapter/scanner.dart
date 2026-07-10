/// Sammelt und parst die .dart-Dateien des Zielprojekts (parse-only, ohne
/// Resolution — dadurch ist kein `pub get` im Zielprojekt nötig).
library;

import 'dart:io';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/source/line_info.dart';
import 'package:glob/glob.dart';
import 'package:path/path.dart' as p;

import 'graph_model.dart';
import 'config.dart';

/// Eine geparste Quelldatei. [relPath] ist projekt-relativ mit
/// '/'-Separatoren und dient überall als deterministischer Sortierschlüssel.
class ScannedFile {
  final String relPath;
  final String content;
  final CompilationUnit unit;
  final LineInfo lineInfo;

  const ScannedFile({
    required this.relPath,
    required this.content,
    required this.unit,
    required this.lineInfo,
  });

  int lineOf(int offset) => lineInfo.getLocation(offset).lineNumber;

  SourceRef refAt(int offset, {String? symbol}) =>
      SourceRef(file: relPath, line: lineOf(offset), symbol: symbol);
}

/// Liefert alle .dart-Dateien unter den include-Mustern, deterministisch nach
/// relativem Pfad sortiert und parse-only analysiert.
List<ScannedFile> scanProject(
  String projectDir,
  AdapterConfig config,
  void Function(String) warn,
) {
  final root = Directory(projectDir);
  if (!root.existsSync()) {
    throw AdapterException(['Projektverzeichnis nicht gefunden: $projectDir']);
  }
  final globs = config.include
      .map((pattern) => Glob(pattern, context: p.posix))
      .toList();

  final relPaths = <String>[];
  for (final entity in root.listSync(recursive: true, followLinks: false)) {
    if (entity is! File || !entity.path.endsWith('.dart')) continue;
    final rel = p.posix.joinAll(p.split(p.relative(entity.path, from: root.path)));
    if (globs.any((g) => g.matches(rel))) relPaths.add(rel);
  }
  relPaths.sort();

  final files = <ScannedFile>[];
  for (final rel in relPaths) {
    final abs = p.join(root.path, p.joinAll(p.posix.split(rel)));
    final content = File(abs).readAsStringSync();
    final result = parseString(
      content: content,
      path: abs,
      throwIfDiagnostics: false,
    );
    if (result.errors.isNotEmpty) {
      // Best effort: Datei mit Syntaxfehlern trotzdem verwenden, aber melden.
      warn('Warnung: $rel enthält Syntaxfehler; Analyse ist best effort.');
    }
    files.add(ScannedFile(
      relPath: rel,
      content: content,
      unit: result.unit,
      lineInfo: result.lineInfo,
    ));
  }
  return files;
}
