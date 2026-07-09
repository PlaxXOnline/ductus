# ductus (Dart)

Journey-Annotationen und Adapter-CLI für [Ductus]: Aus annotiertem Dart/Flutter-Code
(plus `go_router`/`auto_route`-Konfiguration) entsteht ein User-Journey-Graph, aus dem
der Ductus-Core Endnutzer-Dokumentation generiert.

## Annotationen (Weg B)

Die Annotationen sind reine Marker ohne Laufzeitverhalten und ohne Abhängigkeiten:

```dart
import 'package:ductus/ductus.dart';

@JourneyScreen(
  id: 'login',
  title: 'Anmeldung',
  flow: 'auth',
  description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
)
class LoginScreen extends StatelessWidget {
  @JourneyAction(
    label: 'Anmelden',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'Zugangsdaten gültig',
  )
  void onSubmit() { /* … */ }
}

@JourneyFlow(id: 'auth', title: 'Anmeldung & Registrierung', start: 'login')
class AuthFlow {}
```

- `@JourneyScreen(id, title, {flow, description, tags})` — auf Klassen.
- `@JourneyAction(label, to, {from, id, trigger, condition})` — auf Methoden,
  Funktionen und Feldern; erzeugt eine Transition (Edge). Fehlt `from`, gilt die
  umschließende, als Screen bekannte Klasse.
- `@JourneyDecision(id, title, {flow, description, tags})` — Verzweigungspunkte.
- `@JourneyFlow(id, title, start, {description})` — benannte Flows.

## Kommentar-Konvention (Weg A)

Gleichwertig zu den Annotationen, funktioniert in `//`- und `///`-Kommentaren:

```dart
// @journey:screen id="dashboard" title="Übersicht"
//   description="Zentrale Übersicht nach der Anmeldung."
class DashboardScreen { … }
```

Ein Block beginnt mit `@journey:<screen|action|decision|flow>`, Paare sind
`key="value"` (`\"` escaped ein Anführungszeichen), Fortsetzung in unmittelbar
folgenden Kommentarzeilen; er endet an der ersten Nicht-Kommentar-Zeile oder am
nächsten `@journey:`-Block. Unbekannte Keys werden mit Warnung ignoriert;
`tags` ist kommasepariert.

## Automatische Ableitung (Weg C)

Ohne jede Annotation leitet der Adapter aus `go_router` ab: `GoRoute` → Screens,
`ShellRoute` → Flows, `redirect:` → Decisions, `context.go()/push()/goNamed()/…`
→ Transitions; aus `auto_route`: `@RoutePage()`-Klassen → Screens. Abgeleitete
Elemente tragen `source: "derived"` und werden von manuellen Annotationen
feldweise überschrieben. Zwei manuelle Quellen mit widersprüchlichen Werten
sind ein Fehler mit beiden Quellenangaben.

### auto_route: best effort

Die `auto_route`-Ableitung ist ausdrücklich **best effort** (SPEC R6): Der
Adapter erkennt nur `@RoutePage()`-Screens und die Pfadtabelle — Navigations-
Kanten (wer navigiert wohin, unter welcher Bedingung) leitet er daraus nicht
ab. Ergänze Transitions über `@JourneyAction` bzw. `@journey:action`; die
Ableitung ist eine Ergänzung, nie Voraussetzung, und manuelle Annotationen
überschreiben abgeleitete Werte feldweise.

## build_runner-Builder (Weg D)

Für Projekte, die ohnehin `build_runner` fahren: Der Builder `journey_builder`
läuft als Build-Schritt mit und schreibt den Journey-Graphen als
`ductus_builder.g.json` in den Projekt-Root. Mehrwert gegenüber dem
parse-only-Adapter ist **Resolution**: nicht-literale konstante
Annotation-Argumente (z. B. `title: MyConstants.title`) werden über den
resolved AST aufgelöst statt als Fehler/Warnung abgelehnt. Was nicht konstant
auflösbar ist, verhält sich exakt wie beim parse-only-Adapter — gleiche
Fehler und Warnungen.

Setup: `ductus` als reguläre Dependency (die Annotationen werden in `lib/`
importiert), `build_runner` als dev_dependency —
`dart pub add ductus dev:build_runner` ergibt z. B.:

```yaml
# pubspec.yaml (Ausschnitt)
dependencies:
  ductus: ^0.2.0
dev_dependencies:
  build_runner: ^2.4.0
```

