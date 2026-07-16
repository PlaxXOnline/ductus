/// Shared test helpers.
library;

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:ductus/adapter.dart';

/// Parses source text into a [ScannedFile] (parse-only, like the scanner).
ScannedFile scanSource(String source, {String path = 'lib/main.dart'}) {
  final result = parseString(content: source, throwIfDiagnostics: false);
  return ScannedFile(
    relPath: path,
    content: source,
    unit: result.unit,
    lineInfo: result.lineInfo,
  );
}

/// Collects warnings instead of stderr.
class WarnLog {
  final List<String> messages = [];
  void call(String message) => messages.add(message);
}
