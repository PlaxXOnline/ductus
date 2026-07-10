# Ductus

> **Status:** Phase 1 (OSS-Kern) implementiert — Schema, Core-CLI, Dart-Adapter,
> LLM-Schicht (BYOK), MDX/Website-Ausgabe und Beispiel-Apps ·
> MIT-Lizenz · Arbeitsname „Ductus" (Platzhalter)

Ductus extrahiert aus annotiertem Quellcode einen gerichteten Graphen der
User-Journey einer App und übersetzt ihn per LLM (BYOK) in gepflegte
Endnutzer-Dokumentation, die mit dem Code versioniert wird.

```
Quellcode ──Adapter──▶ journey-graph.json ──LLM (BYOK)──▶ MDX / statische Website
```

- **Kein Backend, kein Konto:** Alles läuft lokal über die CLI.
- **Graph-geerdete Generierung:** Das LLM übersetzt nur den validierten Graphen —
  ein Faithfulness-Judge prüft die Ausgabe gegen den Graphen.
- **Sprachunabhängiger Kern + Sprachadapter** (wie LSP/tree-sitter): Neue Sprachen
  brauchen nur den [Adapter-Vertrag](SPEC.md#7-adapter-vertrag), keine Core-Änderung.

## Pakete

| Paket | Registry | Inhalt |
|---|---|---|
| [`@ductus/schema`](packages/schema) | npm | Graph-JSON-Schema + TypeScript-Typen |
| [`@ductus/core`](packages/core) | npm | CLI, Merge/Validierung, LLM-Schicht, MDX/Website-Export |
| [`@ductus/adapter-dart`](packages/adapter-dart) | npm | Wrapper, ruft den Dart-Adapter auf |
| [`ductus`](dart/ductus) | pub.dev | Dart-Annotationen + Adapter-CLI (go_router/auto_route-Ableitung) |

## Schnellstart

```bash
# Im Flutter-Projekt (mit go_router):
dart pub add ductus                # Annotationen + Adapter (regulär, da in lib/ importiert)
npm install -g @ductus/core @ductus/adapter-dart

ductus init                        # erkennt Adapter/Routing, legt ductus.config.yaml an
ductus extract                     # → journey-graph.json (ohne LLM nutzbar)
export DUCTUS_LLM_API_KEY=sk-…
ductus generate                    # → docs/*.mdx (oder Website)
ductus graph --open                # Graph als Mermaid/HTML inspizieren
ductus graph --journey             # Hauptpfad je Flow als Mermaid-journey
```

> **Hinweis:** Die von `ductus graph --open` erzeugte HTML-Seite lädt Mermaid
> beim Öffnen per CDN — das Rendern im Browser braucht also einmalig Netz.
> `--offline` wirkt nur auf `generate` (nur mit `llm.provider: mock` erlaubt,
> nicht mit `--build` kombinierbar; DD §B.9, §M); `extract`, `check` und die
> Graph-Erzeugung selbst laufen vollständig lokal.

### Website-Modus

Mit `output.format: website` exportiert `ductus generate` ein vollständiges
Astro-Projekt nach `output.dir`. Default-Generator ist `journey` (DD §O): ein
journey-zentriertes, pures Astro-Template, das seine Daten aus genau einer
`ductus.data.json` in der Site-Wurzel liest (deterministischer Datenvertrag —
keine MDX-Dateien). Mit `output.website.generator: starlight` entsteht
stattdessen wie bisher ein Starlight-Projekt (MDX + Sidebar-/Site-Konfig).
`ductus generate --build` installiert im exportierten Projekt
anschließend die Abhängigkeiten (`npm ci` bei vorhandener `package-lock.json`,
sonst `npm install`) und führt `npm run build` aus — die fertige Website liegt
danach unter `<output.dir>/dist` (DD §M). Ohne `--build` bleibt der Build wie
gehabt Sache des Nutzers; mit `--offline` ist `--build` nicht kombinierbar
(npm bräuchte Netz), und bei `output.format: mdx` bricht das Flag mit einem
Usage-Fehler ab.

### Diagramme in der generierten Doku

Mit aktivierten Diagrammen erhält jede Flow-Seite bis zu zwei
Mermaid-Abschnitte: **„Hauptpfad"** (lineares `journey`-Diagramm des
deterministisch abgeleiteten Hauptpfads — entfällt, wenn der Pfad weniger als
zwei Knoten hat, DD §L) und **„Ablaufdiagramm"** (`flowchart` des
vollständigen Segments).
Das Starlight-Template rendert beide client-seitig (Mermaid per CDN,
theme-aware); ohne Netz bleibt der Codeblock als Fallback sichtbar
(DD §L). Das journey-Template braucht die Mermaid-Diagramme nicht: Es
rendert den Graphen nativ als interaktive Ansicht (anklickbare Knoten,
Hauptpfad-Animation) direkt aus `ductus.data.json` — die
Diagramm-Abschnitte betreffen nur den MDX-Modus und das
Starlight-Template.

