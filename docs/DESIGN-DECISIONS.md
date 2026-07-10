# Ductus — Designentscheidungen & Annahmen (Phase 1)

Dieses Dokument hält alle Entscheidungen fest, die die SPEC offen lässt (bzw. wo sie
intern in Spannung steht), und fixiert die Verträge zwischen den Paketen. Es ist
**bindend** für alle Phase-1-Implementierungen. Referenzen wie „§6" meinen SPEC.md.

## A. Aufgelöste offene Fragen

| # | Frage | Entscheidung | Status |
|---|---|---|---|
| Q1 | Granularität-Default | `flow` als Default, `screen` per Config (`style.granularity`) | Spec-Empfehlung |
| Q2 | SSG-Default | **Starlight** (Speed, eingebaute Suche). `docusaurus` bleibt als Config-Wert reserviert, Phase 1 liefert nur das Starlight-Preset in `templates/starlight/` | **Annahme** |
| Q3 | Produktname | „Ductus" bleibt Platzhalter; Identifier `@ductus/*` (npm), `ductus` (pub.dev) | **Annahme** |

## B. Annahmen (Spec schweigt oder steht in Spannung)

1. **NFR2 vs. `meta.generatedAt` (§6.1):** Byte-Stabilität gewinnt. `journey-graph.json`
   enthält **keinen** Zeitstempel; `generatedAt` bleibt im Schema optional erlaubt,
   der Core schreibt ihn nur in `ductus-report.json`.
2. **Actions sind Edges:** `@JourneyAction` / `@journey:action` erzeugt eine **Edge**
   (from→to, trigger, label, condition) — konsistent mit dem §15-Beispiel. Action-*Nodes*
   (`type: "action"`) bleiben schema-valide (für andere Adapter/handgeschriebene Graphen),
   der Dart-Adapter emittiert in Phase 1 keine.
3. **`from` optional bei Actions:** Fehlt `from`, gilt der umschließende, als Screen
   annotierte Kontext (Dart: die Klasse mit `@JourneyScreen`; Kommentar-Weg: die
   umschließende Klasse, falls sie ein Screen-Node ist). Nicht auflösbar ⇒ Adapter-Fehler.
4. **LLM-Provider ohne SDKs:** Anthropic Messages API, OpenAI Chat Completions und
   `custom` (OpenAI-kompatible `baseUrl`) über natives `fetch`. Zusätzlich Provider
   `mock` (deterministisch, offline) für Tests und Vorschau.
5. **Dart-Adapter via `package:analyzer` (parse-only) statt build_runner-Lauf im
   Zielprojekt:** Erfüllt §7.1/§7.2 vollständig; sieht go_router-Tabellen und
   Kommentar-Blöcke (was `GeneratorForAnnotation` nicht kann); Zielprojekte brauchen
   kein `pub get`/Build-Setup. Bewusste Abweichung vom Implementierungs-Detail §7.3;
   ein source_gen-Builder kann später ergänzt werden, ohne den Vertrag zu ändern —
   inzwischen als Weg D umgesetzt (§N).
6. **Faithfulness-Schwellwert:** `llm.faithfulnessThreshold` (Default `0`) — mehr
   Verstöße als der Schwellwert ⇒ Exit-Code 2 bei `generate`/`check`.
7. **Website-Modus:** `output.dir` ist die Wurzel des Starlight-Projekts; MDX landet in
   `<dir>/src/content/docs/`, Sidebar-Konfig wird generiert. Der SSG ist Peer-Dependency
   (Nutzer führt `npm install && npm run build` im Site-Verzeichnis aus — oder überlässt
   das `ductus generate --build`, §M).

8. **`ductus check` ohne LLM-Aufrufe:** `check` validiert immer (Exit 1 bei V1–V4/V6);
   Faithfulness wird aus den Cache-Einträgen der aktuellen Segmente bewertet
   (CI-tauglich, offline-sicher; keine Neuschreibung, keine Kosten). Segmente ohne
   Cache-Eintrag werden als „noch nicht generiert" gemeldet. Exit 2 bei Verstößen
   über `llm.faithfulnessThreshold`. *(Annahme)*
