# go_router_demo — Ableitung (Weg C) + Annotationen (Weg B)

Diese Demo zeigt das Kernversprechen von Ductus: Ein brauchbarer Journey-Graph
entsteht **bevor** eine einzige Annotation geschrieben wird — Annotationen
reichern nur dort an, wo Semantik fehlt.

## Was passiert hier?

**Automatisch abgeleitet (Weg C, `source: "derived"`):**

- Die vier `GoRoute`-Einträge (`login`, `register`, `dashboard`, `settings`)
  werden zu Screen-Nodes — `DashboardScreen` und `SettingsScreen` sind bewusst
  **nicht** annotiert und existieren im Graphen rein aus der Ableitung.
- Die `ShellRoute` gruppiert `dashboard` und `settings` zu einem Flow.
- Der Top-Level-`redirect` wird zu einem Decision-Node; das String-Literal
  `'/login'` im Body ergibt eine bedingte Kante Richtung `login`.
- `context.goNamed(…)`-Aufrufe mit Literal-Argument werden zu
  Transition-Kandidaten.

**Manuell angereichert (Weg B, `source: "annotation"`):**

- `LoginScreen` und `RegisterScreen` tragen `@JourneyScreen` mit deutschem
  Titel und `description` (bessere LLM-Prosa).
- `@JourneyAction` auf den Submit-Handlern liefert Label, Trigger und
  Bedingung der Transitionen (`login → dashboard`, `register → login`).
- `@JourneyFlow(id: 'auth', …)` bündelt den Anmelde-Flow mit Start `login`.

Manuelle Werte überschreiben abgeleitete feldweise (SPEC §5.4).

## Ausprobieren

```sh
# im Verzeichnis examples/flutter_go_router_demo
ductus init                # erkennt den Dart-Adapter + go_router
ductus extract             # Graph erzeugen + validieren → journey-graph.json
ductus generate            # zusätzlich LLM-Doku (BYOK) → docs/*.mdx
```

Für `generate` muss ein API-Key gesetzt sein (`DUCTUS_LLM_API_KEY`).
`extract` läuft komplett offline.
