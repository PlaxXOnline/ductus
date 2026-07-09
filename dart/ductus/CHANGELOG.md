# Changelog

## 0.2.0 (unveröffentlicht)

- build_runner-Builder `journey_builder` (Weg D, DD §N): schreibt den
  Journey-Graphen als `ductus_builder.g.json` in den Projekt-Root des
  Zielpakets; via `auto_apply: dependents` automatisch aktiv bei
  `dart run build_runner build`. Import über `package:ductus/builder.dart`
  (Factory `ductusJourneyBuilder`) — `package:ductus/ductus.dart` bleibt
  frei von build/source_gen-Importen. Nicht zu verwechseln mit
  `ductus_graph.g.json`, der Debug-Datei des Adapter-CLI.
- Resolution nicht-literaler konstanter Annotation-Argumente (z. B.
  `title: MyConstants.title`) über den resolved AST (source_gen
  `TypeChecker`/`ConstantReader`); nicht konstant Auflösbares verhält sich
  wie beim parse-only-Adapter (gleiche Fehler- und Warnungsformate).
- Paritäts-Garantie: Bei rein literalen Annotationen ist
  `ductus_builder.g.json` byte-identisch mit der stdout-Ausgabe des
  parse-only-Adapters — bis auf genau eine gewollte Ausnahme: das Artefakt
  trägt den `meta.adapters`-Eintrag `{"name": "dart-builder", "version": …}`
  statt `{"name": "dart", …}` (Provenance, DD §N).
- Builder-Optionen `deriveFrom`/`include` in der `build.yaml` des
  Zielprojekts (gleiche Schlüssel und Defaults wie die `--config`-JSON des
  CLI); `include`-Muster ohne Treffer — z. B. außerhalb der
  build_runner-Target-Sources — erzeugen eine Warnung im Build-Log.
- Adapter-CLI: neues Flag `--from-builder` (Config-Schlüssel `fromBuilder`;
  das Flag gewinnt) — emittiert `ductus_builder.g.json` nach
  `schemaVersion`-Prüfung auf stdout statt selbst zu scannen; fehlt die
  Datei, klarer Fehler mit Hinweis auf `dart run build_runner build`.
- Neue dependencies `build`/`source_gen` (Ranges empirisch ermittelt, siehe
  Kommentar in der `pubspec.yaml`); dev: `build_runner`/`build_test` für die
  Builder-Tests.

## 0.1.0

- Journey-Annotationen `@JourneyScreen`, `@JourneyAction`, `@JourneyDecision`,
  `@JourneyFlow` — reine Marker ohne Laufzeitverhalten und ohne Abhängigkeiten.
- Buildfreie Kommentar-Konvention (`// @journey:screen id="…" …`) als
  gleichwertige Alternative zu den Annotationen.
- Automatische Ableitung aus `go_router` (Routen → Screens, `ShellRoute` → Flows,
  `redirect:` → Decisions, `context.go()/push()/…` → Transitions) und
  `auto_route` (`@RoutePage()` → Screens) — best effort, feldweise durch
  manuelle Annotationen überschreibbar.
- Adapter-CLI `dart run ductus:adapter` nach dem Ductus-Adapter-Vertrag (SPEC §7.1):
  parse-only via `package:analyzer`, das Zielprojekt braucht weder `pub get`
  noch einen Build.
- Kanonische, diff-stabile Graph-Ausgabe (`journey-graph.json`-Form) auf stdout;
  Warnungen auf stderr, optionale Debug-Datei `ductus_graph.g.json`.
