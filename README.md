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
dart pub add dev:ductus            # Annotationen + Adapter
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
> `--offline` betrifft nur LLM- und Adapter-Läufe (DD §B.9); `extract`, `check`
> und die Graph-Erzeugung selbst laufen vollständig lokal.

### Website-Modus

Mit `output.format: website` exportiert `ductus generate` ein vollständiges
Starlight-Projekt nach `output.dir`. `ductus generate --build` installiert dort
anschließend die Abhängigkeiten (`npm ci` bei vorhandener `package-lock.json`,
sonst `npm install`) und führt `npm run build` aus — die fertige Website liegt
danach unter `<output.dir>/dist` (DD §M). Ohne `--build` bleibt der Build wie
gehabt Sache des Nutzers; mit `--offline` ist `--build` nicht kombinierbar
(npm bräuchte Netz), und bei `output.format: mdx` bricht das Flag mit einem
Usage-Fehler ab.

### Diagramme in der generierten Doku

Mit aktivierten Diagrammen erhält jede Flow-Seite zwei Mermaid-Abschnitte:
**„Hauptpfad"** (lineares `journey`-Diagramm des deterministisch abgeleiteten
Hauptpfads) und **„Ablaufdiagramm"** (`flowchart` des vollständigen Segments).
Das Starlight-Template rendert beide client-seitig (Mermaid per CDN,
theme-aware); ohne Netz bleibt der Codeblock als Fallback sichtbar
(DD §L).

## Repository-Layout

```
packages/{schema,core,adapter-dart}   # npm-Pakete (TypeScript)
dart/ductus                           # pub.dev-Paket (Annotationen + Adapter)
templates/starlight                   # Website-Preset (Astro Starlight)
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
