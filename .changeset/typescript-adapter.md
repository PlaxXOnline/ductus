---
'@ductus/adapter-typescript': minor
'@ductus/core': minor
---

Neuer TypeScript/JavaScript-Adapter (`@ductus/adapter-typescript`): extrahiert
den Journey-Graphen aus TS/JS-Projekten — buildfrei über die
`@journey:`-Kommentar-Konvention plus automatische Ableitung aus react-router
(Datenrouter und `<Route>`-JSX) und Next.js (App- und Pages-Router). Der Core
löst `name: typescript` in der adapters:-Sektion jetzt eingebaut auf
(`ductus-adapter-typescript`-Binary), und `ductus init` erkennt package.json
(app.name, react-router/next ⇒ deriveFrom) neben pubspec.yaml.