9. **`--offline` (NFR4):** erlaubt `extract`, `check` und `graph` uneingeschränkt;
   `generate` nur mit `provider: mock` (netzfrei), sonst Exit 3. *(Annahme)*
10. **Artefakt-Pfade:** `journey-graph.json` und `ductus-report.json` liegen neben der
    `ductus.config.yaml` (rootDir); Cache und Graph-HTML unter `.ductus/`. *(Annahme)*

## C. Kanonische Serialisierung (NFR2, A4) — gilt für Core **und** Adapter

- UTF-8, LF, 2-Space-Indent, abschließender Zeilenumbruch.
- Objekt-Schlüssel lexikographisch sortiert.
- `flows`/`nodes`/`edges` nach `id` sortiert; `tags`, `app.platforms` sortiert;
  `meta.adapters` nach `name` sortiert.
- Kein `generatedAt` in `journey-graph.json` / Adapter-stdout.

## D. Merge- & Präzedenzregeln (§5.4) — identisch in Adapter (intern) und Core

- Gleiches `node.id` aus mehreren Quellen ⇒ feldweiser Merge:
  - `annotation` (Weg A/B) überschreibt `derived` (Weg C) pro Feld.
  - Zwei **manuelle** Quellen mit unterschiedlichen Werten für dasselbe Feld ⇒
    **Fehler** (fail-fast) mit beiden `sourceRef`s. Gleicher Wert ⇒ ok.
  - Gemergter Node erhält `source`/`sourceRef` der höchst-präzedenten Quelle.
- Edges: Identität über `id`; ohne explizite `id` wird `e_<from>_<to>` generiert
  (Kollisionen: Suffix `_2`, `_3`, … in deterministischer Reihenfolge nach
  Datei/Zeile). Derived-Edge und manuelle Edge mit gleichem (from, to) ⇒ manuelle
  überschreibt feldweise. Zwei manuelle Edges mit gleichem (from, to), aber
  verschiedenen `id`s ⇒ beide bleiben (parallele Transitionen sind legitim).
- Flows: wie Nodes.

## E. Annotations-API (pub.dev-Paket `ductus`) — fixiert

```dart
enum JourneyTrigger { tap, submit, auto, back, deeplink, system }

@JourneyScreen(id, title, {flow, description, tags})       // auf Klassen
@JourneyDecision(id, title, {flow, description, tags})     // auf Klassen/Funktionen
@JourneyAction(label, to, {from, id, trigger = JourneyTrigger.tap, condition})
                                                            // auf Methoden/Funktionen/Feldern
@JourneyFlow(id, title, start, {description})               // auf Klassen/Libraries
```

Alle Parameter `String` bzw. `List<String> tags`; `trigger` ist `JourneyTrigger`.

Parse-only-Lesbarkeit (B.5): Argumente müssen String-Literale sein. Ein vorhandenes,
aber nicht literal lesbares Argument (z. B. Const-Referenz) wird nie stillschweigend
verworfen: Pflichtfelder (`id`, `title`, `label`, `to`, `start`) sowie `from`
(explizit gesetzt schlägt die Inferenz aus B.3 aus) ⇒ Adapter-Fehler; optionale
Felder (`flow`, `description`, `condition`, Action-`id`, `tags`/-Elemente) ⇒
stderr-Warnung, Feld entfällt. `trigger` behält sein Verhalten (Warnung, Default `tap`).

## F. Kommentar-Konvention (§5.1) — Grammatik

- Block beginnt in einer Kommentarzeile mit `@journey:<typ>` (`screen|action|decision|flow`),
  Fortsetzung in unmittelbar folgenden Kommentarzeilen, endet an der ersten
  Nicht-Kommentar-Zeile oder am nächsten `@journey:`-Block.
- Paare `key="value"`; Werte dürfen Leerzeichen enthalten; `\"` escaped ein Anführungszeichen.
- Keys je Typ (Pflicht mit *):
  - `screen`: `id`* `title`* `flow` `description` `tags` (kommasepariert)
  - `action`: `label`* `to`* `from` `id` `trigger` `condition`
  - `decision`: `id`* `title`* `flow` `description` `tags`
  - `flow`: `id`* `title`* `start`* `description`
