# @ductus/core

**Endnutzer-Dokumentation direkt aus dem App-Code — automatisch, geprüft, versionierbar.**

Ductus extrahiert aus annotiertem Quellcode (Dart/Flutter und
TypeScript/JavaScript) einen User-Journey-Graphen und übersetzt ihn per
LLM — mit deinem eigenen API-Key
(BYOK) — in gepflegte Endnutzer-Dokumentation: als MDX-Dateien oder als
statische Website. `@ductus/core` ist das Herzstück: CLI, Orchestrator,
LLM-Schicht und Ausgabe-Module.

- **Graph statt Prosa als Quelle** — Adapter lesen Routen und Annotationen aus dem Code, `ductus extract` merged und validiert sie zu `journey-graph.json`. Ohne LLM nutzbar.
- **BYOK-LLM-Übersetzung** — Anthropic, OpenAI, jeder OpenAI-kompatible Endpunkt (`custom`, z. B. lokal) oder ein deterministischer `mock`-Provider für Tests. Keine SDK-Abhängigkeiten, der Key bleibt in deiner Umgebungsvariable.
- **Faithfulness-Judge** — ein zweiter LLM-Durchlauf prüft, ob der generierte Text durch den Graphen gedeckt ist. Verstöße landen sichtbar im Output und im Report; über dem Schwellwert schlägt der Lauf fehl (Exit 2).
- **Kosten im Griff** — Token-/Kostenschätzung vor dem ersten LLM-Aufruf, Segment-Cache unter `.ductus/cache` (unveränderte Segmente kosten nichts erneut).
- **Zwei Output-Modi** — MDX-Dateien für deine bestehende Doku-Pipeline oder eine fertige statische Website (interaktive Journey-Site oder Starlight).
- **CI-tauglich** — `ductus check` prüft Graph und Faithfulness ohne LLM-Kosten; deterministische, byte-stabile Ausgaben.

## Installation

Voraussetzung: Node.js ≥ 20.

```bash
# global
npm install -g @ductus/core

# oder als devDependency im Projekt
npm install --save-dev @ductus/core
```

Für Dart/Flutter-Projekte zusätzlich den Adapter installieren:

```bash
npm install -g @ductus/adapter-dart
```

sowie im Flutter-Projekt das Dart-Paket [`ductus`](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) (Annotationen + Extraktor) als Dependency aufnehmen.

Für TypeScript/JavaScript-Projekte (z. B. React mit react-router oder Next.js) genügt:

```bash
npm install -g @ductus/core @ductus/adapter-typescript
```

Ein weiteres SDK oder eine Dependency im Zielprojekt ist nicht nötig — der [TypeScript-Adapter](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) parst die Quellen selbst (parse-only, reines Node).

## Quickstart

```bash
cd mein_projekt                      # Flutter- oder TS/JS-Projekt

ductus init                          # erkennt pubspec.yaml bzw. package.json, legt ductus.config.yaml an
ductus extract                       # → journey-graph.json + ductus-report.json

export DUCTUS_LLM_API_KEY=sk-…       # dein eigener Anthropic-/OpenAI-Key (BYOK)
ductus generate                      # → docs/*.mdx (oder Website, je nach Config)

ductus graph --open                  # Graph als HTML im Browser inspizieren
ductus check                         # CI-Gate: Validierung + Faithfulness, ohne LLM-Kosten
```

## CLI-Referenz

Globale Optionen (vor oder nach dem Befehl):

| Option | Beschreibung |
|---|---|
| `-c, --config <pfad>` | Pfad zur `ductus.config.yaml` (Default: `./ductus.config.yaml`) |
| `--offline` | Kein Netzzugriff: `extract`/`check`/`graph` laufen frei (Adapter arbeiten lokal), `generate` nur mit `llm.provider: mock` |

Befehle:

| Befehl | Optionen | Beschreibung |
|---|---|---|
| `ductus init` | `--force` | Legt eine kommentierte `ductus.config.yaml` an. Erkennt `pubspec.yaml` (`app.name`, `go_router`/`auto_route` ⇒ `deriveFrom`) bzw. `package.json` (`app.name`, `react-router`/`react-router-dom`/`next` ⇒ `deriveFrom`); die `pubspec.yaml` hat Vorrang, wenn beide existieren. Überschreibt eine bestehende Config nur mit `--force`. |
| `ductus extract` | — | Führt alle Adapter aus, merged und validiert den Graphen. Schreibt `journey-graph.json` und `ductus-report.json` neben die Config. Ohne LLM nutzbar. |
| `ductus generate` | `--build` | Extract + LLM-Generierung → MDX oder Website. `--build` baut die Website nach dem Export zusätzlich (`npm ci`/`install` + `npm run build` im Site-Verzeichnis; nur bei `output.format: website`, nicht mit `--offline` kombinierbar). |
| `ductus check` | — | Validierung + Faithfulness aus dem Segment-Cache — schreibt keine Dateien, ruft kein LLM auf (CI-tauglich). Noch nicht generierte Segmente werden gemeldet, sind aber kein Fehler. |
| `ductus graph` | `--open`, `--out <pfad>`, `--journey` | Gibt den Graphen als Mermaid-Flowchart auf stdout aus. `--journey` gibt stattdessen die journey-Diagramme der Flow-Hauptpfade aus. `--out` schreibt in eine Datei. `--open` schreibt `.ductus/graph.html` (Flowchart **und** Journeys) und öffnet sie im Browser. |

