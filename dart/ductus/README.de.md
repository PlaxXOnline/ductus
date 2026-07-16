# ductus

[English](./README.md) | **Deutsch** | [Español](./README.es.md) | [简体中文](./README.zh-CN.md)

**Endnutzer-Dokumentation direkt aus deinem Flutter-Code.** `ductus` liefert
Journey-Annotationen und ein Adapter-CLI, die aus deiner App einen
User-Journey-Graphen extrahieren — die [Ductus-CLI (`@ductus/core`)](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
macht daraus per LLM gepflegte Doku als MDX-Dateien oder statische Website,
versioniert mit deinem Code.

- **Vier Eingabewege, frei kombinierbar:** `@journey:`-Kommentare (buildfrei),
  Dart-Annotationen, automatische Ableitung aus `go_router`/`auto_route`,
  build_runner-Builder.
- **Null Laufzeitkosten:** Die Annotationen sind reine Marker — kein
  Laufzeitverhalten, kein zusätzlicher Code in deinem App-Binary.
- **Kein Build nötig:** Der Adapter analysiert parse-only; das Zielprojekt
  braucht weder `pub get` noch einen Build.
- **Deterministisch:** Die Ausgabe ist kanonisches, diff-stabiles JSON —
  ideal für Code-Review und CI.

## Installation

Für Annotationen in deinem App-Code (`@JourneyScreen` & Co. in `lib/`):

```bash
dart pub add ductus
```

Nur das Adapter-CLI, ohne Annotationen im Code:

```bash
dart pub add dev:ductus
```

Komplett ohne Dependency im Projekt (Kommentar-Konvention, siehe unten):

```bash
dart pub global activate ductus
```

## Quickstart: annotieren → extrahieren → generieren

```dart
import 'package:ductus/ductus.dart';

@JourneyScreen(
  id: 'login',
  title: 'Sign in',
  flow: 'auth',
  description: 'Screen where the user signs in.',
)
class LoginScreen extends StatelessWidget {
  @JourneyAction(
    label: 'Sign in',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'credentials valid',
  )
  void onSubmit() { /* … */ }
}

@JourneyFlow(id: 'auth', title: 'Login & registration', start: 'login')
class AuthFlow {}
```

Dann mit der Ductus-CLI (Node.js ≥ 20):

```bash
npm install -g @ductus/core @ductus/adapter-dart

ductus init        # legt ductus.config.yaml an, erkennt pubspec.yaml + Router
ductus extract     # Graph erzeugen + validieren → journey-graph.json
ductus generate    # LLM-Doku (BYOK) → docs/*.mdx oder statische Website
```

Für `generate` genügt dein eigener API-Key (Anthropic, OpenAI oder ein
kompatibler Endpoint) in der Umgebungsvariable `DUCTUS_LLM_API_KEY`;
`extract` läuft komplett offline. Zum Ausprobieren ohne Key:
`llm.provider: mock` in der `ductus.config.yaml`.

Lauffähige Beispiele:
[flutter_go_router_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_go_router_demo)
(Ableitung + Annotationen) und
[flutter_comment_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_comment_demo)
(nur Kommentare, keine Dependency).

## Die Annotations-API

Alle Annotationen kommen aus `package:ductus/ductus.dart`:

| Annotation | Parameter (Pflicht **fett**) | Wirkung im Graphen |
|---|---|---|
| `@JourneyScreen` | **`id`**, **`title`**, `flow`, `description`, `tags` | Screen-Node; auf Klassen |
| `@JourneyAction` | **`label`**, **`to`**, `from`, `id`, `trigger`, `condition` | Transition (Edge); auf Methoden, Funktionen und Feldern |
| `@JourneyDecision` | **`id`**, **`title`**, `flow`, `description`, `tags` | Decision-Node (Verzweigungspunkt) |
| `@JourneyFlow` | **`id`**, **`title`**, **`start`**, `description` | Benannter Flow; `start` muss die ID eines Screens sein |

- `trigger` ist ein `JourneyTrigger`: `tap` (Default), `submit`, `auto`,
  `back`, `deeplink`, `system`.
- Fehlt bei `@JourneyAction` das `from`, gilt die umschließende, als Screen
  bekannte Klasse.
- Ohne Action-`id` wird deterministisch `e_<from>_<to>` generiert.
- Argumente sind String-Literale; wenn du konstante Referenzen wie
  `title: MyConstants.title` brauchst, nutze den build_runner-Builder (unten).

## Buildfrei: die `@journey:`-Kommentar-Konvention

Gleichwertig zu den Annotationen, funktioniert in `//`- und
`///`-Kommentaren — das Projekt braucht `ductus` dann nicht einmal als
Dependency:

```dart
// @journey:screen id="dashboard" title="Overview"
//   description="Central overview after signing in."
class DashboardScreen { … }
```

Ein Block beginnt mit `@journey:<screen|action|decision|flow>`, Paare sind
`key="value"` (`\"` escaped ein Anführungszeichen), Fortsetzung in unmittelbar
folgenden Kommentarzeilen; er endet an der ersten Nicht-Kommentar-Zeile oder
am nächsten `@journey:`-Block. Pflichtfelder sind dieselben wie bei den
Annotationen; unbekannte Keys werden mit Warnung ignoriert, `tags` ist
kommasepariert.

Setup ganz ohne Projekt-Dependency:

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

Die Ductus-CLI findet den global aktivierten Adapter über
`dart pub global run`; alternativ zeigt die Umgebungsvariable
`DUCTUS_DART_ADAPTER_DIR` auf ein Verzeichnis mit dem Adapter-Paket.

## Automatische Ableitung aus go_router / auto_route

Ohne jede Annotation bekommst du schon einen brauchbaren Graphen:

| Quelle | wird zu |
|---|---|
| `GoRoute` | Screen-Node |
| `ShellRoute` | Flow |
| `redirect:` | Decision-Node |
| `context.go()` / `push()` / `goNamed()` / … mit String-Literal | Transition |
| `@RoutePage()`-Klassen (auto_route) | Screen-Node |

Abgeleitete Elemente tragen `source: "derived"`; manuelle Annotationen mit
derselben ID überschreiben abgeleitete Werte feldweise. Zwei manuelle Quellen
mit widersprüchlichen Werten sind ein Fehler, der beide Fundstellen meldet.
Abgeleitete IDs sind der Routen-`name` bzw. der Pfad-Slug
(`/users/:id/edit` ⇒ `users-edit`).

Die `auto_route`-Ableitung ist ausdrücklich **best effort**: erkannt werden
nur `@RoutePage()`-Screens und die Pfadtabelle, keine Navigations-Kanten —
Transitions ergänzt du über `@JourneyAction` bzw. `@journey:action`.

Welche Ableitungen laufen, steuert `deriveFrom` (Default: beide) — in der
`ductus.config.yaml` unter `adapters:` oder als `--config`-JSON des
Adapter-CLI.

## Der build_runner-Builder

Für Projekte, die ohnehin `build_runner` fahren: Der Builder
`ductus:journey_builder` läuft als Build-Schritt mit und schreibt den Graphen
als `ductus_builder.g.json` in den Projekt-Root. Sein Mehrwert ist
**Resolution**: nicht-literale konstante Annotation-Argumente
(z. B. `title: MyConstants.title`) werden über den resolved AST aufgelöst,
statt als Fehler/Warnung abgelehnt zu werden.

```bash
dart pub add ductus dev:build_runner
dart run build_runner build
# → ductus_builder.g.json im Projekt-Root
```

Der Builder ist über `auto_apply: dependents` automatisch aktiv; eine eigene
`build.yaml` braucht das Projekt nur für Optionen — unterstützt werden
`deriveFrom` und `include`, mit denselben Defaults wie beim Adapter-CLI:

```yaml
targets:
  $default:
    builders:
      ductus:journey_builder:
        options:
          deriveFrom: [go_router]
          include: [lib/**]
```

In die Pipeline gelangt das Artefakt mit `--from-builder` — das Adapter-CLI
prüft dann nur die `schemaVersion` und reicht die Datei durch; es findet kein
eigener Scan statt:

```bash
dart run ductus:adapter --project . --from-builder
```

bzw. in der `ductus.config.yaml`:

```yaml
adapters:
  - dart:
      project: .
      fromBuilder: true
```

Zu beachten:

- `ductus_builder.g.json` ist nur so aktuell wie der letzte
  build_runner-Lauf — vor `ductus extract` also `dart run build_runner build`
  ausführen (oder `watch` laufen lassen). Fehlt die Datei, bricht
  `--from-builder` mit einem Hinweis ab.
- Der Builder sieht nur Dateien der build_runner-Target-Sources (Default
  u. a. `lib/`); `include`-Muster außerhalb davon liefern eine Warnung ohne
  Treffer — dann `targets.$default.sources` erweitern oder das Adapter-CLI
  nutzen.
- Bei rein literalen Annotationen ist das Ergebnis byte-identisch mit dem
  Adapter-CLI — bis auf den `meta.adapters`-Namen (`dart-builder` statt
  `dart`).
- `ductus_builder.g.json` gehört in die `.gitignore` (Build-Artefakt) —
  nicht zu verwechseln mit `ductus_graph.g.json`, der Debug-Datei des
  Adapter-CLI.

## Das Adapter-CLI

```
dart run ductus:adapter --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

| Option | Bedeutung |
|---|---|
| `--project <dir>` | Projektverzeichnis (Pflicht) |
| `--config <file>` | JSON-Konfigurationsdatei, z. B. `{"deriveFrom": ["go_router"], "include": ["lib/**"]}` (Defaults: beide Ableitungen an, `lib/**`) |
| `--no-debug-file` | Unterdrückt die Debug-Datei `ductus_graph.g.json` im Projektverzeichnis |
| `--from-builder` | Reicht `ductus_builder.g.json` durch, statt selbst zu scannen (äquivalent: Config-Key `"fromBuilder": true`; das Flag gewinnt) |

Verhalten: stdout ist genau ein kanonisches Graph-JSON (deterministisch,
diff-stabil), Warnungen und Hinweise gehen auf stderr; Exit 0 bei Erfolg,
≠ 0 bei Fehlern. Die Analyse ist parse-only — das Zielprojekt braucht weder
`pub get` noch einen Build; einzig `--from-builder` setzt einen vorherigen
build_runner-Lauf voraus.

Wichtig für die parse-only-Wege (Kommentare, Annotationen, Ableitung):
Pflichtfelder (`id`, `title`, `label`, `to`, `start`) und ein explizites
`from` müssen String-Literale sein — sonst bricht der Adapter mit Fehler ab.
Nicht literal lesbare optionale Felder entfallen mit Warnung; ein nicht
lesbarer `trigger` fällt mit Warnung auf `tap` zurück. Navigationsaufrufe
werden nur mit String-Literal-Argument (`context.go('/settings')`) als
Transition-Kandidaten erkannt.

## Zusammenspiel mit der Ductus-CLI

Die Node-Seite orchestriert den Adapter und macht aus dem Graphen Doku:

| Befehl (`@ductus/core`) | Zweck |
|---|---|
| `ductus init` | Legt `ductus.config.yaml` an; erkennt `pubspec.yaml` (App-Name, go_router/auto_route) |
| `ductus extract` | Ruft den Dart-Adapter auf, validiert und schreibt `journey-graph.json` |
| `ductus generate` | Erzeugt per LLM (BYOK) MDX-Dateien oder eine statische Website; inkl. Faithfulness-Check |
| `ductus check` | Prüft Graph-Validität und Faithfulness, ohne Dateien zu schreiben (CI) |
| `ductus graph` | Gibt den Graphen als Mermaid aus; `--open` rendert ihn als HTML im Browser |
| `ductus help [command]` | Gibt eine CLI-Übersicht oder die Hilfe zu einem bestimmten Befehl aus |

Generierte Dokumentation ist standardmäßig Englisch (`app.locale: en`, Voice
`en-you`); für deutsche Endnutzer-Doku setzt du `style.voice` auf
`formal-sie` oder `informal-du`.

Mehr dazu im [Repo-README](https://github.com/PlaxXOnline/ductus) und in der
[Dokumentation von `@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Lizenz

MIT — siehe [LICENSE](https://github.com/PlaxXOnline/ductus/blob/main/dart/ductus/LICENSE).
