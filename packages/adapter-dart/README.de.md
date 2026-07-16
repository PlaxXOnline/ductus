# @ductus/adapter-dart

[English](./README.md) | **Deutsch** | [Español](./README.es.md) | [简体中文](./README.zh-CN.md)

Der npm-Wrapper, der den Ductus-Dart-Adapter für [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) startbar macht — die eigentliche Code-Analyse lebt im pub.dev-Paket [`ductus`](https://pub.dev/packages/ductus) und läuft in der Dart-Toolchain.

Dieses Paket enthält **keine Analyse-Logik**. Es stellt nur das Binary `ductus-adapter-dart` bereit, das `dart run ductus:adapter` mit dem passenden Paketkontext aufruft, stdout/stderr und Exit-Code durchreicht und dabei garantiert: **stdout ist genau ein Graph-JSON-Dokument** (pub-Vorspann wie `Resolving dependencies...` wird nach stderr umgeleitet, nichts geht verloren).

**Voraussetzung:** ein installiertes [Dart SDK](https://dart.dev/get-dart) im `PATH` (bei Flutter-Projekten bereits vorhanden). Node.js ≥ 20.

## Installation

```bash
npm install --save-dev @ductus/core @ductus/adapter-dart
```

Zusätzlich muss `ductus:adapter` auf der Dart-Seite auflösbar sein — eine der beiden Optionen genügt:

```bash
# Option 1: im Zielprojekt (empfohlen, versioniert mit dem Projekt)
dart pub add dev:ductus

# Option 2: global, ganz ohne Eintrag im Zielprojekt
dart pub global activate ductus
```

Wenn du die Dart-Annotationen (Weg B, siehe unten) in `lib/` importierst, nimm `ductus` stattdessen als reguläre Dependency auf: `dart pub add ductus`.

## Quickstart mit @ductus/core

```bash
npx ductus init       # legt ductus.config.yaml an
npx ductus extract    # ruft den Dart-Adapter auf → journey-graph.json
npx ductus generate   # LLM (BYOK) → Endnutzer-Doku als MDX oder Website
```

Der relevante Ausschnitt der `ductus.config.yaml` (so erzeugt sie `ductus init`):

```yaml
adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]
```

Mehr zu Konfiguration, LLM-Providern und Ausgabeformaten steht im README von [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Wie @ductus/core den Adapter findet

`ductus extract` löst den Befehl für den Adapter-Eintrag `dart` in dieser Reihenfolge auf (identisch implementiert im Core-Runner und in diesem Wrapper):

| # | Quelle | Verhalten |
|---|--------|-----------|
| 1 | `command:` im Adapter-Eintrag der `ductus.config.yaml` | Gewinnt immer — der konfigurierte Befehl wird unverändert ausgeführt. |
| 2 | Binary `ductus-adapter-dart` (dieses Paket) | Gesucht in `node_modules/.bin` neben der Config, dann im `PATH`. Der Wrapper setzt intern die Kette mit den Stufen 3–5 fort. |
| 3 | Umgebungsvariable `DUCTUS_DART_ADAPTER_DIR` | `dart run ductus:adapter` mit diesem Verzeichnis als Arbeitsverzeichnis — nützlich, wenn weder das Projekt noch pub-global das Paket kennt (z. B. ein Monorepo-Checkout). |
| 4 | Die `pubspec.yaml` des Zielprojekts deklariert `ductus` | `dart run ductus:adapter` direkt im Zielprojekt (`dependencies` oder `dev_dependencies`). |
| 5 | Global aktiviertes Paket (`dart pub global activate ductus`) | `dart pub global run ductus:adapter`; bei einer path-Aktivierung läuft `dart run` direkt im Quellverzeichnis. |

Greift keine Stufe, bricht der Aufruf mit einer Fehlermeldung ab, die die Optionen nennt (`dart pub add dev:ductus`, `dart pub global activate ductus` oder `DUCTUS_DART_ADAPTER_DIR`). Das Zielprojekt braucht also **keine** `ductus`-Dependency, solange eine der anderen Stufen greift.

## Welche Quellen der Adapter versteht

Der Dart-Adapter kombiniert vier Eingabewege zu einem Graphen; manuelle Annotationen überschreiben abgeleitete Werte feldweise:

| Weg | Quelle | Dependency im Zielprojekt? |
|-----|--------|----------------------------|
| A | Kommentar-Konvention `@journey:screen`, `@journey:action`, `@journey:decision`, `@journey:flow` in `//`-/`///`-Kommentaren | Keine — komplett buildfrei |
| B | Dart-Annotationen `@JourneyScreen`, `@JourneyAction`, `@JourneyDecision`, `@JourneyFlow` | `ductus` (nur für den Import, kein Laufzeitverhalten) |
| C | Automatische Ableitung aus `go_router` (`GoRoute` → Screens, `ShellRoute` → Flows, `redirect:` → Decisions, `context.go()/push()/…` → Transitions) und aus `auto_route` (`@RoutePage()` → Screens, best effort) | Keine (nur das Router-Paket selbst) |
| D | build_runner-Artefakt `ductus_builder.g.json` — der Builder aus dem `ductus`-Paket läuft als Build-Schritt mit und löst auch nicht-literale Konstanten auf; der Adapter reicht das Artefakt mit `--from-builder` bzw. dem Config-Key `fromBuilder: true` durch | `ductus` + `build_runner` |

Details, Beispiele und Best Practices zu allen vier Wegen: [README des `ductus`-Pakets](https://pub.dev/packages/ductus). Zwei lauffähige Demo-Apps (Weg A pur sowie Weg B+C kombiniert) liegen unter [examples/](https://github.com/PlaxXOnline/ductus/tree/main/examples).

## Direkter Aufruf (optional)

Normalerweise startet `ductus extract` den Wrapper automatisch. Manuell:

```bash
ductus-adapter-dart --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

- `--project <dir>` (Pflicht): das zu analysierende Dart-/Flutter-Projekt.
- `--config <json-file>`: Adapter-Konfiguration als JSON-Objekt mit den Schlüsseln `deriveFrom` (Default `["go_router", "auto_route"]`), `include` (Glob-Muster relativ zum Projekt, Default `["lib/**"]`) und `fromBuilder` (Default `false`). `@ductus/core` erzeugt diese Datei automatisch aus dem Adapter-Eintrag der `ductus.config.yaml`.
- `--no-debug-file`: unterdrückt die Debug-Datei `ductus_graph.g.json` im Projektverzeichnis.
- `--from-builder`: reicht das build_runner-Artefakt `ductus_builder.g.json` durch, statt selbst zu scannen (Weg D; äquivalent zum Config-Key `fromBuilder: true`, das Flag gewinnt).

stdout ist genau ein kanonisches Graph-JSON; Warnungen und Diagnostik gehen auf stderr. Der Exit-Code des Dart-Adapters wird unverändert durchgereicht.

## Links

- [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) — CLI, Orchestrator, LLM-Schicht (BYOK), MDX-/Website-Output
- [`ductus` auf pub.dev](https://pub.dev/packages/ductus) — Annotationen, Adapter-CLI, build_runner-Builder ([Quellcode](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus))
- [Ductus-Repository](https://github.com/PlaxXOnline/ductus)

## Lizenz

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-dart/LICENSE)
