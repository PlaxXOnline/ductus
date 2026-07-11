# @ductus/core

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
