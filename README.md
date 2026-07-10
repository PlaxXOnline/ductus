# Ductus

> **Status:** Phase 1 (OSS-Kern) implementiert — Schema, Core-CLI, Dart-Adapter,
> LLM-Schicht (BYOK), MDX-/Website-Ausgabe und Beispiel-Apps · MIT-Lizenz

Endnutzer-Dokumentation veraltet schneller, als sie geschrieben wird: Jede neue
Route, jeder umbenannte Button macht Anleitungen still und leise falsch. Ductus
extrahiert deshalb direkt aus dem annotierten Quellcode (Phase 1: Dart/Flutter)
einen gerichteten Graphen der User-Journey und übersetzt ihn per LLM — mit dem
eigenen API-Key (BYOK) — in gepflegte Endnutzer-Doku als MDX-Dateien oder
statische Website. Graph und Doku werden mit dem Code versioniert; ein
Faithfulness-Judge stellt sicher, dass der generierte Text nichts behauptet,
was nicht im Graphen steht.

```
Quellcode ──Adapter──▶ journey-graph.json ──LLM (BYOK)──▶ MDX / statische Website
```

- **Kein Backend, kein Konto:** Alles läuft lokal über die CLI. Als
  LLM-Provider dienen `anthropic`, `openai`, ein OpenAI-kompatibler Endpoint
  (`custom` + `baseUrl`) oder `mock` (deterministisch, netzfrei — für Tests/CI).
- **Graph-geerdete Generierung:** Das LLM übersetzt nur den validierten
  Graphen; der Faithfulness-Judge prüft die Ausgabe dagegen und markiert
  ungedeckte Aussagen sichtbar im Output und im Report.
- **Sprachunabhängiger Kern + Sprachadapter** (wie LSP/tree-sitter): Ein
  Adapter ist ein eigenständiges CLI, das genau ein kanonisches Graph-JSON auf
  stdout liefert (stderr für Warnungen, Exit 0/≠0). Neue Sprachen brauchen nur
  einen solchen Adapter, keine Core-Änderung.

## Pakete