Der Builder ist über `auto_apply: dependents` automatisch aktiv, das
Zielprojekt braucht keine eigene `build.yaml`:

```bash
dart run build_runner build
# → ductus_builder.g.json im Projekt-Root
```

Optional lässt sich der Builder in der `build.yaml` des Zielprojekts mit
`deriveFrom` und `include` konfigurieren (gleiche Schlüssel und Defaults wie
die `--config`-JSON des Adapter-CLI):

```yaml
targets:
  $default:
    builders:
      ductus:journey_builder:
        options:
          deriveFrom: [go_router]
          include: [lib/**]
```

**Einschränkung:** Der Builder sieht nur Dateien der build_runner-
**Target-Sources** (Default u. a. `lib/`). Ein `include`-Muster außerhalb
davon (z. B. `extra/**`) liefert im Builder keine Dateien — er warnt dann
pro Muster ohne Treffer; entweder `targets.$default.sources` in der
`build.yaml` erweitern oder für solche Pfade das Adapter-CLI nutzen. Mit
dem Default `lib/**` tritt die Abweichung nicht auf.

Empfehlung: `ductus_builder.g.json` in die `.gitignore` der App aufnehmen —
die Datei ist ein Build-Artefakt (wie `ductus_graph.g.json`, die Debug-Datei
des Adapter-CLI; die beiden Dateien nicht verwechseln).

Ins Adapter-CLI bzw. in die Ductus-CLI gelangt das Artefakt mit
`--from-builder`:

```bash
dart run ductus:adapter --project . --from-builder
```

bzw. über die `ductus.config.yaml` — der Core flacht den `extra`-Block ab
und schreibt seine Schlüssel top-level in die `--config`-JSON des Adapters:

```yaml
adapters:
  - dart:
      project: .
      extra: { fromBuilder: true }
```

Gleichwertig ist der flache Schlüssel direkt unter dem Adapter
(unbekannte Adapter-Schlüssel landen ebenfalls in der `--config`-JSON):

```yaml
adapters:
  - dart:
      project: .
      fromBuilder: true
```

`--from-builder` (Config-Schlüssel `fromBuilder`; das Flag gewinnt) liest
`ductus_builder.g.json`, prüft die `schemaVersion` und gibt die Datei nach
stdout aus — es findet **kein eigener Scan** statt. Fehlt die Datei, bricht
das CLI mit einem Hinweis auf `dart run build_runner build` und Exit ≠ 0 ab.

**Aktualität:** `ductus_builder.g.json` ist so aktuell wie der letzte
build_runner-Lauf — vor `ductus extract` also `dart run build_runner build`
ausführen (oder `dart run build_runner watch` laufen lassen).

**Parität:** Nutzen die Annotationen ausschließlich String-Literale, ist
`ductus_builder.g.json` byte-identisch mit der stdout-Ausgabe des
parse-only-Adapters — bis auf genau eine gewollte Ausnahme: der
`meta.adapters`-Name ist `dart-builder` statt `dart` (Provenance).
Inhaltlich (`flows`/`nodes`/`edges`) ändert Weg D das Ergebnis nur dort,
wo Resolution zusätzliche Werte liefert (DD §N).

## Buildfreie Nutzung (Kommentar-Konvention)

Mit der Kommentar-Konvention (Weg A) braucht das Zielprojekt `ductus` nicht
einmal als Dependency — es genügt eine globale Installation des Adapters:

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

Die Ductus-CLI findet den global aktivierten Adapter über
`dart pub global run`; alternativ zeigt die Umgebungsvariable
`DUCTUS_DART_ADAPTER_DIR` auf ein Verzeichnis mit dem Adapter-Paket
(z. B. einen Checkout dieses Repos).

## Best Practices

- **Annotationen nur mit konstanten String-Literalen.** Der Adapter liest
  parse-only, ohne Resolution. Ein Argument, das kein String-Literal ist
  (Const-Referenz, Interpolation), ist bei Pflichtfeldern (`id`, `title`,
  `label`, `to`, `start`) und bei explizit gesetztem `from` ein Adapter-Fehler;
  optionale Felder (`flow`, `description`, `condition`, Action-`id`, `tags`)
  entfallen mit Warnung auf stderr, ein nicht lesbarer `trigger` fällt mit
  Warnung auf `tap` zurück. Wer konstante Referenzen braucht, nutzt den
  build_runner-Builder (Weg D) — der löst sie per Resolution auf.
