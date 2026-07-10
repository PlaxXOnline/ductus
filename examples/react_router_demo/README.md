# react_router_demo — Ableitung (Weg C) + Kommentare (Weg A)

Diese Demo zeigt das Kernversprechen von Ductus in einem React-Projekt:
Ein brauchbarer Journey-Graph entsteht **bevor** ein einziger Kommentar
geschrieben wird — `@journey:`-Kommentare reichern nur dort an, wo Semantik
fehlt. Ein `npm install` im Projekt ist nicht nötig: Der Adapter parst die
Quellen ohne Installation.

## Was passiert hier?

**Automatisch abgeleitet (Weg C, `source: "derived"`):**

- Die vier Routen aus `createBrowserRouter` (`/login`, `/register`,
  `/dashboard`, `/settings` in `src/router.tsx`) werden zu Screen-Nodes —
  `DashboardScreen` und `SettingsScreen` sind bewusst **nicht** annotiert und
  existieren im Graphen rein aus der Ableitung.
- Die pfadlose Layout-Route (`element: <AppShell />` mit `children`) gruppiert
  `dashboard` und `settings` zu einem Flow (`shell-0`) — das
  react-router-Gegenstück zur `ShellRoute`.
- Der `loader: requireAuth` auf `/dashboard` ruft `redirect('/login')` auf und
  wird zum Decision-Node `dashboard_redirect`; das String-Literal `'/login'`
  ergibt eine bedingte Kante Richtung `login`.
- `<Link to="…">` mit sichtbarem Text (Label!) und `navigate('/…')`-Aufrufe
  mit Literal-Argument werden zu Transitionen, z. B. `dashboard → settings`
  („Einstellungen“) und `settings → login` (Abmelden).

**Manuell angereichert (Weg A, `source: "annotation"`):**

- `LoginScreen` und `RegisterScreen` tragen `@journey:screen`-Kommentare mit
  deutschem Titel, `flow` und `description` (bessere LLM-Prosa) — mit
  **denselben ids** (`login`, `register`), die die Ableitung aus den Pfaden
  bildet.
- Eine `@journey:action` mit `trigger="submit"` führt von `login` in die
  `@journey:decision` `login-check` („Zugangsdaten gültig?“), die mit **zwei
  bedingten auto-Actions** nach `dashboard` bzw. zurück nach `login` verzweigt.
- Ein `@journey:flow` (`auth`, Start `login`) bündelt den Anmelde-Flow.
- Die aus `navigate('/login')` abgeleitete Kante `register → login`
  verschmilzt mit der `@journey:action` gleicher Richtung.

Manuelle Werte überschreiben abgeleitete feldweise (Präzedenzregel:
Kommentar schlägt Ableitung, pro Feld).

## Ausprobieren

```sh
npm install -g @ductus/core @ductus/adapter-typescript

# im Verzeichnis examples/react_router_demo
ductus extract             # Graph erzeugen + validieren → journey-graph.json
ductus generate            # zusätzlich LLM-Doku → docs/*.mdx
```

Die eingecheckte `ductus.config.yaml` nutzt `llm.provider: mock` — `generate`
läuft damit ohne API-Key. Für echte Prosa `provider: anthropic` setzen und
einen Key über `DUCTUS_LLM_API_KEY` bereitstellen. `extract` läuft komplett
offline.