## Konfiguration: `ductus.config.yaml`

`ductus init` erzeugt genau diese Vorlage (Werte aus der `pubspec.yaml` bzw. `package.json` vorbelegt):

```yaml
# Ductus-Konfiguration
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

In TypeScript/JavaScript-Projekten sieht die `adapters:`-Sektion stattdessen so aus:

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

Weitere optionale Schlüssel (mit Defaults, wo nicht angegeben):

| Schlüssel | Beschreibung |
|---|---|
| `app.platforms` | Liste der Zielplattformen (rein informativ, landet in den Graph-Metadaten) |
| `adapters[].project` | Projektverzeichnis relativ zur Config (Default: `.`) |
| `adapters[].command` | Adapter-Befehl explizit überschreiben |
| `adapters[].extra` | Zusätzliche Optionen, die 1:1 an den Adapter durchgereicht werden (z. B. die `include`-Globs des Dart- und des TypeScript-Adapters; unbekannte Schlüssel direkt im Adapter-Eintrag landen ebenfalls dort) |
| `llm.maxTokens` | Max. Output-Token je LLM-Aufruf (Default: `2048`) |
| `llm.baseUrl` | Basis-URL des Endpunkts — **Pflicht** bei `provider: custom` |
| `llm.faithfulnessThreshold` | Erlaubte Faithfulness-Verstöße insgesamt, darüber Exit 2 (Default: `0`) |
| `llm.pricing.inputPerMTokUsd` / `llm.pricing.outputPerMTokUsd` | USD je 1 Mio. Token — nur mit diesen Werten rechnet Ductus die Schätzung in USD um |
| `output.website.template` | Eigenes Template-Verzeichnis statt der mitgelieferten Vorlage |

Unbekannte Top-Level-Schlüssel sind nur Warnungen (vorwärtskompatibel).

## Output-Modi

### `format: mdx`

Schreibt je Segment (Flow oder Screen, je nach `style.granularity`) eine
MDX-Seite mit YAML-Frontmatter nach `output.dir`. Mit `diagrams: true`
enthält jede Flow-Seite den Ablauf als Mermaid-`flowchart` und — sobald der
abgeleitete Hauptpfad mindestens zwei Knoten hat — zusätzlich den Hauptpfad
als `journey`-Diagramm. Faithfulness-Verstöße erscheinen als sichtbare
Warnbox am Seitenanfang. Die Ausgabe ist byte-stabil — ideal zum
Einchecken und Diffen.

### `format: website`

Scaffoldet eine komplette Astro-Website nach `output.dir` (danach:
`npm install`, `npm run dev` bzw. `npm run build` — oder direkt
`ductus generate --build`).

| Generator | Beschreibung |
|---|---|
| `journey` *(Default)* | Interaktive Journey-Site aus `ductus.data.json`: klickbarer Journey-Graph mit deterministischem Layout, „Pfad abspielen“, ⌘K/Ctrl+K-Suche über Journeys/Schritte/Aktionen, Schrittliste + ausführliche LLM-Anleitung je Journey. [Template ansehen](https://github.com/PlaxXOnline/ductus/tree/main/templates/journey) |
| `starlight` | Klassische Doku-Site auf Astro/Starlight-Basis; die generierten MDX-Seiten landen unter `src/content/docs/`, Mermaid-Diagramme werden im Browser gerendert. [Template ansehen](https://github.com/PlaxXOnline/ductus/tree/main/templates/starlight) |
| `docusaurus` | Noch nicht enthalten — `generate` bricht mit einer klaren Meldung ab; bitte `journey` oder `starlight` verwenden. |

## LLM: BYOK, Kosten, Cache, Faithfulness

**Bring Your Own Key.** Der API-Key kommt aus der Umgebungsvariable, die
`llm.apiKeyEnv` benennt (Default: `DUCTUS_LLM_API_KEY`), und taucht in
keiner Ausgabe oder Fehlermeldung auf.

| Provider | Hinweise |
|---|---|
| `anthropic` | Anthropic Messages API; Key erforderlich |
| `openai` | OpenAI Chat Completions; Key erforderlich |
| `custom` | Jeder OpenAI-kompatible Endpunkt via `llm.baseUrl` (z. B. lokale Modelle) — ohne gesetzten Key wird schlicht kein Authorization-Header gesendet |
| `mock` | Deterministisch, ohne Netz — für Tests, CI und `--offline` |

**Kostenschätzung vor dem Lauf.** Vor dem ersten Provider-Aufruf gibt
`generate` eine Schätzung aus (Segmente, Input-/Output-Token, mit
`llm.pricing` auch USD). Die Heuristik rechnet mit ~4 Zeichen je Token;
die tatsächlichen Werte stehen nach dem Lauf in der Ausgabe und im
`ductus-report.json`.

**Segment-Cache.** Ergebnisse werden unter `.ductus/cache` abgelegt,
geschlüsselt über Segment-Inhalt, Prompt-Version, Modell und Stil
(`voice`/`locale`). Unveränderte Segmente verursachen bei erneuten Läufen
keine LLM-Kosten; `generate` meldet Treffer und Neu-Generierungen.

**Faithfulness-Check.** Mit `llm.faithfulnessCheck: true` (Default) prüft
ein Judge-Durchlauf jedes generierte Segment gegen den Graphen. Verstöße
werden als Warnbox in den Output geschrieben und im Report gelistet.
Liegt die Gesamtzahl über `llm.faithfulnessThreshold` (Default: `0`),
endet der Lauf mit Exit-Code 2 — der Output wird trotzdem geschrieben,
damit du die Stellen prüfen kannst.

## Exit-Codes

| Code | Bedeutung |
|---|---|
| `0` | Erfolg |
| `1` | Validierungsfehler im Graphen oder Merge-Konflikt zwischen mehreren Adapter-Ausgaben (Details zeilenweise auf stderr) |
| `2` | Faithfulness-Verstöße über dem Schwellwert |
| `3` | Config-, LLM-, Adapter- oder Website-Build-Fehler (auch Usage-Fehler wie `--build` + `--offline`) |

## CI-Rezept: `ductus check` ohne LLM-Kosten

`ductus check` führt die Adapter aus, validiert den Graphen und liest
Faithfulness-Ergebnisse ausschließlich aus dem Segment-Cache — kein
LLM-Aufruf, kein API-Key nötig. Damit der Faithfulness-Teil in CI greift,
den Ordner `.ductus/cache` mit einchecken (er stammt aus dem letzten
lokalen `ductus generate`).

```yaml
# GitHub Actions (Ausschnitt)
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - uses: subosito/flutter-action@v2   # Dart-Adapter braucht das Dart/Flutter-SDK
  - run: npm install -g @ductus/core @ductus/adapter-dart
  - run: flutter pub get
  - run: ductus check                  # Exit 1 = Graph kaputt, Exit 2 = Faithfulness