- **Weg D statt parse-only, wenn build_runner ohnehin läuft — oder
  Annotationen nicht-literale Konstanten brauchen.** Der Builder löst
  konstante Referenzen (`title: MyConstants.title`) über den resolved AST
  auf und liefert bei rein literalen Annotationen ein bis auf den
  `meta.adapters`-Namen (`dart-builder` statt `dart`) byte-identisches
  Ergebnis (siehe „build_runner-Builder (Weg D)"). In allen anderen Fällen
  bleibt parse-only die erste Wahl: schneller, kein Build und kein `pub get`
  im Zielprojekt nötig — und `--from-builder` liefert immer nur den Stand
  des letzten build_runner-Laufs.
- **`@journey:`-Blöcke direkt an die zugehörige Klasse schreiben.**
  `screen`/`decision`-Blöcke werden der umschließenden bzw. der nächsten
  darauf folgenden Klasse zugeordnet; eine `action` ohne `from` braucht eine
  umschließende, als Screen bekannte Klasse — sonst bricht der Adapter mit
  Fehler ab. Die Grammatik ist strikt `key="value"`: fehlende Pflichtfelder
  sind ein Fehler, unbekannte Keys und Typen nur eine Warnung (der Block bzw.
  Key wird ignoriert).
- **Dependency nur für Annotationen (Weg B).** Wer `@JourneyScreen` & Co. in
  `lib/` importiert, deklariert `ductus` als reguläre Dependency (so die
  Beispiel-App `examples/flutter_go_router_demo`) — die Annotationen sind
  reine Marker ohne Laufzeitverhalten und ohne Abhängigkeiten. Mit der
  Kommentar-Konvention (Weg A) bleibt das Projekt komplett dependency-frei,
  siehe „Buildfreie Nutzung".
- **`deriveFrom` auf die genutzte Router-Bibliothek beschränken.** Default sind
  beide Ableitungen aktiv; wer nur go_router einsetzt, konfiguriert in der
  `ductus.config.yaml` unter `adapters:` z. B. `deriveFrom: [go_router]`.
- **Navigationsaufrufe mit Literal-Argument schreiben.** Nur
  `context.go('/settings')` u. Ä. mit String-Literal werden als
  Transition-Kandidaten erkannt — und nur, wenn die umschließende
  Widget-Klasse einem Screen zuordenbar ist (annotiert oder über den
  `builder:` einer Route); andernfalls verwirft der Adapter den Aufruf mit
  einem stderr-Hinweis.
- **Abgeleitete Nodes über dieselbe id anreichern.** Abgeleitete ids sind der
  Routen-`name` bzw. der Pfad-Slug (`/users/:id/edit` ⇒ `users-edit`); sie
  stehen nach `ductus extract` in `journey-graph.json`. Eine Annotation mit
  derselben id
  überschreibt abgeleitete Werte feldweise (`title`, `description`, `flow`,
  …); zwei manuelle Quellen mit widersprüchlichen Werten sind ein Fehler mit
  beiden Quellenangaben.

Werkzeugweite Best Practices (Graph-Qualität, Arbeitsablauf, LLM & Kosten)
stehen im [Repo-README](https://github.com/PlaxXOnline/ductus#best-practices).

## Adapter-Aufruf

```
dart run ductus:adapter --project <dir> [--config <json>] [--no-debug-file] [--from-builder]
```

- stdout: genau ein kanonisches Graph-JSON (deterministisch, diff-stabil).
- stderr: Warnungen und Hinweise; Exit 0 Erfolg / ≠0 Fehler.
- Schreibt zusätzlich `ductus_graph.g.json` ins Projektverzeichnis
  (abschaltbar mit `--no-debug-file`).
- `--config`: JSON wie `{"deriveFrom": ["go_router", "auto_route"], "include": ["lib/**"]}`
  (Defaults: beide Ableitungen an, `lib/**`).
- `--from-builder` (bzw. Config-Schlüssel `"fromBuilder": true`; das Flag
  gewinnt): kein eigener Scan — emittiert die vom build_runner-Builder
  erzeugte `ductus_builder.g.json` nach `schemaVersion`-Prüfung auf stdout;
  fehlt die Datei, Fehler mit Hinweis auf `dart run build_runner build`.

Das Zielprojekt braucht dafür weder `pub get` noch einen Build — die Analyse
ist parse-only. Einzig `--from-builder` setzt einen vorherigen
build_runner-Lauf voraus (Weg D, siehe oben).

[Ductus]: https://github.com/PlaxXOnline/ductus
