# Ductus-Doku-Website (Journey)

Dieses Verzeichnis ist eine von Ductus erzeugte Astro-Website (ohne Starlight); die Daten in `ductus.data.json` werden von Ductus generiert. Installieren Sie die Abhängigkeiten einmalig mit `npm install`. Danach startet `npm run dev` eine lokale Vorschau und `npm run build` erzeugt die statische Website unter `dist/`.

## Aufbau

- **`ductus.data.json`** — der komplette Datenvertrag (dataVersion 1): Site-Metadaten,
  Journeys mit Nodes, Kanten, Hauptpfad, LLM-Markdown und Faithfulness-Warnungen.
  Ductus überschreibt die Datei bei jedem `ductus generate`; die mitgelieferte
  Version enthält Demo-Daten für die lokale Vorschau. Fehlt die Datei, baut die
  Site mit einem leeren Fallback trotzdem (defensiv, siehe `src/lib/data.ts`).
- **`src/pages/index.astro`** — Übersicht: Suche, „Häufig gesucht“-Chips
  (häufigste Kanten-Labels), Journey-Karten, Footer.
- **`src/pages/journeys/[slug].astro`** — Journey-Detail: interaktiver Graph
  (deterministisches BFS-Layout, Bezier-Kanten), Schrittliste aus dem Hauptpfad,
  „Weitere Aktionen“, Faithfulness-Banner und die „Ausführliche Anleitung“
  (LLM-Markdown, zur Buildzeit sicher gerendert).
- **`src/lib/`** — Datenladen, Schritt-Ableitung, Graph-Layout, Suchindex und
  zentrale UI-Strings (Deutsch als Default; Englisch, wenn `site.locale` mit
  `en` beginnt).

## Interaktion

- **⌘K / Ctrl+K** öffnet die Suche (Journeys, Schritte, Entscheidungen, Aktionen);
  Pfeiltasten + Enter navigieren, `esc` schließt.
- **Knoten anklicken** springt rechts zum passenden Schritt; **„Pfad abspielen“**
  steppt den Hauptpfad animiert durch. `prefers-reduced-motion` wird respektiert
  (Animationen aus, Scroll ohne Smooth-Verhalten).
- Die Google-Fonts (Instrument Sans, Spline Sans Mono) werden per CDN geladen;
  ohne Internetverbindung greift der `system-ui`-Fallback — die Seite bleibt
  vollständig nutzbar.

Änderungen an den Inhalten bitte im Quellcode der App (Annotationen) vornehmen,
nicht in den generierten Daten.
