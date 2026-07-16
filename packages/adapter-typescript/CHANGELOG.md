# @ductus/adapter-typescript

## 0.4.0

### Patch Changes

- afab6fa: The example apps (flutter_comment_demo, flutter_go_router_demo,
  react_router_demo) are now English — annotation content, UI strings, and
  configs (`locale: en`, `voice: en-you`) — and the demo-derived artifacts in
  the root README were regenerated from the English graph; e2e expectations
  updated accordingly. Test runs now build all workspaces exactly once in a
  vitest global setup, fixing a build race between test files that each built
  in `beforeAll`. The German README translations (`README.de.md`) use
  consistent informal address throughout.
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
- Updated dependencies [afab6fa]
- Updated dependencies [84a6ec9]
  - @ductus/schema@0.4.0

## 0.3.0

### Patch Changes

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
