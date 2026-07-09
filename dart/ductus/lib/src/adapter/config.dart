/// Adapter-Konfiguration aus `--config <json-file>` (DD §H).
library;

import 'dart:convert';
import 'dart:io';

import 'graph_model.dart';

class AdapterConfig {
  /// Aktive Ableitungswege (Weg C); Default: beide an.
  final List<String> deriveFrom;

  /// Glob-Muster relativ zum Projektverzeichnis; Default: `lib/**`.
  final List<String> include;

  const AdapterConfig({
    this.deriveFrom = const ['go_router', 'auto_route'],
    this.include = const ['lib/**'],
  });

  bool get deriveGoRouter => deriveFrom.contains('go_router');
  bool get deriveAutoRoute => deriveFrom.contains('auto_route');

  static AdapterConfig load(String? configPath) {
    if (configPath == null) return const AdapterConfig();
    final file = File(configPath);
    if (!file.existsSync()) {
      throw AdapterException(['Konfigurationsdatei nicht gefunden: $configPath']);
    }
    final Object? raw;
    try {
      raw = jsonDecode(file.readAsStringSync());
    } on FormatException catch (e) {
      throw AdapterException(['Ungültiges JSON in $configPath: ${e.message}']);
    }
    if (raw is! Map<String, Object?>) {
      throw AdapterException(['$configPath: erwartet ein JSON-Objekt.']);
    }
    return AdapterConfig(
      deriveFrom: _stringList(raw, 'deriveFrom', configPath) ??
          const ['go_router', 'auto_route'],
      include: _stringList(raw, 'include', configPath) ?? const ['lib/**'],
    );
  }

  static List<String>? _stringList(
      Map<String, Object?> map, String key, String path) {
    final value = map[key];
    if (value == null) return null;
    if (value is! List || value.any((e) => e is! String)) {
      throw AdapterException(['$path: "$key" muss eine Liste von Strings sein.']);
    }
    return value.cast<String>();
  }
}
