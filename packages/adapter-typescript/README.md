# @ductus/adapter-typescript

**Endnutzer-Dokumentation direkt aus deinem TypeScript-/JavaScript-Code.**
Der Ductus-Adapter für TS/JS-Projekte extrahiert aus `@journey:`-Kommentaren
und react-router-/Next.js-Konfigurationen einen User-Journey-Graphen — die
[Ductus-CLI (`@ductus/core`)](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
macht daraus per LLM (BYOK) gepflegte Doku als MDX-Dateien oder statische
Website, versioniert mit deinem Code.

- **Buildfrei, keine Dependency im Zielprojekt:** Der Adapter parst die
  Quellen über die TypeScript-Compiler-API (parse-only) — kein `npm install`
  im Zielprojekt, kein Build, keine tsconfig nötig.
- **Zwei Eingabewege, frei kombinierbar:** `@journey:`-Kommentare (Weg A,
  Syntax identisch zum Dart-Adapter) und automatische Ableitung aus
  react-router bzw. Next.js (Weg C).
- **TS und JS, mit und ohne JSX:** gescannt werden `.ts`, `.tsx`, `.mts`,
  `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`.
- **Deterministisch:** Die Ausgabe ist kanonisches, byte-stabiles JSON —
  ideal für Code-Review und CI.

## Installation

Voraussetzung: Node.js ≥ 20 — mehr nicht, der Adapter läuft komplett in Node.

```bash
# im Projekt (empfohlen, versioniert mit dem Projekt)
npm install --save-dev @ductus/core @ductus/adapter-typescript

# oder global, ganz ohne Eintrag im Zielprojekt
npm install -g @ductus/core @ductus/adapter-typescript
```

## Quickstart mit @ductus/core

```bash
npx ductus init       # erkennt package.json, legt ductus.config.yaml an
npx ductus extract    # ruft den Adapter auf → journey-graph.json
npx ductus generate   # LLM (BYOK) → Endnutzer-Doku als MDX oder Website
```

Der relevante Ausschnitt der `ductus.config.yaml` (so erzeugt sie `ductus init`):

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

`ductus init` liest die `package.json`: `app.name` wird der Paketname, und
`deriveFrom` enthält die Router, die unter `dependencies` oder
`devDependencies` stehen (`react-router`/`react-router-dom` ⇒ `react-router`,
`next` ⇒ `next`); wird keiner gefunden, bleibt der Default
`[react-router, next]` stehen. Liegt im selben Verzeichnis eine
`pubspec.yaml`, hat sie Vorrang — Flutter-Projekte tragen oft eine
`package.json` fürs Tooling.

Mehr zu Konfiguration, LLM-Providern und Ausgabeformaten steht im README von
[`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Buildfrei: die `@journey:`-Kommentar-Konvention

Der manuelle Eingabeweg (Weg A) — Syntax und Semantik identisch zum
[Dart-Adapter](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus),
funktioniert in `//`-Zeilenkommentaren:

```tsx
// @journey:flow id="auth" title="Anmeldung" start="login"

// @journey:screen id="login" title="Anmeldung" flow="auth"
//   description="Bildschirm, auf dem sich der Nutzer anmeldet."
export function LoginPage() {
  // @journey:action label="Anmelden" to="dashboard" trigger="submit"
  //   condition="Zugangsdaten gültig"
  const onSubmit = () => { /* … */ };
  return /* … */;
}
```

Ein Block beginnt mit `@journey:<screen|action|decision|flow>`, Paare sind
`key="value"` (`\"` escaped ein Anführungszeichen), Fortsetzung in unmittelbar
folgenden Kommentarzeilen; er endet an der ersten Nicht-Kommentar-Zeile oder
am nächsten `@journey:`-Block. Unbekannte Keys und Trigger werden mit Warnung
ignoriert (ein unbekannter `trigger` fällt auf `tap` zurück); fehlende
Pflichtfelder brechen den Lauf mit Fehler ab. `tags` ist kommasepariert.

| Block | Keys (Pflicht **fett**) | Wirkung im Graphen |
|---|---|---|
| `@journey:screen` | **`id`**, **`title`**, `flow`, `description`, `tags` | Screen-Node |
| `@journey:action` | **`label`**, **`to`**, `from`, `id`, `trigger`, `condition` | Transition (Edge) |
| `@journey:decision` | **`id`**, **`title`**, `flow`, `description`, `tags` | Decision-Node (Verzweigungspunkt) |
| `@journey:flow` | **`id`**, **`title`**, **`start`**, `description` | Benannter Flow; `start` muss die Id eines Screens sein |

- `trigger` ist einer von `tap` (Default), `submit`, `auto`, `back`,
  `deeplink`, `system`.
- **Komponenten-Bindung:** `screen`-/`decision`-Blöcke binden an die
  umschließende oder direkt folgende Komponente — eine Top-Level-Klasse,
  Funktionsdeklaration oder `const` mit Funktions-Initializer, auch
  `memo(…)`/`forwardRef(…)`-umschlossen.
- Fehlt bei `@journey:action` das `from`, gilt die umschließende, als Screen
  bekannte Komponente (per `@journey:screen` oder aus der Ableitung); lässt
  sich so kein Screen bestimmen, bricht der Lauf mit Fehler ab.
- Ohne Action-`id` wird deterministisch `e_<from>_<to>` generiert.

Typisierte Annotationen und einen Builder (die Wege B und D des
Dart-Adapters) gibt es hier bewusst nicht — TypeScript braucht sie nicht,
Weg A ist der manuelle Weg und bleibt ohne jede Dependency im Zielprojekt.

## Automatische Ableitung aus react-router / Next.js

Ohne jede Annotation entsteht schon ein brauchbarer Graph (Weg C). Welche
Ableitungen laufen, steuert `deriveFrom` (Default: beide).

### `react-router`

Erkannt werden Objekt-Routen aus `createBrowserRouter`, `createHashRouter`,
`createMemoryRouter` und `useRoutes` — als Inline-Array oder als
Routen-Konstante derselben Datei (`const routes = […];
createBrowserRouter(routes)`) — sowie `<Route>`-JSX (deckt auch
`createRoutesFromElements` ab):

| Quelle | wird zu |
|---|---|
| Route mit Pfad | Screen-Node |
| Pfadlose Layout-Route mit Kindern | Flow `shell-N` (`start` = erster Kind-Screen) |
| `loader` (inline oder in derselben Datei deklariert), der `redirect('…')` aufruft | Decision-Node `<screen>_redirect` mit `auto`-Kanten |
| `<Link to>` / `<NavLink to>` | Transition (`tap`; `label` = einziges Text-Kind) |
| `<Navigate to>` | Transition (`auto`) |
| `navigate('…')` — nur in Dateien, die `useNavigate` verwenden | Transition (`tap`) |

Verschachtelte Pfade werden absolut gejoint (`path: 'detail'` unter `/users`
⇒ `/users/detail`). `element={<X />}` bzw. `Component={X}` ordnet die
Komponente dem Screen zu — ein einzelner Wrapper wie `<Suspense>` wird dabei
durchschaut; über diese Zuordnung findet der Adapter das `from` der
Navigations-Kanten.

### `next`

Dateibasiertes Routing, App- und Pages-Router (jeweils auch unter `src/`):

| Quelle | wird zu |
|---|---|
| App-Router: `app/**/page.*` | Screen-Node |
| Routen-Gruppe `(name)/` | Flow `name` (`start` = erste page der Gruppe) |
| Pages-Router: `pages/**` (ohne `_app`/`_document`/`_error` und `api/`) | Screen-Node |
| `redirect('…')` / `permanentRedirect('…')` in einer page-Datei mit `next/navigation`-Import | Decision-Node `<screen>_redirect` mit `auto`-Kanten |
| `<Link href>` | Transition (`tap`; `label` = einziges Text-Kind) |
| `router.push('…')` / `router.replace('…')` — nur in Dateien, die `useRouter` verwenden | Transition (`tap`) |

`@slot`-Parallel-Routes, `(.)`-Intercepting-Routes und `_private`-Ordner sind
keine eigenständigen Ziele und werden übersprungen.

Pages-Router-Screens entstehen nur bei **Next-Evidenz**: `next` in den
`dependencies`/`devDependencies` der `package.json`, eine `next.config.*`
oder ein Import aus `next`/`next/…` in den gescannten Quellen. Ohne Evidenz
bleibt `(src/)pages/` stumm — der Ordnername ist auch in
react-router-Projekten eine verbreitete Konvention und würde sonst
Phantom-Screens erzeugen. Der App-Router (`app/**/page.*`) ist als Konvention
eindeutig und braucht keine Evidenz.

### Abgeleitete Ids und Hinweise

- Die Screen-Id ist die `id:`-Property der Route (react-router) bzw. der
  Pfad-Slug: führendes `/` entfällt, `/` → `-`, Parameter-Segmente (`:id`,
  `[id]`) entfallen, leerer Pfad ⇒ `root` — `/users/:id/edit` ⇒ `users-edit`.
  Der `title` ist die humanisierte Id (`users-edit` ⇒ „Users edit“).
- Abgeleitete Nodes und Edges tragen `source: "derived"` und einen
  `sourceRef` auf die Fundstelle (Flows kennen im Schema kein
  `source`/`sourceRef`).
- Nicht auflösbare Ziele oder Quellen (der Pfad entspricht keiner bekannten
  Route, die umschließende Komponente ist kein bekannter Screen) sind kein
  Fehler: Der Adapter schreibt einen Hinweis auf stderr und verwirft die
  Kante.

## Merge-Regeln

Identisch zum Dart-Adapter: Manuelle `@journey:`-Angaben überschreiben
abgeleitete Werte **feldweise** — vorausgesetzt, sie verwenden **dieselbe id**
(die abgeleiteten Ids stehen nach `ductus extract` in `journey-graph.json`).
Widersprechen sich zwei **manuelle** Quellen, bricht der Lauf fail-fast mit
beiden Fundstellen ab. Kanten ohne explizite Id erhalten deterministisch
`e_<from>_<to>` (bei Kollisionen `_2`, `_3`, …); die Ausgabe ist kanonisch
sortiert und byte-stabil über wiederholte Läufe, `meta.adapters` enthält
`[{ "name": "typescript", "version": … }]`.

## Das Adapter-CLI

Normalerweise startet `ductus extract` den Adapter automatisch. Manuell:

```bash
ductus-adapter-typescript --project <dir> [--config <json-datei>] [--no-debug-file]
```

| Option | Bedeutung |
|---|---|
| `--project <dir>` | Projektverzeichnis (Pflicht) |
| `--config <json-datei>` | JSON-Konfigurationsdatei (Schlüssel siehe unten); `@ductus/core` erzeugt sie automatisch aus dem Adapter-Eintrag der `ductus.config.yaml` |
| `--no-debug-file` | Unterdrückt die Debug-Datei `ductus_graph.g.json` im Projektverzeichnis (Default: sie wird geschrieben) |

Verhalten: stdout ist genau ein kanonisches Graph-JSON, sämtliche Diagnostik
(Warnungen, Hinweise) geht auf stderr.

| Exit-Code | Bedeutung |
|---|---|
| `0` | Erfolg |
| `64` | Usage-Fehler (fehlendes `--project`, unbekannte Option) |
| `1` | Adapterfehler (fehlende Pflichtfelder, nicht auflösbares `from`, Merge-Konflikt, ungültige Config) |

Schlüssel der `--config`-JSON (sie entsprechen dem Adapter-Eintrag in der
`adapters:`-Sektion der `ductus.config.yaml`):

| Schlüssel | Default | Bedeutung |
|---|---|---|
| `deriveFrom` | `["react-router", "next"]` | Ableitungsquellen (Weg C) |
| `include` | `["src/**", "app/**", "pages/**", "lib/**"]` | Glob-Muster relativ zum Projekt, die gescannt werden |

Gescannt werden Dateien mit den Endungen `.ts`, `.tsx`, `.mts`, `.cts`, `.js`,
`.jsx`, `.mjs`, `.cjs`. `node_modules`, `dist`, `build`, `out`, `coverage`
und Dot-Verzeichnisse (`.git`, `.next`, …) werden nie gescannt — unabhängig
von den `include`-Globs.

## Wie @ductus/core den Adapter findet

`ductus extract` löst den Befehl für den Adapter-Eintrag `typescript` in
dieser Reihenfolge auf:

| # | Quelle | Verhalten |
|---|---|---|
| 1 | `command:` im Adapter-Eintrag der `ductus.config.yaml` | Gewinnt immer — der konfigurierte Befehl wird unverändert ausgeführt. |
| 2 | `node_modules/.bin` neben der `ductus.config.yaml` | Das Binary `ductus-adapter-typescript` aus `npm install -D @ductus/adapter-typescript`. |
| 3 | `PATH` | Das Binary aus `npm install -g @ductus/adapter-typescript`. |

Greift keine Stufe, bricht der Aufruf mit einer Fehlermeldung ab, die beide
Installationsoptionen nennt. Anders als beim Dart-Adapter ist keine weitere
Toolchain nötig — der Adapter läuft im selben Node, das auch `@ductus/core`
ausführt.

## Grenzen

- **Parse-only heißt: nur String-Literale.** Pfade und Ziele müssen statisch
  lesbar sein (`'…'`, `"…"` oder Template-Literal ohne Interpolation) —
  dynamische Pfade wie `` navigate(`/users/${id}`) `` werden nicht erkannt,
  und Routen ohne literalen `path` werden mit Hinweis übersprungen.
- **`navigate(…)`/`router.push(…)` brauchen den Hook-Kontext:** `navigate('…')`
  wird nur in Dateien erkannt, die `useNavigate` verwenden, `router.push`/
  `router.replace` nur in Dateien mit `useRouter` — freie Funktionen gleichen
  Namens werden so nicht fälschlich erfasst.
- **Auflösung endet an der Dateigrenze:** Routen-Konstanten
  (`createBrowserRouter(routes)`) und `loader`-Funktionen werden nur
  aufgelöst, wenn sie in derselben Datei deklariert sind — importierte
  Routen-Arrays oder Guards (`import { requireAuth } from './guards'`)
  bleiben unerkannt.
- **`@journey:`-Blöcke nur in `//`-Zeilenkommentaren**, nicht in
  `/* … */`-Blockkommentaren.
- **Kein Vue, Svelte oder Angular in dieser Version:** `deriveFrom` kennt
  `react-router` und `next`. Weg A funktioniert dagegen framework-unabhängig
  in jedem TS/JS-Projekt.

Syntaxfehler in einzelnen Dateien sind kein Abbruch — die
TypeScript-Compiler-API parst fehlertolerant, der Adapter meldet die Datei
mit einer Warnung auf stderr und analysiert best effort weiter.

## Links

| Paket | Beschreibung |
|---|---|
| [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) | CLI, Orchestrator, LLM-Schicht (BYOK), MDX-/Website-Output |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | JSON-Schema und TypeScript-Typen des Journey-Graphen |
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) + [`ductus` (Dart)](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | Das Dart/Flutter-Gegenstück dieses Adapters |
| [`react_router_demo`](https://github.com/PlaxXOnline/ductus/tree/main/examples/react_router_demo) | Lauffähige Beispiel-App: Ableitung aus react-router + `@journey:`-Kommentare |

Mehr im [Ductus-Repository](https://github.com/PlaxXOnline/ductus).

## Lizenz

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-typescript/LICENSE)
