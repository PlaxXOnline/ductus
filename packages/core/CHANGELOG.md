# @ductus/core

## 0.4.0

### Minor Changes

- 84a6ec9: English is now the default language across the toolchain. All CLI output,
  help text, error messages and code comments are English; `ductus init`
  scaffolds `app.locale: en` and `style.voice: en-you` (German voices
  `formal-sie`/`informal-du` remain fully supported). New `ductus help
[command]` subcommand with a rich overview: typical workflow, per-command
  one-liners, exit codes, config and API-key notes. Generated output is now
  locale-aware instead of hardcoded German: MDX section headings, the
  faithfulness-warning aside, the Mermaid journey section, the misc-segment
  title and the mock provider follow `app.locale`/voice (German only for
  `de*` locales); the page-slug fallback changed from `seite` to `page`, and
  the journey website template falls back to English UI strings for non-German
  locales. The faithfulness judge now receives an English prompt for the
  `en-you` voice (German voices keep the previous prompt byte-identically);
  PROMPT_VERSION was bumped to 3, so existing segment caches regenerate once. Derived redirect decision nodes are titled `Redirect: <Screen>`
  (previously `Weiterleitung: <Screen>`). READMEs are English with German,
  Spanish and Simplified Chinese translations alongside.
- 15a669c: Verified faithfulness checking — LLM statements are no longer trusted blindly:

  - **Deterministic lexicon check** (always on, no LLM): every `**bold**` term in
    step lines of the generated Markdown is checked against the graph segment's
    vocabulary (node titles, edge labels, conditions, app name). Invented UI
    elements are caught deterministically.
  - **Judge verification**: the faithfulness judge must now cite the offending
    passage verbatim (`quote`) and name the missing `element`; both are verified
    mechanically. Refuted findings (quote not in text, or element present in the
    segment) are discarded, borderline findings are reported as separate `hints`
    that do not count against `faithfulnessThreshold`.
  - **Structured output**: judge calls enforce a JSON schema API-side (Anthropic
    via forced tool use, OpenAI/Mistral via `response_format: json_schema`,
    custom endpoints via `json_object`), eliminating unparsable judge responses
    for these providers.
  - `ductus check`, `ductus-report.json` and the segment cache carry the new
    `hints` channel; `PROMPT_VERSION` is bumped to `2`, invalidating existing
    segment caches on first regeneration.

### Patch Changes

- afab6fa: The example apps (flutter_comment_demo, flutter_go_router_demo,
  react_router_demo) are now English — annotation content, UI strings, and
  configs (`locale: en`, `voice: en-you`) — and the demo-derived artifacts in
  the root README were regenerated from the English graph; e2e expectations
  updated accordingly. Test runs now build all workspaces exactly once in a
  vitest global setup, fixing a build race between test files that each built
  in `beforeAll`. The German README translations (`README.de.md`) use
  consistent informal address throughout.
- c2b12ef: The deterministic vocabulary check now parses bold spans containing nested
  italics (`**Tap *Edit note***`) correctly. Previously the span was closed at
  the wrong delimiter of a `***` run, so the prose BETWEEN two real spans was
  reported as an invented UI element while the real terms went unchecked.
- Updated dependencies [afab6fa]
- Updated dependencies [84a6ec9]
  - @ductus/schema@0.4.0

## 0.3.0

### Minor Changes

- 625c7ff: journey-Template ist jetzt responsiv (Design-Referenz „Ductus Doku Website“):
  unter 1080 px stapelt die Journey-Seite Graph über Schrittliste — der Graph
  skaliert auf Viewportbreite (min. Faktor 0.8, darunter horizontal scrollbar),
  die ganze Seite scrollt als Einheit und „Pfad abspielen“ springt zum Graphen
  statt der Schrittliste zu folgen. Unter 760 px kompakte Nav (Suche als Icon),
  kompakter Hero, einspaltiges Journey-Grid, reduzierte Journey-Kopfzeile und
  fast vollflächiges Suchoverlay ohne Tastatur-Hinweise. Übersichts-Grid nach
  Design-Vorgabe mit expliziten Spalten (1.25fr 1fr 1fr, ab 1120 px), App-Höhe
  über 100dvh (mobile Browser-Leisten).
- 96797fe: Neuer LLM-Provider `mistral`: spricht die Mistral-Chat-API
  (api.mistral.ai, OpenAI-kompatibel) mit Bearer-Auth über die bestehende
  BYOK-Schicht an — `llm.provider: mistral` plus explizites `model`
  (z. B. `mistral-large-latest`) genügt; Key wie gehabt über `llm.apiKeyEnv`.
  Gleiche Retry-, Kostenschätzungs- und NFR4-Garantien (Key erscheint nie in
  Fehlermeldungen) wie bei den übrigen Providern.

### Patch Changes

- 5650918: Make the faithfulness judge more robust: parse JSON embedded in prose (not just raw JSON or ```json fences), include a snippet of the raw response in the report when parsing still fails, and skip caching segments whose judge response was unparsable so the next run retries instead of replaying the failure.
  - @ductus/schema@0.3.0

## 0.2.0

### Minor Changes

- 450be65: Neuer TypeScript/JavaScript-Adapter (`@ductus/adapter-typescript`): extrahiert
  den Journey-Graphen aus TS/JS-Projekten — buildfrei über die
  `@journey:`-Kommentar-Konvention plus automatische Ableitung aus react-router
  (Datenrouter und `<Route>`-JSX) und Next.js (App- und Pages-Router). Der Core
  löst `name: typescript` in der adapters:-Sektion jetzt eingebaut auf
  (`ductus-adapter-typescript`-Binary), und `ductus init` erkennt package.json
  (app.name, react-router/next ⇒ deriveFrom) neben pubspec.yaml.

### Patch Changes

- @ductus/schema@0.2.0