- Unbekannte Keys: ignorieren, Warnung auf stderr (§5.1).

## G. Ableitung (Weg C) — Umfang Phase 1

- **go_router:** `GoRoute(path:, name:)` (auch verschachtelt via `routes:`) ⇒ Screen-Node.
  - Node-`id` = `name`, sonst Pfad-Slug (führendes `/` weg, `/`→`-`, `:param` entfällt,
    leer ⇒ `root`). `title` = humanisierte id. `source: "derived"`.
  - Der Slug wird über den **gejointen Vollpfad** gebildet (Eltern-Pfade via `routes:`
    vorangestellt), nicht über das relative Segment — sonst kollabierten verschachtelte
    Routen mit gleichem Segment (z. B. `detail` unter `/user` und `/admin`)
    stillschweigend zu einem Node. `/users/:id` + `edit` ⇒ `users-edit`, identisch zur
    flachen Schreibweise `/users/:id/edit`.
  - `ShellRoute` ⇒ Flow `shell-<index>` (deterministisch), Kind-Screens erhalten diesen Flow.
  - `redirect:` an einer Route ⇒ Decision-Node `<screenId>_redirect` mit Edge
    (decision → screen, trigger `auto`); String-Literale im redirect-Body, die bekannten
    Routen entsprechen, ergeben zusätzliche bedingte Edges (best effort).
  - `context.go()/push()/goNamed()/pushNamed()` mit Literal-Argument ⇒ Transition-Kandidat;
    `from` = Screen der umschließenden Widget-Klasse (annotiert oder via
    `builder: (…) => Klasse(…)` einer Route zuordenbar), sonst verworfen (stderr-Hinweis).
- **auto_route:** `@RoutePage()`-Klassen ⇒ Screen-Kandidaten (id = kebab-case des
  Klassennamens ohne `Screen`/`Page`-Suffix); `AutoRoute(page:, path:, initial:)`-Einträge
  liefern Pfade. Best effort (R6), Ergänzung via Annotationen.

## H. Adapter-CLI-Vertrag (konkretisiert §7.1)