## Best Practices

So holt man aus Ductus präzise, graphentreue und günstige Endnutzer-Doku heraus.
Alle Regeln folgen aus [SPEC.md](SPEC.md) bzw.
[docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) (unten „DD").

### Graph-Qualität

- **IDs stabil halten, nie umwidmen.** IDs sind die Merge-Identität (DD §D),
  Teil des Segment-Cache-Keys (DD §J) und Sortierschlüssel der kanonischen
  Ausgabe (DD §C) — eine umbenannte id heißt: Segment wird neu generiert
  (LLM-Kosten) und der Diff rauscht. Sprechende kebab-case-IDs wie
  `submit-login` passen zum Stil der abgeleiteten IDs (DD §G).
- **Titel und `description` aus Endnutzer-Sicht, keine Code-Interna.** Der
  Faithfulness-Judge prüft nur, ob der Text etwas behauptet, das *nicht* im
  Graphen steht (§8.3) — was im Graphen steht, landet in der Doku. Fehlende
  `description`s meldet die Validierung als V5-Warnung, weil die LLM-Qualität
  sinkt (§6.5).
- **Kanten-`label` = der sichtbare UI-Text.** Der Styleguide verbietet dem LLM,
  UI-Elemente zu erfinden, die nicht als Node/Edge/`label` vorliegen (§8.4) —
  nur mit der echten Button-Beschriftung entsteht „Tippen Sie auf
  **Anmelden**" statt einer vagen Umschreibung.
- **Jeden Node einem Flow zuordnen, `condition` an jede Decision-Kante.**
  Nodes ohne Flow sammeln sich auf einer Restseite „Weitere Bereiche" ohne
  Hauptpfad-Diagramm (DD §L). V5 warnt außerdem bei unerreichbaren Nodes und
  bei Zyklen, in denen keine Kante eine `condition` trägt; `flow.start` muss
  existieren und ein Screen sein (V3, harter Fehler).

### Eingabewege kombinieren

- **Ableitung als Basis, Annotationen zum Nachschärfen.** Die automatische
  Ableitung aus go_router/auto_route liefert das Gerüst; manuelle Annotationen
  (Dart-Annotationen oder `@journey:`-Kommentare) überschreiben abgeleitete
  Werte feldweise (§5.4, DD §D). Um einen abgeleiteten Node anzureichern, muss
  die Annotation **dieselbe id** verwenden — die abgeleiteten ids stehen nach
  `ductus extract` in `journey-graph.json`.
- **Nie zwei manuelle Quellen für dasselbe Feld.** Widersprechen sich zwei
  manuelle Quellen, bricht der Merge fail-fast mit beiden Quellenangaben ab
  (DD §D); im Dart-Projekt erkennt das bereits der Adapter, das CLI endet
  dann mit Exit 3 (Adapterfehler). Jedes Element genau einmal manuell
  beschreiben.
- **Buildfreier Einstieg über die Kommentar-Konvention:** braucht keinerlei
  Dependency im Zielprojekt (siehe [dart/ductus](dart/ductus)).
- **Weg D für build_runner-Projekte:** Wer ohnehin `build_runner` fährt,
  lässt den Builder `journey_builder` den Graphen als `ductus_builder.g.json`
  miterzeugen und speist ihn per `extra: { fromBuilder: true }` in der
  `adapters:`-Sektion (gleichwertig: `fromBuilder: true` direkt unter dem
  Adapter, bzw. `--from-builder` am Adapter-CLI) ein — mit Resolution
  nicht-literaler konstanter Annotation-Argumente, die parse-only
  ablehnen müsste. Bei rein literalen Annotationen ist das Artefakt bis auf
  den `meta.adapters`-Namen (`dart-builder` statt `dart`) byte-identisch
  zur parse-only-Ausgabe; es ist so aktuell wie der letzte
  build_runner-Lauf (DD §N, Setup in [dart/ductus](dart/ductus)).

### Arbeitsablauf

- **Erst `extract` grün bekommen, dann `generate`.** `ductus extract` und
  `ductus graph --open` laufen ohne LLM und kosten nichts — Validierungsfehler
  und V5-Warnungen zuerst beheben, den Graphen inspizieren, erst dann
  generieren.
- **`journey-graph.json` und die generierte Doku mit dem Code versionieren.**
  Der Graph ist byte-stabil serialisiert (NFR2) — Änderungen bleiben als
  saubere Diffs im Review sichtbar.
- **Generierte Doku nicht von Hand editieren.** Der nächste `generate`-Lauf
  schreibt die Seiten neu (unveränderte Segmente kommen unverändert aus dem
  Cache, §8.5). Korrekturen gehören in den Graphen — auch bei
  `:::caution`-Faithfulness-Warnungen im Output (DD §K): `description`,
  `label`, `condition` nachschärfen statt Text flicken.
- **`ductus check` in CI.** Validiert und bewertet Faithfulness aus dem
  Segment-Cache — ohne LLM-Aufrufe, ohne Kosten (DD §B.8). Exit-Codes (§10.3,
  DD §I): `0` ok · `1` Validierungsfehler oder Merge-Konflikt zwischen
  mehreren Adapter-Ausgaben · `2` Faithfulness über
  `llm.faithfulnessThreshold` (Default `0` — schon ein einzelner
  Judge-Treffer schlägt fehl) · `3` LLM-/Konfigurations-/Adapterfehler, auch
  für Konflikte, die bereits im Adapter erkannt werden (siehe oben).
  Segmente ohne Cache-Eintrag meldet `check` nur als „noch nicht generiert"
  (Exit bleibt 0) — Faithfulness prüft es also nur, wenn `.ductus/cache` aus
  einem `generate`-Lauf vorliegt.

### LLM & Kosten

- **Der Segment-Cache hasht Inhalte.** Cache-Key ist SHA-256 über das
  kanonische Segment-JSON plus Prompt-Version, Modell, `voice` und `locale`
  (DD §J). Stabile ids/Titel vermeiden Neugenerierung; ein Wechsel von Modell,
  `voice` oder `locale` invalidiert dagegen alle Segmente — ein
  `granularity`-Wechsel ebenfalls, weil er den Segment-Zuschnitt und damit
  die Segment-JSONs ändert.
- **Kostenschätzung vor dem Lauf lesen.** `generate` gibt sie vor dem ersten
  Provider-Aufruf aus (NFR3); mit konfiguriertem `llm.pricing` (Preis je 1M
  In-/Out-Token) auch in USD (DD §J).
- **`temperature` niedrig, `faithfulnessCheck` an lassen** (Defaults `0.2`
  bzw. `true`). Niedrige Temperatur dient dem Determinismus (§8.5); der Judge
  markiert ungedeckte Behauptungen im Output und in `ductus-report.json`.
- **API-Key ausschließlich per Umgebungsvariable.** Die Config kennt nur
  `llm.apiKeyEnv` — den *Namen* der Variable (Default `DUCTUS_LLM_API_KEY`),
  nie den Schlüssel selbst; er wird weder geloggt noch persistiert (NFR4).
- **Tests/CI ohne Kosten:** `llm.provider: mock` (deterministisch, netzfrei)
  plus `--offline` (DD §B.4, §B.9).

### Website

- **`diagrams: true` (Default) belassen:** jede Flow-Seite erhält das
  `flowchart`, dazu das Hauptpfad-`journey`, sobald der Hauptpfad mindestens
  zwei Knoten hat (siehe [oben](#diagramme-in-der-generierten-doku), DD §L).
- **CI-Deploys mit `ductus generate --build`:** baut die Website nach dem
  Export; das Ergebnis unter `<output.dir>/dist` ist rein statisch hostbar
  (DD §M). `--build` ist mit `--offline` nicht kombinierbar.

## Repository-Layout

```
packages/{schema,core,adapter-dart}   # npm-Pakete (TypeScript)
dart/ductus                           # pub.dev-Paket (Annotationen + Adapter)
templates/                            # Website-Templates (journey = Default, starlight)
examples/                             # Beispiel-Apps mit Annotationen
```

Verbindliche Spezifikation: [SPEC.md](SPEC.md) ·
Entscheidungen/Annahmen: [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md)

## Entwicklung

```bash
npm install && npm run build && npm test      # TS-Pakete
cd dart/ductus && dart pub get && dart test   # Dart-Adapter
```

CI: [.github/workflows/ci.yml](.github/workflows/ci.yml) führt bei jedem Push
und Pull Request drei Jobs aus — Node (Build + Vitest), Dart
(`dart analyze` + `dart test` in `dart/ductus`) und `flutter analyze` für
beide Beispiel-Apps unter `examples/`.

## Lizenz

[MIT](LICENSE) für alle Pakete in diesem Repository (§11 der Spec).
