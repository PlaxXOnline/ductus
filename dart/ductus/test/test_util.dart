/// Gemeinsame Test-Helfer.
library;

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:ductus/adapter.dart';

/// Parst Quelltext zu einer [ScannedFile] (parse-only, wie der Scanner).
ScannedFile scanSource(String source, {String path = 'lib/main.dart'}) {
  final result = parseString(content: source, throwIfDiagnostics: false);
  return ScannedFile(
    relPath: path,
    content: source,
    unit: result.unit,
    lineInfo: result.lineInfo,
  );
}

/// Sammelt Warnungen statt stderr.
class WarnLog {
  final List<String> messages = [];
  void call(String message) => messages.add(message);
}
