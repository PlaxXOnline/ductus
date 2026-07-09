# @ductus/core

Ductus-Core: CLI und Orchestrator — merged und validiert Adapter-Graphen,
übersetzt sie per LLM (BYOK) in Endnutzer-Dokumentation (MDX oder statische
Website) und rendert den Journey-Graphen als Mermaid/HTML.

## Installation

```bash
npm install -g @ductus/core
# für Dart/Flutter-Projekte zusätzlich:
npm install -g @ductus/adapter-dart
```

## CLI

```bash
ductus init         # erkennt Adapter/Routing, legt ductus.config.yaml an
ductus extract      # → journey-graph.json (ohne LLM nutzbar)
export DUCTUS_LLM_API_KEY=sk-…
ductus generate     # → docs/*.mdx (oder Website)
ductus check        # CI: Validierung + Faithfulness aus dem Cache, ohne LLM-Kosten
ductus graph --open # Graph als Mermaid/HTML inspizieren
```

Hinweis: Die von `ductus graph` erzeugte HTML-Seite lädt Mermaid beim Öffnen
per CDN — das Rendern im Browser braucht also einmalig Netz. `--offline`
wirkt nur auf `generate` (nur mit `llm.provider: mock` erlaubt, nicht mit
`--build` kombinierbar).

## Weiterführende Doku

Best Practices (Graph-Qualität, Arbeitsablauf, LLM & Kosten):
[Abschnitt im Repo-README](https://github.com/PlaxXOnline/ductus#best-practices).

Verbindliche Spezifikation:
[SPEC.md](https://github.com/PlaxXOnline/ductus/blob/main/SPEC.md) ·
Entscheidungen/Annahmen:
[docs/DESIGN-DECISIONS.md](https://github.com/PlaxXOnline/ductus/blob/main/docs/DESIGN-DECISIONS.md)
im [Ductus-Repository](https://github.com/PlaxXOnline/ductus).

## Lizenz

[MIT](LICENSE)
