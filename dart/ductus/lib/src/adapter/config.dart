/// Adapter configuration from `--config <json-file>`.
library;

import 'dart:convert';
import 'dart:io';

import 'graph_model.dart';

class AdapterConfig {
  /// Active derivation paths (path C); default: both enabled.
  final List<String> deriveFrom;

  /// Glob patterns relative to the project directory; default: `lib/**`.
  final List<String> include;

  /// Path D: instead of scanning itself, pass through the build_runner
  /// artifact `ductus_builder.g.json` (equivalent to the CLI flag
  /// `--from-builder`; the flag wins).
  final bool fromBuilder;

  const AdapterConfig({
    this.deriveFrom = const ['go_router', 'auto_route'],
    this.include = const ['lib/**'],
    this.fromBuilder = false,
  });

  bool get deriveGoRouter => deriveFrom.contains('go_router');
  bool get deriveAutoRoute => deriveFrom.contains('auto_route');

  static AdapterConfig load(String? configPath) {
    if (configPath == null) return const AdapterConfig();
    final file = File(configPath);
    if (!file.existsSync()) {
      throw AdapterException(['Configuration file not found: $configPath']);
    }
    final Object? raw;
    try {
      raw = jsonDecode(file.readAsStringSync());
    } on FormatException catch (e) {
      throw AdapterException(['Invalid JSON in $configPath: ${e.message}']);
    }
    if (raw is! Map<String, Object?>) {
      throw AdapterException(['$configPath: expected a JSON object.']);
    }
    return AdapterConfig(
      deriveFrom: _stringList(raw, 'deriveFrom', configPath) ??
          const ['go_router', 'auto_route'],
      include: _stringList(raw, 'include', configPath) ?? const ['lib/**'],
      fromBuilder: _boolValue(raw, 'fromBuilder', configPath) ?? false,
    );
  }

  static List<String>? _stringList(
      Map<String, Object?> map, String key, String path) {
    final value = map[key];
    if (value == null) return null;
    if (value is! List || value.any((e) => e is! String)) {
      throw AdapterException(['$path: "$key" must be a list of strings.']);
    }
    return value.cast<String>();
  }

  static bool? _boolValue(Map<String, Object?> map, String key, String path) {
    final value = map[key];
    if (value == null) return null;
    if (value is! bool) {
      throw AdapterException(['$path: "$key" must be true or false.']);
    }
    return value;
  }
}
