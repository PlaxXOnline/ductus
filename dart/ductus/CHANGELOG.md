# Changelog

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
