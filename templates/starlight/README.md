# Ductus-Doku-Website (Starlight)

Dieses Verzeichnis ist eine von Ductus erzeugte Astro/Starlight-Website; die Inhalte unter `src/content/docs/` werden von Ductus generiert. Installieren Sie die Abhängigkeiten einmalig mit `npm install`. Danach startet `npm run dev` eine lokale Vorschau und `npm run build` erzeugt die statische Website unter `dist/`.

## Mermaid-Diagramme

Codeblöcke mit der Sprache `mermaid` — Ductus generiert je Flow ein
journey-Diagramm („Hauptpfad") und ein flowchart („Ablaufdiagramm") — werden
im Browser als Diagramme gerendert:

- Ein remark-Plugin in `astro.config.mjs` wandelt die Codeblöcke beim Build in
  `<pre class="mermaid">` um (greift für Markdown und MDX).
- Ein kleines Inline-Skript lädt Mermaid zur Laufzeit per CDN
  (jsdelivr, mermaid@11) und rendert alle Diagramme passend zum gewählten
  Farbschema — auch beim Live-Umschalten zwischen Hell und Dunkel.
- **Offline-Fallback:** Ohne Internetverbindung schlägt nur der CDN-Import fehl;
  der Diagramm-Quelltext bleibt dann als lesbarer Codeblock sichtbar, die Seite
  funktioniert weiterhin.