```
dart run ductus:adapter --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

- stdout: **genau ein** kanonisches Graph-JSON; stderr: Diagnostik; Exit 0/≠0.
- `--config`: JSON mit `{ "deriveFrom": ["go_router","auto_route"], "include": ["lib/**"],
  "fromBuilder": false }` (Defaults: beide Ableitungen an, `lib/**`, kein
  Builder-Durchreichen). Der Core schreibt diese Datei temporär aus
  der `adapters:`-Sektion der `ductus.config.yaml`.
- `--from-builder` (äquivalent Config-Schlüssel `fromBuilder: true`; das Flag
  gewinnt): Weg D — reicht `<project>/ductus_builder.g.json` nach
  `schemaVersion`-Prüfung durch statt selbst zu scannen (Details §N).
- Schreibt zusätzlich `ductus_graph.g.json` ins Projekt (Debugging, §7.3),
  abschaltbar mit `--no-debug-file`; mit `--from-builder` entfällt sie
  (kein Scan).
- `meta.adapters = [{name: "dart", version: "<pkg-version>"}]` — das
  build_runner-Artefakt aus §N trägt stattdessen `name: "dart-builder"`.
- Der npm-Wrapper `@ductus/adapter-dart` stellt das Binary `ductus-adapter-dart` bereit
  und delegiert an `dart run ductus:adapter …`.
- **Auflösungskette für den Dart-Aufruf** (buildfreie Nutzung, §5.1: Weg A braucht
  KEINE Build-Abhängigkeit im Zielprojekt). Identisch implementiert im Core-Runner
  (`resolveDartInvocation`) und im npm-Wrapper; `--project` wird immer absolut übergeben,
  der stdout/stderr-Vertrag bleibt unverändert:
  1. Expliziter `command` aus der `adapters:`-Sektion (nur Core-Runner) — höchste Priorität.
  2. Umgebungsvariable `DUCTUS_DART_ADAPTER_DIR`: Pfad zu einem Paketkontext, der `ductus`
     kennt (z. B. ein Checkout von `dart/ductus`) ⇒ `dart run ductus:adapter` mit
     cwd = diesem Verzeichnis. Nicht existierender Pfad ⇒ klarer Fehler.
  3. Das Zielprojekt deklariert `ductus` in der `pubspec.yaml` unter
     `dependencies`/`dev_dependencies` (einfacher zeilenbasierter YAML-Check) ⇒
     cwd = Projektverzeichnis (bisheriges Verhalten).
  4. `ductus` ist global aktiviert (rein lesende Prüfung über `dart pub global list`):
     bei **path-Aktivierung** (`--source path`) läuft `dart run ductus:adapter` mit
     cwd = gemeldetem Quellverzeichnis — `dart pub global run` würde dort bei jedem
     Lauf pub-Resolutionszeilen auf **stdout** schreiben und den §7.1-Vertrag brechen;
     bei hosted-Aktivierung `dart pub global run ductus:adapter` (Snapshot, stdout-sauber).
  Greift keine Kette ⇒ verständliche Fehlermeldung mit beiden Optionen
  (`dart pub add dev:ductus` ODER `dart pub global activate ductus`). *(Annahme)*
- **Robustheit gegen pub-Vorspann:** Schreibt pub vor dem Adapter dennoch
  Diagnosezeilen auf stdout (z. B. „Resolving dependencies…" bei unaufgelöstem
  Paketkontext), schneiden Core-Runner und npm-Wrapper ausschließlich den Vorspann
  bis zur ersten mit `{` beginnenden Zeile ab und reichen ihn als Diagnostik
  (stderr/log) weiter — der Vertrag bleibt strikt: parst der Rest nicht, gilt
  weiterhin der A3-Fehler mit dem Original-stdout. *(Annahme)*

## I. Exit-Codes des Core-CLI (§10.3)

`0` ok · `1` Validierungsfehler (V1–V4, V6) oder Merge-Konflikt · `2` Faithfulness
über Schwellwert · `3` LLM-/Konfigurations-/Adapterfehler.

## J. Cache & Kosten (§8.5, NFR3)

- Cache-Key: SHA-256 über kanonisches Segment-JSON + Prompt-Version + Modell +
  Styleguide-Konfig (`voice|locale`). Ablage `.ductus/cache/<hash>.json`.
  `granularity` ist bewusst kein Key-Bestandteil: ein Wechsel ändert den
  Segment-Zuschnitt und damit das Segment-JSON selbst — die Invalidierung
  passiert dadurch, und beim Zurückwechseln bleiben alte Einträge Treffer.
- Token-Schätzung vorab: `ceil(chars/4)` je Prompt; nach Lauf: echte `usage`-Werte des
  Providers. Kosten in USD nur, wenn `llm.pricing` (Preis je 1M In-/Out-Token)
  konfiguriert ist — Preise ändern sich zu schnell für eingebaute Tabellen. *(Annahme)*

## K. Markierung von Faithfulness-Treffern im Output (§8.3 Schritt 4, R1)

- Seiten mit Judge-Violations erhalten im MDX-Body **vor** dem generierten Inhalt ein
  Starlight-Aside `:::caution[Faithfulness-Warnung]` mit je einer Zeile
  `- <claim>: <reason>` pro Violation. Deterministisch (NFR2): Violations stammen aus dem
  (cache-stabilen) Judge-Ergebnis, Reihenfolge unverändert.
- Kein zusätzliches Frontmatter-Feld — maschinelle Auswertung läuft über
  `ductus-report.json` (§9.3); das Aside adressiert den menschlichen Reviewer. *(Annahme)*

## L. Journey-Diagramme (Mermaid `journey`)

- **Hauptpfad statt Vollgraph:** Mermaids `journey`-Typ ist strikt linear
  (title/section/tasks — keine Verzweigungen), der Journey-Graph verzweigt aber.
  Deshalb rendert der Core pro **Flow-Segment** (Segment mit `flow` und
  `flow.start`) zusätzlich zum bestehenden `flowchart` ein `journey` des
  deterministisch abgeleiteten **Hauptpfads**; screen-/misc-Segmente erhalten
  kein `journey`. *(Annahme)*
- **Deterministische Pfad-Ableitung (NFR2):** Start bei `flow.start`. Pro Schritt
  wird aus den ausgehenden Kanten des Segments (`edge.from` = aktueller Knoten,
  Ziel im Segment vorhanden und noch nicht besucht) genau **eine** Kante gewählt —
  Priorität: (1) `trigger !== "back"` vor `trigger === "back"`, (2) ohne
  `condition` vor mit `condition` (Leerstring zählt wie keine `condition` —
  konsistent zur Kantenbeschriftung und zu V5c), (3) kleinste `edge.id`
  (einfacher `cmp`, kein `localeCompare`). Abbruch ohne Kandidaten oder nach
  100 Schritten (Sicherheitslimit). Ein `journey` entsteht nur, wenn der Pfad
  mindestens 2 Knoten hat.
- **Nichts erfinden (R1):** Task-Score konstant `3` (neutral — der Graph enthält
  kein Sentiment), keine Akteure. Task-Label konsistent zu `renderNode` in
  `mermaid.ts` (`label ?? title ?? id` für Action-Knoten, sonst `title ?? id`;
  ergibt das nur Whitespace, greift zusätzlich die `id` — eine leere Task-Zeile
  wäre invalide); Kantenlabels erscheinen im `journey` nicht — dafür gibt es
  das `flowchart`.
- **Escaping in Titel/Task-Labels:** **erst** `#` → `#35;`, **dann** `:` → `#58;`
  und `;` → `#59;` (Reihenfolge wichtig, sonst würde das `#` der eigenen Entities
  zerstört); Zeilenumbrüche → ein Leerzeichen. Task-Labels, die (case-insensitive)
  mit `journey`, `section` oder `title` oder mit `%%` beginnen, würden Mermaids
  Lexer als Statement bzw. Kommentar erreichen (Parse-Fehler oder still
  verschluckter Task) — deshalb wird dort zusätzlich das erste Zeichen als
  Entity `#<code>;` geschrieben; gerendert wird das Original-Zeichen.
- **MDX-Ausgabe:** Bei aktivierten Diagrammen erhält jede Flow-Seite **vor** dem
  Abschnitt „## Ablaufdiagramm" einen Abschnitt „## Hauptpfad" mit dem `journey`
  im mermaid-Codefence. Reihenfolge im Body: Faithfulness-Aside → LLM-Markdown →
  „## Hauptpfad" → „## Ablaufdiagramm".
- **CLI:** `ductus graph --journey` gibt statt des Flowcharts die
  `journey`-Diagramme aller Flows aus (sortiert nach `flow.id`, getrennt durch
  eine Leerzeile); gibt es keine Flows oder keinen Pfad ≥ 2 Knoten, Hinweis auf
  stderr und Exit 0. Das `--open`-HTML zeigt immer beides: das Flowchart plus je
  Flow eine Überschrift mit dem `journey`. Achtung: Bei mehreren Flows ist die
  stdout-/`--out`-Ausgabe eine **Sammlung** von Diagrammen — als einzelnes
  Mermaid-Dokument geparst (z. B. `mmdc` auf die ganze Datei) ist die
  Konkatenation invalide; Konsumenten müssen an Leerzeilen splitten. Das
  `--open`-HTML ist nicht betroffen (ein `<pre class="mermaid">` je Diagramm).
- **Starlight-Template (client-seitiges Rendering):** Ein remark-Plugin in
  `astro.config.mjs` wandelt Codeblöcke der Sprache `mermaid` in
  `<pre class="mermaid">` um. Registriert wird es über `markdown.processor`
  (`unified({ remarkPlugins })` aus `@astrojs/markdown-remark`), weil Astro ≥ 6.4
  `markdown.remarkPlugins` deprecatet hat und Starlight Markdown **und** MDX über
  diesen Prozessor rendert. Das Plugin setzt hast-Daten (`hName`/`hChildren`,
  automatisch HTML-escaped) statt roher html-Nodes — die verwirft der
  MDX-Compiler. Gerendert wird im Browser per CDN (mermaid@11 von jsdelivr,
  gleiche Quelle wie `.ductus/graph.html`), theme-aware über Starlights
  `data-theme`-Attribut (Neu-Rendern bei Theme-Wechsel). Ohne Netz bleibt der
  Codeblock als lesbarer Fallback stehen. *(Annahme)*

## M. `ductus generate --build` (Website-Modus)

- **Opt-in-Build:** `--build` baut nach erfolgreichem Website-Export zusätzlich die
  Website; ohne das Flag bleibt der Build wie bisher Sache des Nutzers (§B.7).
  Nur mit `output.format: website` sinnvoll — bei `mdx` bricht das CLI mit einem
  Usage-Fehler ab (Exit 3, §I), kein stiller Fallback. `--build` + `--offline` ist
  ebenfalls ein Usage-Fehler (Exit 3): `--offline` garantiert „kein Netz",
  `npm ci`/`npm install` würde das brechen. *(Annahme)*
- **Ablauf:** Im Site-Verzeichnis (`output.dir`) läuft `npm ci` (bei vorhandener
  `package-lock.json`) bzw. `npm install`, danach `npm run build` — cwd =
  Site-Verzeichnis, stdout/stderr werden geerbt (Nutzer sieht den npm-Fortschritt
  unverändert). npm wird direkt gespawnt (kein `shell: true`); unter win32 wäre
  `npm.cmd` nötig, Zielplattformen sind darwin/linux. Erfolgsmeldung:
  `Website gebaut: <output.dir>/dist`.
- **Fehler & Exit-Codes (§I):** npm nicht gefunden (ENOENT) oder ein npm-Schritt
  mit Exit ≠ 0 ⇒ klare deutsche Meldung, welcher Schritt scheiterte, und Exit 3
  (`WebsiteBuildError`). Der Build läuft nur, wenn `generate` bis dahin erfolgreich
  war (Exit wäre 0 oder 2); ein Faithfulness-Exit 2 wird durch einen erfolgreichen
  Build NICHT auf 0 maskiert (2 bleibt 2) — scheitert der Build, gewinnt dessen
  Exit 3.

## N. Weg D — build_runner-Builder

- **Motivation & Abgrenzung:** Projekte, die ohnehin `build_runner` fahren,
  extrahieren den Journey-Graphen als Builder-Schritt. Mehrwert gegenüber dem
  parse-only-Adapter (§B.5) ist **Resolution**: nicht-literale konstante
  Annotation-Argumente (z. B. `title: MyConstants.title`, statische
  `const`-Referenzen) werden über den resolved AST aufgelöst (source_gen
  `TypeChecker` identifiziert `@JourneyScreen` & Co. robust per Bibliotheks-URI,
  `ConstantReader` liest die konstanten Werte), statt nach §E als
  Fehler/Warnung abgelehnt zu werden. Der Adapter-Vertrag §7.1 bleibt
  **unverändert** (stdout = genau ein JSON); der Builder ist ein zusätzlicher
  Zubringer, keine Ablösung.
- **Paket & Import-Hygiene:** Kein neues Paket — der Builder lebt in
  `dart/ductus` (analyzer ist dort ohnehin Dependency). `lib/ductus.dart`
  (Annotations-Export) importiert `build`/`source_gen` **nicht**; der Builder
  liegt in `lib/builder.dart` (Factory
  `Builder ductusJourneyBuilder(BuilderOptions options)`) plus
  `lib/src/builder/*.dart`. `build.yaml` im Paket: Builder `journey_builder`,
  `import: package:ductus/builder.dart`, `auto_apply: dependents`,
  `build_to: source`; aggregierender Builder mit synthetischem Input
  (`buildExtensions: {r'$package$': ['ductus_builder.g.json']}`) — dadurch
  läuft er genau einmal pro Paket statt einmal pro Datei.
- **Artefakt:** `ductus_builder.g.json` im Projekt-Root des Zielpakets —
  schema-valider Journey-Graph in der kanonischen Serialisierung (§C) mit
  `meta.adapters`-Eintrag `{name: "dart-builder", version: <Paketversion>}`.
  **Nicht verwechseln:** `ductus_graph.g.json` ist bereits die Debug-Datei
  des Adapter-CLI (§H) und behält diese Rolle; der Builder schreibt bewusst
  einen anderen Dateinamen. Empfehlung für Ziel-Apps: `ductus_builder.g.json`
  in die `.gitignore` aufnehmen (Build-Artefakt, analog `ductus_graph.g.json`).
- **Wiederverwendung statt Kopie:** Der Builder nutzt die bestehende Pipeline
  (scanner, comment_parser, annotation_extractor,
  derive_go_router/derive_auto_route, merger, kanonische Serialisierung).
  Einziger Unterschied ist der zusätzliche Resolutions-Schritt für
  Annotationen. Fallback: Was der Resolver nicht konstant auflösen kann,
  behandelt der Builder exakt wie der parse-only-Extraktor — gleiche
  Fehler-/Warnungsformate nach §E (Pflichtfelder ⇒ Fehler, optionale Felder ⇒
  stderr-Warnung, `trigger` ⇒ Default `tap`).
- **Paritäts-Garantie (Kernanforderung):** Für Projekte, deren Annotationen
  ausschließlich Literale nutzen, ist `ductus_builder.g.json` byte-identisch
  mit der stdout-Ausgabe des parse-only-Adapters — **bis auf genau eine
  gewollte Ausnahme:** `meta.adapters[0].name` ist `dart-builder` statt
  `dart` (Provenance, siehe Artefakt oben; §H bleibt für das CLI bei
  `dart`). `flows`/`nodes`/`edges`/`schemaVersion` entstehen aus derselben
  Merge-/Sortier-/Serialisierungslogik (NFR2) und sind byte-identisch;
  inhaltliche Abweichungen entstehen nur dort, wo Resolution zusätzliche
  Werte liefert. Ein byte-genauer Paritäts-Vergleich (z. B. `diff` in CI)
  muss den `meta.adapters`-Namen normalisieren.
- **Versionsranges (NFR8):** `build` und `source_gen` kommen als reguläre
  dependencies dazu, `build_runner`/`build_test` als dev_dependencies (nur
  für die Builder-Tests). Die konkreten Ranges werden **empirisch** ermittelt
  und stehen samt Begründungskommentar in der `pubspec.yaml` (hier keine
  Zahlen, sie veralten). Entscheidungsregel: `dart pub get` muss mit
  analyzer-Serie 13 **und** 14 auflösbar bleiben, und
  `examples/flutter_go_router_demo` muss mit dem Flutter-meta-Pin
  (`flutter pub get`) auflösbar bleiben. Geben source_gen/build das mit
  beiden Serien nicht her, wird die analyzer-Serie auf die mit aktuellem
  Flutter stable auflösbare eingeengt; diese NFR8-Abwägung ist dann im
  pubspec-Kommentar festzuhalten (Flutter-Kompatibilität schlägt Breite).
- **`--from-builder` (Adapter-CLI):** Neues Flag, äquivalent der
  Config-Schlüssel `fromBuilder: true` in der `--config`-JSON (das Flag
  gewinnt). Liest `<project>/ductus_builder.g.json`, prüft `schemaVersion`
  (V6-Logik wie vorhanden) und emittiert die Datei nach stdout — **kein
  eigener Scan**. Fehlt die Datei: klarer deutscher Fehler mit Hinweis auf
  `dart run build_runner build`, Exit ≠ 0. Damit funktioniert Weg D auch
  über das Core-CLI: `adapters: - dart: { extra: { fromBuilder: true } }`.
  Der Core flacht einen literalen `extra:`-Block dafür **ab** — seine
  Schlüssel landen top-level in der temporären `--config`-Datei des
  Core-Runners (§H); ohne Abflachung entstünde `{"extra": {...}}`, das der
  Adapter stillschweigend ignorieren würde. Unbekannte flache Schlüssel
  direkt unter dem Adapter (`- dart: { fromBuilder: true }`) wirken
  gleichwertig und gewinnen bei Namensgleichheit über den Block
  (Regressionstests in `packages/core/test/integration/config.test.ts`).
- **Builder-Optionen & Target-Sources:** Der Builder akzeptiert in der
  `build.yaml` des Zielpakets die Optionen `deriveFrom` und `include`
  (gleiche Schlüssel und Defaults wie die `--config`-JSON des CLI).
  Einschränkung: `buildStep.findAssets` sieht nur Assets der
  build_runner-**Target-Sources** (Default u. a. `lib/`) — ein
  `include`-Muster außerhalb davon (z. B. `extra/**`) liefert im Builder
  keine Dateien, während das Adapter-CLI sie scannen würde. Der Builder
  warnt deshalb pro `include`-Muster ohne Treffer; wer solche Pfade
  braucht, erweitert `targets.$default.sources` in der `build.yaml` des
  Zielpakets oder nutzt das Adapter-CLI. Mit dem Default `lib/**` tritt
  die Abweichung nicht auf.
- **Staleness:** `ductus_builder.g.json` ist so aktuell wie der letzte
  build_runner-Lauf; das CLI erkennt eine veraltete Datei nicht. Wer
  `--from-builder` nutzt, führt vor `ductus extract` also
  `dart run build_runner build` aus (oder lässt `watch` laufen).

## O. Website-Generator `journey` als Default (2026-07-09)

- **Entscheidung:** Der Website-Modus (§9.2) erhält einen neuen Generator-Wert
  `journey` mit eigenem Template `templates/journey` — pures Astro **ohne**
  Starlight — und dieser wird der **neue Default** von
  `output.website.generator`. `starlight` bleibt als Preset wählbar
  (Verhalten byte-identisch zu Phase 1: Template-Kopie, MDX unter
  `src/content/docs/`, `ductus.sidebar.json`, `ductus.site.json`);
  `docusaurus` bleibt in Phase 1 abgelehnt (Guard in `pipeline.ts`, Exit 3).
- **Herkunft:** Das journey-Template setzt den Design-Prototyp
  „Ductus Doku Website" um — eine journey-zentrierte Doku-Site statt einer
  generischen Doku-Sidebar; deshalb ein eigenes Template statt
  Starlight-Theming.
- **Datenvertrag `ductus.data.json`:** Im journey-Modus schreibt
  `scaffoldWebsite` **keine** MDX-Dateien und **keine**
  `ductus.site.json`/`ductus.sidebar.json`, sondern genau **eine**
  `ductus.data.json` in die Site-Wurzel; das Template liest sie zur
  Buildzeit. Aufbau (`dataVersion: "1"`): `site` (title, locale,
  `ductusVersion` — zur Laufzeit aus der package.json von `@ductus/core`
  gelesen, kein Hardcoding —, adapters nach name sortiert, violationsTotal)
  und `journeys` (je Segment: id, slug, kind, order, title, description,
  startNodeId, nodes, edges, mainPath, markdown **pur** — ohne
  Mermaid-Anhänge, ohne Aside —, violations). Deterministisch (NFR2):
  journeys nach order (Tie-Break slug), nodes/edges nach id, LF,
  abschließender Zeilenumbruch, keine Zeitstempel. `edges[].main` ist der
  0-basierte Index der Hauptpfad-Kante (gewählt mit exakt derselben
  Priorität wie die journey-Ableitung in §L, jetzt als `deriveMainPath` in
  `output/mermaid.ts` extrahiert), sonst `null`; Node-`title` folgt der
  renderNode-/journeyTaskLabel-Logik (action: label ?? title ?? id, sonst
  title ?? id). Typen: `JourneyWebsiteData` u. a. in
  `packages/core/src/contracts.ts`, Aufbau in
  `packages/core/src/output/journey-data.ts`.
- **Template-Auflösung:** `resolveTemplateDir` ist auf den Generator
  parametrisiert (`<corePkg>/assets/templates/<generator>`, Repo-Fallback
  `templates/<generator>`); `scripts/copy-assets.mjs` kopiert alle
  Verzeichnisse unter `templates/` in die Paket-Assets.
