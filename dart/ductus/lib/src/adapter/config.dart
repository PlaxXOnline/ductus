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

  /// Weg D: statt selbst zu scannen das build_runner-Artefakt
  /// `ductus_builder.g.json` durchreichen (äquivalent zum CLI-Flag
  /// `--from-builder`; das Flag gewinnt).
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
      fromBuilder: _boolValue(raw, 'fromBuilder', configPath) ?? false,
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

  static bool? _boolValue(Map<String, Object?> map, String key, String path) {
    final value = map[key];
    if (value == null) return null;
    if (value is! bool) {
      throw AdapterException(['$path: "$key" muss true oder false sein.']);
    }
    return value;
  }
}