| Paket | Registry | Quellcode | Inhalt |
|---|---|---|---|
| `@ductus/schema` | npm | [packages/schema](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | Graph-JSON-Schema + TypeScript-Typen |
| `@ductus/core` | npm | [packages/core](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) | `ductus`-CLI: Merge/Validierung, LLM-Schicht, MDX-/Website-Export |
| `@ductus/adapter-dart` | npm | [packages/adapter-dart](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) | Dünner Wrapper, delegiert an das Dart-Adapter-CLI |
| `ductus` | pub.dev | [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | Dart-Annotationen, Adapter-CLI, build_runner-Builder |

Alle Pakete stehen unter MIT-Lizenz (LICENSE liegt je Paket bei).

## Schnellstart

```bash
# Im Flutter-Projekt (mit go_router):
dart pub add ductus                # Annotationen + Adapter (regulär, da in lib/ importiert)
npm install -g @ductus/core @ductus/adapter-dart

ductus init                        # erkennt pubspec.yaml, legt ductus.config.yaml an
ductus extract                     # → journey-graph.json (ohne LLM nutzbar)
export DUCTUS_LLM_API_KEY=sk-…
ductus generate                    # → docs/*.mdx (oder Website)
ductus graph --open                # Graph als Mermaid/HTML inspizieren
ductus graph --journey             # Hauptpfad je Flow als Mermaid-journey
```

> **Hinweis:** Die von `ductus graph --open` erzeugte HTML-Seite lädt Mermaid
> beim Öffnen per CDN — das Rendern im Browser braucht also einmalig Netz.
> `--offline` garantiert „kein Netzzugriff“: `extract`, `check` und `graph`
> laufen ohnehin vollständig lokal, `generate` ist dann nur mit
> `llm.provider: mock` erlaubt, und `--build` lässt sich nicht kombinieren
> (npm bräuchte Netz).

### Konfiguration

`ductus init` liest die `pubspec.yaml` (App-Name, go_router/auto_route) und
legt eine kommentierte `ductus.config.yaml` an:

```yaml
app:
  name: MyApp
  locale: de

adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]

llm:
  provider: anthropic        # anthropic | openai | custom | mock
  model: claude-sonnet-4-5
  apiKeyEnv: DUCTUS_LLM_API_KEY
  temperature: 0.2
  faithfulnessCheck: true

style:
  voice: formal-sie          # formal-sie | informal-du | en-you
  granularity: flow          # flow | screen

output:
  format: mdx                # mdx | website
  dir: docs/
  website:
    generator: journey       # journey | starlight | docusaurus
    diagrams: true
```

Erwähnenswerte Details:

- `llm.apiKeyEnv` enthält den **Namen** der Umgebungsvariable, nie den
  Schlüssel selbst; `llm.baseUrl` ist Pflicht bei `provider: custom`.
- `llm.faithfulnessThreshold` (Default `0`) legt fest, ab wie vielen
  Judge-Treffern `generate`/`check` mit Exit 2 enden; `llm.maxTokens`
  (Default `2048`) begrenzt die Antwortlänge je Aufruf.
- `llm.pricing` (`inputPerMTokUsd`/`outputPerMTokUsd`) ist optional und macht
  aus der Token-Schätzung eine USD-Kostenschätzung.
- `output.website.generator: docusaurus` wird akzeptiert, ist in Phase 1 aber
  nicht enthalten — der Lauf bricht mit einem Hinweis auf `journey`/`starlight` ab.

## CLI

| Befehl | Zweck |
|---|---|
| `ductus init [--force]` | Legt die kommentierte `ductus.config.yaml` an (überschreibt nur mit `--force`) |
| `ductus extract` | Führt die Adapter aus, merged + validiert → `journey-graph.json` und `ductus-report.json` |
| `ductus generate [--build]` | extract + LLM-Generierung → MDX oder Website; `--build` baut die exportierte Website |
| `ductus check` | Validierung + Faithfulness aus dem Segment-Cache — ohne LLM-Aufrufe, ohne Kosten (CI) |
| `ductus graph [--open] [--out <pfad>] [--journey]` | Mermaid auf stdout; `--open` rendert HTML nach `.ductus/graph.html`; `--journey` gibt die Flow-Hauptpfade als journey-Diagramme aus |

Globale Optionen: `-c, --config <pfad>` (Default `./ductus.config.yaml`) und
`--offline` (siehe Hinweis oben).

**Exit-Codes** (alle Befehle):

| Code | Bedeutung |
|---|---|
| `0` | Erfolg |
| `1` | Validierungsfehler oder Merge-Konflikt zwischen mehreren Adapter-Ausgaben |
| `2` | Faithfulness-Verstöße über `llm.faithfulnessThreshold` |
| `3` | Config-, LLM-, Adapter- oder Website-Buildfehler — auch Usage-Fehler wie `--build` + `--offline` |

## Eingabewege

Vier Wege füllen den Graphen; sie lassen sich frei kombinieren
(Details und Setup: [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)):

| Weg | Mechanismus | Wofür |
|---|---|---|
| **A — Kommentar-Konvention** | `// @journey:screen id="…" title="…"` | Buildfrei, keine Dependency im Zielprojekt |
| **B — Dart-Annotationen** | `@JourneyScreen`, `@JourneyAction`, `@JourneyDecision`, `@JourneyFlow` | Typsicher; `ductus` als reguläre Dependency |
| **C — Automatische Ableitung** | go_router/auto_route-Analyse | Gerüst ganz ohne Annotationen |
| **D — build_runner-Builder** | `journey_builder` → `ductus_builder.g.json` | Löst nicht-literale konstante Annotation-Argumente auf |

Merge-Regel: Manuelle Annotationen überschreiben abgeleitete Werte feldweise
(gleiche id vorausgesetzt); widersprechen sich zwei **manuelle** Quellen,
bricht der Lauf fail-fast mit beiden Quellenangaben ab.

**Buildfreie Nutzung:** Mit der Kommentar-Konvention braucht das Zielprojekt
keinerlei Dependency — es genügt eine globale Installation:

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

## Website-Modus

Mit `output.format: website` exportiert `ductus generate` ein vollständiges
Astro-Projekt nach `output.dir`. Default-Generator ist
[`journey`](https://github.com/PlaxXOnline/ductus/tree/main/templates/journey):
ein journey-zentriertes, pures Astro-Template mit interaktivem Journey-Graph
und ⌘K-Suche, das seine Daten aus genau einer `ductus.data.json` in der
Site-Wurzel liest (deterministischer Datenvertrag — keine MDX-Dateien). Mit
`output.website.generator: starlight` entsteht stattdessen ein
[Starlight-Projekt](https://github.com/PlaxXOnline/ductus/tree/main/templates/starlight)
(MDX + Sidebar-/Site-Konfig).

`ductus generate --build` installiert im exportierten Projekt anschließend die
Abhängigkeiten (`npm ci` bei vorhandener `package-lock.json`, sonst
`npm install`) und führt `npm run build` aus — die fertige, rein statisch
hostbare Website liegt danach unter `<output.dir>/dist`. Ohne `--build` bleibt
der Build Sache des Nutzers; mit `--offline` ist `--build` nicht kombinierbar,
und bei `output.format: mdx` bricht das Flag mit einem Usage-Fehler (Exit 3) ab.

## Diagramme in der generierten Doku

Mit `output.website.diagrams: true` (Default) erhält jede Flow-Seite bis zu
zwei Mermaid-Abschnitte: **„Hauptpfad“** (lineares `journey`-Diagramm) und
**„Ablaufdiagramm“** (`flowchart` des vollständigen Segments). Der Hauptpfad
wird deterministisch abgeleitet: ab `flow.start` wählt Ductus pro Schritt genau
eine ausgehende Kante — Nicht-`back`-Trigger vor `back`, Kanten ohne
`condition` vor solchen mit, bei Gleichstand die kleinste `edge.id`; besuchte
Nodes werden nie wiederholt. Hat der Pfad weniger als zwei Knoten, entfällt der
Abschnitt.

Das Starlight-Template rendert beide Diagramme client-seitig (Mermaid per CDN,
theme-aware); ohne Netz bleibt der Codeblock als lesbarer Fallback sichtbar.
Das journey-Template braucht die Mermaid-Diagramme nicht: Es rendert den
Graphen nativ als interaktive Ansicht (anklickbare Knoten,
Hauptpfad-Animation) direkt aus `ductus.data.json` — die Diagramm-Abschnitte
betreffen nur den MDX-Modus und das Starlight-Template.

## Best Practices

So holt man aus Ductus präzise, graphentreue und günstige Endnutzer-Doku heraus.

### Graph-Qualität

- **IDs stabil halten, nie umwidmen.** IDs sind die Merge-Identität, Teil des
  Segment-Cache-Keys und Sortierschlüssel der kanonischen Ausgabe — eine
  umbenannte id heißt: Segment wird neu generiert (LLM-Kosten) und der Diff
  rauscht. Sprechende kebab-case-IDs wie `submit-login` passen zum Stil der
  abgeleiteten IDs.
- **Titel und `description` aus Endnutzer-Sicht, keine Code-Interna.** Der
  Faithfulness-Judge prüft nur, ob der Text etwas behauptet, das *nicht* im
  Graphen steht — was im Graphen steht, landet in der Doku. Fehlende
  `description`s meldet die Validierung als Warnung (V5), weil die LLM-Qualität
  sinkt.
- **Kanten-`label` = der sichtbare UI-Text.** Der Generierungs-Prompt verbietet
  dem LLM, UI-Elemente zu erfinden, die nicht als Node, Edge oder `label` im
  Segment stehen — nur mit der echten Button-Beschriftung entsteht „Tippen Sie
  auf **Anmelden**“ statt einer vagen Umschreibung.
- **Jeden Node einem Flow zuordnen, `condition` an jede Decision-Kante.**
  Nodes ohne Flow sammeln sich auf einer Restseite „Weitere Bereiche“ ohne
  Hauptpfad-Diagramm. Die Validierung warnt außerdem (V5) bei unerreichbaren
  Nodes und bei Zyklen, in denen keine Kante eine `condition` trägt;
  `flow.start` muss existieren und ein Screen sein (V3, harter Fehler).

### Eingabewege kombinieren

- **Ableitung als Basis, Annotationen zum Nachschärfen.** Die automatische
  Ableitung aus go_router/auto_route liefert das Gerüst; manuelle Annotationen
  (Dart-Annotationen oder `@journey:`-Kommentare) überschreiben abgeleitete
  Werte feldweise. Um einen abgeleiteten Node anzureichern, muss die Annotation
  **dieselbe id** verwenden — die abgeleiteten ids stehen nach `ductus extract`
  in `journey-graph.json`.
- **Nie zwei manuelle Quellen für dasselbe Feld.** Widersprechen sich zwei
  manuelle Quellen, bricht der Merge fail-fast mit beiden Quellenangaben ab;
  im Dart-Projekt erkennt das bereits der Adapter, das CLI endet dann mit
  Exit 3 (Adapterfehler). Jedes Element genau einmal manuell beschreiben.
- **Buildfreier Einstieg über die Kommentar-Konvention:** braucht keinerlei
  Dependency im Zielprojekt (siehe [Eingabewege](#eingabewege)).
- **Weg D für build_runner-Projekte:** Wer ohnehin `build_runner` fährt, lässt
  den Builder `journey_builder` den Graphen als `ductus_builder.g.json`
  miterzeugen und speist ihn per `extra: { fromBuilder: true }` in der
  `adapters:`-Sektion ein (gleichwertig: `fromBuilder: true` direkt unter dem
  Adapter, bzw. `--from-builder` am Adapter-CLI) — mit Resolution
  nicht-literaler konstanter Annotation-Argumente, die parse-only ablehnen
  müsste. Bei rein literalen Annotationen ist das Artefakt bis auf den
  `meta.adapters`-Namen (`dart-builder` statt `dart`) byte-identisch zur
  parse-only-Ausgabe; es ist so aktuell wie der letzte build_runner-Lauf
  (Setup in [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)).

### Arbeitsablauf

- **Erst `extract` grün bekommen, dann `generate`.** `ductus extract` und
  `ductus graph --open` laufen ohne LLM und kosten nichts — Validierungsfehler
  und Warnungen zuerst beheben, den Graphen inspizieren, erst dann generieren.
- **`journey-graph.json` und die generierte Doku mit dem Code versionieren.**
  Der Graph ist byte-stabil serialisiert (deterministische Sortierung, LF,
  stabile Feldreihenfolge) — Änderungen bleiben als saubere Diffs im Review
  sichtbar.
- **Generierte Doku nicht von Hand editieren.** Der nächste `generate`-Lauf
  schreibt die Seiten neu (unveränderte Segmente kommen unverändert aus dem
  Cache). Korrekturen gehören in den Graphen — auch bei
  `:::caution`-Faithfulness-Warnungen im Output: `description`, `label`,
  `condition` nachschärfen statt Text flicken.
- **`ductus check` in CI.** Validiert und bewertet Faithfulness aus dem
  Segment-Cache — ohne LLM-Aufrufe, ohne Kosten. Es gelten die
  [Exit-Codes oben](#cli); mit dem Default-Schwellwert `0` schlägt schon ein
  einzelner Judge-Treffer fehl. Segmente ohne Cache-Eintrag meldet `check` nur
  als „noch nicht generiert“ (Exit bleibt 0) — Faithfulness prüft es also nur,
  wenn `.ductus/cache` aus einem `generate`-Lauf vorliegt.

### LLM & Kosten

- **Der Segment-Cache hasht Inhalte.** Cache-Key ist SHA-256 über das
  kanonische Segment-JSON plus Prompt-Version, Modell, `voice` und `locale`.
  Stabile ids/Titel vermeiden Neugenerierung; ein Wechsel von Modell, `voice`
  oder `locale` invalidiert dagegen alle Segmente — ein `granularity`-Wechsel
  ebenfalls, weil er den Segment-Zuschnitt und damit die Segment-JSONs ändert.
- **Kostenschätzung vor dem Lauf lesen.** `generate` gibt sie vor dem ersten
  Provider-Aufruf aus; mit konfiguriertem `llm.pricing` (Preis je 1M
  In-/Out-Token) auch in USD.
- **`temperature` niedrig, `faithfulnessCheck` an lassen** (Defaults `0.2`
  bzw. `true`). Niedrige Temperatur dient dem Determinismus; der Judge markiert
  ungedeckte Behauptungen im Output und in `ductus-report.json`.
- **API-Key ausschließlich per Umgebungsvariable.** Die Config kennt nur
  `llm.apiKeyEnv` — den *Namen* der Variable (Default `DUCTUS_LLM_API_KEY`),
  nie den Schlüssel selbst; er wird weder geloggt noch persistiert.
- **Tests/CI ohne Kosten:** `llm.provider: mock` (deterministisch, netzfrei)
  plus `--offline`.

### Website

- **`diagrams: true` (Default) belassen:** jede Flow-Seite erhält das
  `flowchart`, dazu das Hauptpfad-`journey`, sobald der Hauptpfad mindestens
  zwei Knoten hat (siehe [oben](#diagramme-in-der-generierten-doku)).
- **CI-Deploys mit `ductus generate --build`:** baut die Website nach dem
  Export; das Ergebnis unter `<output.dir>/dist` ist rein statisch hostbar.
  `--build` ist mit `--offline` nicht kombinierbar.

## Repository-Layout

```
packages/{schema,core,adapter-dart}   # npm-Pakete (TypeScript)
dart/ductus                           # pub.dev-Paket (Annotationen + Adapter + Builder)
templates/                            # Website-Templates (journey = Default, starlight)
examples/                             # Beispiel-Apps mit Annotationen
```

Die [Beispiel-Apps](https://github.com/PlaxXOnline/ductus/tree/main/examples)
zeigen die Eingabewege in Aktion: `flutter_go_router_demo` (Ableitung +
Annotationen) und `flutter_comment_demo` (rein buildfreie Kommentar-Konvention).

## Entwicklung

```bash
npm install && npm run build && npm test      # TS-Pakete
cd dart/ductus && dart pub get && dart test   # Dart-Adapter
```

CI: [.github/workflows/ci.yml](https://github.com/PlaxXOnline/ductus/blob/main/.github/workflows/ci.yml)
führt bei jedem Push und Pull Request drei Jobs aus — Node (Build + Vitest),
Dart (`dart analyze` + `dart test` in `dart/ductus`) und `flutter analyze` für
beide Beispiel-Apps unter `examples/`.

## Lizenz

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/LICENSE) für alle Pakete
in diesem Repository.
