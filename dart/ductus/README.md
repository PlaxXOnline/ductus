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

## Adapter-Aufruf

```
dart run ductus:adapter --project <dir> [--config <json>] [--no-debug-file]
```

- stdout: genau ein kanonisches Graph-JSON (deterministisch, diff-stabil).
- stderr: Warnungen und Hinweise; Exit 0 Erfolg / ≠0 Fehler.
- Schreibt zusätzlich `ductus_graph.g.json` ins Projektverzeichnis
  (abschaltbar mit `--no-debug-file`).
- `--config`: JSON wie `{"deriveFrom": ["go_router", "auto_route"], "include": ["lib/**"]}`
  (Defaults: beide Ableitungen an, `lib/**`).

Das Zielprojekt braucht dafür weder `pub get` noch einen Build — die Analyse
ist parse-only.

[Ductus]: https://github.com/PlaxXOnline/ductus