```

Für TypeScript/JavaScript-Projekte entfällt die SDK-Zeile — der
TypeScript-Adapter ist reines Node, ein zusätzliches SDK ist nicht nötig:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm install -g @ductus/core @ductus/adapter-typescript
  - run: ductus check
```

## Hinweis: Mermaid & CDN

Die von `ductus graph --open` erzeugte HTML-Seite lädt Mermaid beim Öffnen
per CDN (jsdelivr, mermaid@11) — das Rendern im Browser braucht also
einmalig Netz. Gleiches gilt für die Diagramm-Darstellung der
Starlight-Website; offline bleibt der Diagramm-Quelltext als Codeblock
lesbar. `--offline` selbst wirkt nur auf `generate` (nur mit
`llm.provider: mock` erlaubt, nicht mit `--build` kombinierbar).

## Ökosystem

| Paket | Beschreibung |
|---|---|
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) | npm-Wrapper, der das Dart-Adapter-CLI aufrufbar macht |
| [`@ductus/adapter-typescript`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) | TypeScript/JavaScript-Adapter: `@journey:`-Kommentare + Ableitung aus react-router/Next.js |
| [`ductus` (Dart)](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | pub.dev-Paket: Annotationen, Extraktor und build_runner-Builder für Flutter/Dart |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | JSON-Schema und TypeScript-Typen des Journey-Graphen |

Mehr im [Ductus-Repository](https://github.com/PlaxXOnline/ductus):
[Beispielprojekte](https://github.com/PlaxXOnline/ductus/tree/main/examples) ·
[Best Practices](https://github.com/PlaxXOnline/ductus#best-practices) (Graph-Qualität, Arbeitsablauf, LLM & Kosten).

## Lizenz

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/LICENSE)
