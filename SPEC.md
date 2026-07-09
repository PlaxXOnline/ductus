# SPEC.md — Ductus

> **Arbeitsname:** „Ductus" (Platzhalter). Der Name ist frei ersetzbar; alle Paket-Identifier (`@ductus/*`, pub.dev `ductus`) sind entsprechend anzupassen.
>
> **Status:** Draft v0.1 · **Datum:** Juli 2026 · **Owner:** —
>
> **Einzeiler:** Ductus extrahiert aus annotiertem Quellcode einen gerichteten Graphen der User-Journey einer App und übersetzt ihn per LLM in gepflegte Endnutzer-Dokumentation, die mit dem Code versioniert wird.

---

## 1. Zweck & Vision

Ductus schließt eine konkrete Lücke: Es gibt Werkzeuge für Entwickler-/API-Dokumentation (dartdoc, Mintlify) und Werkzeuge für aufnahmebasierte Endnutzer-Guides (Scribe, Guidde, Tango), aber **kein code-/annotationsbasiertes Werkzeug, das Endnutzer-Journeys aus dem Quellcode ableitet und bei jedem Merge aktuell hält.**

Das Kernversprechen gegenüber aufnahmebasierten Tools: Ductus-Doku lebt im Repository, wird versioniert und veraltet nicht bei jeder UI-Änderung, weil sie aus derselben Quelle wie die App generiert wird.

Die Architektur folgt dem etablierten Muster „sprachunabhängiger Kern + Sprachadapter" (vgl. LSP, tree-sitter, OpenTelemetry). Der Wert liegt nicht im Muster selbst, sondern in (a) einer guten Annotations-Konvention, die zum De-facto-Standard werden kann, (b) der Ableitung großer Teile des Graphen ohne manuelle Arbeit (aus Routing-Konfigurationen) und (c) der zuverlässigen, graph-geerdeten LLM-Übersetzung.

---

## 2. Ziele & Nicht-Ziele

### 2.1 Ziele (Phase 1)
- **G1** — Aus einem Dart/Flutter-Projekt einen validierten User-Flow-Graphen (`journey-graph.json`) erzeugen.
- **G2** — Den Graphen so weit wie möglich **automatisch aus `go_router`/`auto_route`** ableiten, sodass minimale manuelle Annotation nötig ist.
- **G3** — Optionale, manuelle Annotationen zum Anreichern/Korrigieren des Graphen (Dart-Annotationen + kommentar-basierte Konvention).
- **G4** — Per **BYOK-LLM** aus dem Graphen Endnutzer-Dokumentation als **Markdown/MDX** generieren.
- **G5** — Ausgabe wahlweise als **MDX-Dateien** oder als **statische Website** (via Static-Site-Generator).
- **G6** — Alles lokal über eine **CLI** ausführbar, ohne Backend, ohne Ductus-Konto.

### 2.2 Ziele (spätere Phasen, hier nur spezifiziert, nicht Phase-1-Scope)
- **G7** — Zweiter Sprachadapter (TypeScript/React) über tree-sitter + Docblock-Konvention.
- **G8** — Gehostete Generierung (gebündelte Inferenz), Doku-Portal, Versionierung/Diffs, CI-Integration (SaaS).
- **G9** — Team-Kollaboration, Rollen, SSO, mehrsprachige Ausgabe, Nutzungs-Analytics (SaaS/Enterprise).

### 2.3 Nicht-Ziele
- **N1** — Kein Ersatz für Entwickler-/API-Dokumentation (kein dartdoc-Konkurrent).
- **N2** — Keine Laufzeit-Instrumentierung oder Screen-Recording (bewusste Abgrenzung zu Scribe/Guidde).
- **N3** — Keine vollautonome, ungeprüfte Veröffentlichung. Ductus erzeugt einen **Entwurf (~90 %)**; menschliches Review bleibt im Workflow.
- **N4** — Kein eigenes LLM-Training; ausschließlich Nutzung bestehender LLM-APIs.
- **N5** — Phase 1 hostet keine Inferenz und trägt keine LLM-Kosten (BYOK).

---

## 3. Terminologie

| Begriff | Bedeutung |
|---|---|
| **Screen (Node)** | Ein für den Nutzer sichtbarer Zustand/Bildschirm (z. B. Login, Dashboard). |
| **Action (Node)** | Eine vom Nutzer auslösbare Handlung (Button-Tap, Formular-Absenden). |
| **Decision (Node)** | Ein Verzweigungspunkt mit Bedingungen (z. B. „eingeloggt? ja/nein"). |
| **Transition (Edge)** | Gerichteter Übergang zwischen Nodes, ausgelöst durch ein Trigger. |
| **Flow** | Eine benannte, zusammenhängende Teilmenge des Graphen (z. B. „Onboarding"). |
| **Adapter** | Sprachspezifisches Paket, das Quellcode in das Ductus-Graph-Schema übersetzt. |
| **Core** | Sprachunabhängiger Orchestrator: Graph-Validierung, LLM-Schicht, Ausgabe, CLI. |
| **BYOK** | „Bring Your Own Key" — der Nutzer stellt seinen eigenen LLM-API-Schlüssel. |

---

## 4. Systemarchitektur

### 4.1 Überblick

```
┌─────────────────────────────────────────────────────────────┐
│                        Quellcode                             │
│   (Dart/Flutter, später TS/React, Swift, …)                  │
└───────────────┬─────────────────────────────────────────────┘
                │  liest Annotationen + Routing-Konfiguration
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ADAPTER (pro Sprache)                                        │
│  · Dart: source_gen/build_runner + go_router-Ableitung       │
│  · TS  : tree-sitter + Docblock-Konvention                   │
│  → emittiert Adapter-Output im Ductus-Graph-Schema (JSON)   │
└───────────────┬─────────────────────────────────────────────┘
                │  journey-graph.raw.json
                ▼
┌─────────────────────────────────────────────────────────────┐
│  CORE  (@ductus/core)                                        │
│  1. Merge (mehrere Adapter-Outputs)                          │
│  2. Validierung (Schema + Graph-Integrität)                  │
│  3. Normalisierung → journey-graph.json                      │
│  4. LLM-Generierung (BYOK) → Prosa je Node/Flow             │
│  5. Faithfulness-Check (Judge)                               │
│  6. Ausgabe: MDX | Website                                   │
└───────────────┬─────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
   docs/*.mdx      statische Website
```

### 4.2 Trennungsprinzip

Der Core kennt **keine** Sprache. Er kennt nur das Graph-Schema (§6). Ein Adapter kennt **eine** Sprache und muss nur den Adapter-Vertrag (§7) erfüllen. Das reduziert das M×N-Problem (M Sprachen × N Ausgabeformate) auf M+N, exakt wie beim Language Server Protocol.

### 4.3 Paketstruktur (Monorepo)

```
ductus/
├── packages/
│   ├── core/                 # @ductus/core (npm) — Orchestrator, CLI, LLM, Ausgabe
│   ├── schema/               # @ductus/schema (npm) — JSON-Schema + TS-Typen, versioniert
│   ├── adapter-dart/         # npm-Wrapper, ruft den Dart-Adapter auf
│   └── adapter-typescript/   # (Phase 2)
├── dart/
│   └── ductus/              # pub.dev-Paket: Annotationen + source_gen-Builder
├── templates/                # Website-Templates (Docusaurus/Starlight-Preset)
└── examples/                 # Beispiel-Apps mit Annotationen
```

> **Designentscheidung:** Der npm-Kern orchestriert; der eigentliche Dart-Parsing-Schritt läuft im Dart-Ökosystem (`build_runner`) und emittiert JSON, das der npm-Kern einliest. `adapter-dart` (npm) ist ein dünner Wrapper, der `dart run build_runner`/das CLI aufruft und die JSON-Ausgabe zurückgibt. So bleibt jede Sprache in ihrer nativen Toolchain, und der Kern bleibt sprachneutral.

---

## 5. Annotations-Konvention (DSL)

Ductus unterstützt **zwei gleichwertige Eingabewege**, die auf dasselbe Graph-Schema abbilden, plus einen automatischen Ableitungsweg.

### 5.1 Weg A — Kommentar-Konvention (universell, tree-sitter-parsebar)

Sprachunabhängig, keine Build-Abhängigkeit, in jeder Sprache identisch. Präfix `@journey:`.

```
// @journey:screen id="login" title="Anmeldung" flow="auth"
//   description="Bildschirm, auf dem sich der Nutzer anmeldet."
```

```
// @journey:action id="submit-login" label="Anmelden"
//   from="login" to="dashboard" trigger="tap"
//   condition="Zugangsdaten gültig"
```

```
// @journey:flow id="auth" title="Anmeldung & Registrierung" start="login"
```

**Regeln:**
- Ein Annotationsblock beginnt mit `@journey:<typ>` und endet an der ersten Nicht-Kommentar-Zeile.
- Schlüssel-Wert-Paare: `key="value"`. Mehrzeilig erlaubt (Fortsetzung in Folge-Kommentarzeilen).
- Pflichtfelder je Typ siehe §6.
- Unbekannte Keys werden ignoriert (vorwärtskompatibel), aber als Warnung geloggt.

### 5.2 Weg B — Native Dart-Annotationen (First-Class, typgeprüft)

Für Dart/Flutter, verarbeitet via `source_gen`/`build_runner`. Vorteil: Kompilierzeit-Prüfung, IDE-Autovervollständigung, Refactoring-sicher.

```dart
import 'package:ductus/ductus.dart';

@JourneyScreen(
  id: 'login',
  title: 'Anmeldung',
  flow: 'auth',
  description: 'Bildschirm, auf dem sich der Nutzer anmeldet.',
)
class LoginScreen extends StatelessWidget {
  @JourneyAction(
    label: 'Anmelden',
    to: 'dashboard',
    trigger: JourneyTrigger.tap,
    condition: 'Zugangsdaten gültig',
  )
  void onSubmit() { /* … */ }
}
```

### 5.3 Weg C — Automatische Ableitung (kein Annotationsaufwand)

Aus deklarativen Routing-Konfigurationen wird der Graph teilweise **ohne jede Annotation** abgeleitet:

- **`go_router`:** `GoRoute(path:…, name:…)` → Screen-Node; `ShellRoute` → gruppierter Flow; `redirect` → Decision-Node; `context.go()/push()`-Aufrufe (statische Analyse) → Transition-Kandidaten.
- **`auto_route`:** analog aus der Routentabelle.

Abgeleitete Nodes erhalten `source: "derived"` und können durch Weg A/B überschrieben/angereichert werden. Ziel: Der Entwickler startet mit einem brauchbaren Graphen **bevor** er eine einzige Annotation schreibt, und annotiert nur dort nach, wo Semantik fehlt (Labels, Bedingungen, Beschreibungen).

### 5.4 Präzedenz bei Konflikten
Manuelle Annotation (B/A) **überschreibt** abgeleitete Werte (C). Bei zwei manuellen Quellen für dasselbe Feld: Fehler mit Quellenangabe (fail-fast), damit keine stille Mehrdeutigkeit entsteht.

---

## 6. Graph-Datenmodell (`@ductus/schema`)

Das Schema ist die **einzige Vertragsfläche** zwischen Adaptern und Core. Es ist versioniert (`schemaVersion`) und rückwärtskompatibel zu pflegen.

### 6.1 Top-Level

```jsonc
{
  "schemaVersion": "1.0",
  "app": {
    "name": "MyApp",
    "platforms": ["ios", "android", "web"],
    "locale": "de"
  },
  "flows":  [ /* Flow[] */ ],
  "nodes":  [ /* Node[] */ ],
  "edges":  [ /* Edge[] */ ],
  "meta": {
    "generatedAt": "2026-07-08T00:00:00Z",
    "adapters": [ { "name": "dart", "version": "0.1.0" } ]
  }
}
```

### 6.2 Node

```jsonc
{
  "id": "login",                 // eindeutig im Graph (Pflicht)
  "type": "screen",              // "screen" | "action" | "decision" (Pflicht)
  "title": "Anmeldung",          // menschenlesbar (Pflicht für screen/decision)
  "label": "Anmelden",           // UI-Beschriftung (Pflicht für action)
  "flow": "auth",                // optionale Flow-Zugehörigkeit
  "description": "…",            // optionaler Autoren-Hinweis für das LLM
  "source": "annotation",        // "annotation" | "derived"
  "sourceRef": {                 // Rückverweis in den Code (für Diffs/Review)
    "file": "lib/screens/login.dart",
    "line": 12,
    "symbol": "LoginScreen"
  },
  "tags": ["auth", "entry"]
}
```

### 6.3 Edge (Transition)

```jsonc
{
  "id": "e_login_dashboard",
  "from": "login",               // Node-id (Pflicht)
  "to": "dashboard",             // Node-id (Pflicht)
  "trigger": "tap",              // "tap"|"submit"|"auto"|"back"|"deeplink"|"system"
  "label": "Anmelden",           // optionaler Auslöser-Text
  "condition": "Zugangsdaten gültig",  // optionale Bedingung (Decision-Kante)
  "source": "annotation"
}
```

### 6.4 Flow

```jsonc
{
  "id": "auth",
  "title": "Anmeldung & Registrierung",
  "start": "login",              // Einstiegs-Node
  "description": "…"
}
```

### 6.5 Validierungsregeln (Core, hart)
- **V1** — Jede `edge.from`/`edge.to` muss auf existierende `node.id` verweisen (keine dangling edges).
- **V2** — `node.id` eindeutig; Kollision = Fehler.
- **V3** — Jeder `flow.start` muss existieren und vom Typ `screen` sein.
- **V4** — Pflichtfelder je Typ vorhanden (§6.2).
- **V5** — Warnung (nicht Fehler) bei: unerreichbaren Nodes (keine eingehende Kante, kein Flow-Start), Nodes ohne `description` (LLM-Qualität sinkt), Zyklen ohne Abbruchbedingung.
- **V6** — `schemaVersion` muss vom Core unterstützt werden.

---

## 7. Adapter-Vertrag

Ein Adapter ist alles, was diesen Vertrag erfüllt. Damit ist die Community in der Lage, Adapter für beliebige Sprachen beizutragen, ohne den Core zu ändern.

### 7.1 Schnittstelle
Ein Adapter ist ein ausführbarer Befehl, der:
1. als Eingabe ein Projektverzeichnis + optionale Adapter-Konfiguration erhält,
2. als Ausgabe **genau ein** JSON-Dokument im Ductus-Graph-Schema (§6) auf stdout schreibt,
3. mit Exit-Code 0 (Erfolg) / ≠0 (Fehler, Diagnostik auf stderr) terminiert.

```
ductus-adapter-<lang> --project <dir> [--config <file>]  →  stdout: graph JSON
```

### 7.2 Adapter-Pflichten
- **A1** — `source`-Feld korrekt setzen (`annotation` vs. `derived`).
- **A2** — `sourceRef` (Datei/Zeile/Symbol) für Rückverfolgbarkeit füllen, wo möglich.
- **A3** — Nur syntaktisch valides Schema emittieren; semantische Vollständigkeit prüft der Core.
- **A4** — Deterministische Ausgabe bei unverändertem Input (wichtig für Diffs).
- **A5** — Adapter-Name + -Version in `meta.adapters` eintragen.

### 7.3 Referenz-Adapter: Dart (Phase 1)
- Nutzt `build_runner` mit einem `GeneratorForAnnotation<JourneyScreen>` etc. (`source_gen`).
- Kombiniert Annotationsdaten (§5.2) mit go_router-Ableitung (§5.3).
- Emittiert zusätzlich ein `ductus_graph.g.json` im Projekt (für Debugging), stdout bleibt der Vertrag.
- Publiziert als pub.dev-Paket `ductus`; npm-Wrapper `@ductus/adapter-dart` ruft es auf.

---

## 8. LLM-Generierungsschicht (BYOK)

### 8.1 Grundprinzip: Erdung durch den Graphen
Das LLM übersetzt **nur** den validierten Graphen in Prosa — es erfindet keine Features. Der Graph ist die vertrauenswürdige Quelle (RAG-artige Erdung). Das reduziert Faktizitäts-Halluzinationen strukturell; Restrisiko sind Faithfulness-Fehler (Überinterpretation von Lücken).

### 8.2 BYOK-Konfiguration
- Provider-agnostisch: Anthropic (Claude), OpenAI (GPT), lokale/OpenAI-kompatible Endpunkte.
- API-Key aus Umgebungsvariable (`DUCTUS_LLM_API_KEY`) oder Konfig; **niemals** ins Repo schreiben, niemals loggen.
- Provider/Modell konfigurierbar (§10). Kosten trägt der Nutzer.

### 8.3 Generierungs-Pipeline
1. **Segmentierung:** Statt eines Monolith-Prompts wird pro Flow (und optional pro Node) generiert — kürzere, geerdete Läufe reduzieren Halluzination und Kosten.
2. **Prompt-Bau:** Der Prompt enthält das relevante Graph-Segment als strukturierte Daten + einen Styleguide (§8.4) + Few-Shot-Beispiele.
3. **Generierung:** LLM erzeugt Markdown/MDX je Segment.
4. **Faithfulness-Judge:** Ein zweiter, günstiger LLM-Aufruf prüft die Ausgabe **gegen den Graphen** („Behauptet der Text Schritte/Elemente, die nicht im Graph stehen?"). Treffer → Warnung im Report, Markierung im Output.
5. **Assemblierung:** Segmente werden zu Seiten/Website zusammengesetzt.

### 8.4 Styleguide (in den Prompt injiziert)
- Zweite Person („Sie"/„du" konfigurierbar), aktive, anleitende Sprache.
- Schritt-für-Schritt-Struktur; Voraussetzungen zuerst.
- Keine Erfindung von UI-Elementen, die nicht als Node/Edge/`label` vorliegen.
- Nur beschreiben, was der Graph hergibt; Lücken als solche kennzeichnen statt zu erfinden.
- Ausgabeformat: MDX mit YAML-Frontmatter (Titel, Flow, Reihenfolge).

### 8.5 Determinismus & Caching
- Ausgaben werden pro Segment-Hash gecacht; unveränderte Graph-Segmente werden **nicht** neu generiert (spart Kosten und stabilisiert Diffs).
- Temperatur niedrig (konfigurierbar), Seed wo unterstützt.

---

## 9. Ausgabeformate

### 9.1 MDX-Modus
- Ein `.mdx` pro Flow (oder pro Screen, konfigurierbar) unter `docs/`.
- YAML-Frontmatter mit `title`, `flow`, `order`, `sourceRefs` (für Rückverfolgung).
- Optional: eingebettetes Mermaid-Diagramm des Flow-Graphen pro Seite.

### 9.2 Website-Modus
- Preset für einen MDX-fähigen Static-Site-Generator (Empfehlung: **Starlight/Astro** wegen schneller Builds und eingebauter Suche; **Docusaurus** als Alternative mit Versioning).
- Ductus erzeugt MDX + Navigations-/Sidebar-Konfiguration; der SSG baut die Website.
- Der SSG selbst ist eine Peer-Dependency, kein Ductus-Fork.

### 9.3 Zwischenartefakte (immer)
- `journey-graph.json` (validierter Graph) — auch ohne LLM nutzbar (z. B. für eigene Visualisierung).
- `ductus-report.json` — Warnungen (V5), Faithfulness-Flags, Cache-Trefferquote, Kosten-Schätzung.

---

## 10. CLI & Konfiguration

### 10.1 Befehle
```
ductus init            # legt ductus.config.* an, erkennt Adapter/Routing
ductus extract         # nur Graph erzeugen + validieren → journey-graph.json
ductus generate        # extract + LLM-Generierung → MDX/Website
ductus check           # Validierung + Faithfulness ohne Neuschreiben (CI-tauglich)
ductus graph --open    # Graph als Mermaid/HTML zur Inspektion
```

### 10.2 Konfiguration (`ductus.config.yaml`)
```yaml
app:
  name: MyApp
  locale: de
adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]
llm:
  provider: anthropic        # anthropic | openai | custom
  model: <modellname>
  apiKeyEnv: DUCTUS_LLM_API_KEY
  temperature: 0.2
  faithfulnessCheck: true
style:
  voice: formal-sie          # formal-sie | informal-du | en-you
  granularity: flow          # flow | screen
output:
  format: mdx                # mdx | website
  dir: docs/
  website:
    generator: starlight     # starlight | docusaurus
    diagrams: true
```

### 10.3 Exit-Codes (für CI)
- `0` Erfolg, keine Fehler.
- `1` Validierungsfehler (V1–V4/V6).
- `2` Faithfulness-Warnungen oberhalb Schwellwert.
- `3` LLM-/Konfigurationsfehler.

---

## 11. Open-Core-Grenze (Lizenzierung & Monetarisierung)

Klar definierte Trennlinie zwischen dauerhaft freiem Kern und späterer SaaS-Schicht. Diese Tabelle ist Teil der Spezifikation, weil sie Architekturentscheidungen bindet (z. B. muss der Core ohne Backend lauffähig bleiben).

| Komponente | Lizenz | Kostenlos / Bezahlt |
|---|---|---|
| `@ductus/schema` (Graph-Schema, Typen) | MIT/Apache | **Frei** — soll Standard werden |
| `ductus` (Dart-Annotationen + Builder) | MIT/Apache | **Frei** |
| `@ductus/adapter-*` (alle Sprachadapter) | MIT/Apache | **Frei** — Community-Beiträge erwünscht |
| `@ductus/core` (Extract, Validierung, CLI) | MIT/Apache | **Frei** |
| LLM-Generierung **mit BYOK** | (Teil des Core) | **Frei** — Nutzer zahlt eigene Inferenz |
| Lokaler MDX/Website-Export | (Teil des Core) | **Frei** |
| Gehostete Generierung (gebündelte Inferenz) | FSL/BSL* | **Bezahlt (SaaS)** |
| Gehostetes Doku-Portal, Versionierung/Diffs bei Merge | FSL/BSL* | **Bezahlt (SaaS)** |
| CI-App, PR-Kommentare, Merge-Aktualisierung | FSL/BSL* | **Bezahlt (SaaS)** |
| Team-Kollaboration, Rollen, SSO, Audit | proprietär | **Bezahlt (Enterprise)** |
| Mehrsprachige Ausgabe, Nutzungs-Analytics | proprietär | **Bezahlt (Enterprise)** |

\* **FSL/BSL** (Functional/Business Source License, Sentry-Modell): Quellcode einsehbar, aber Schutz davor, dass ein Dritter einen konkurrierenden „Ductus-as-a-Service" verkauft; konvertiert nach definierter Frist zu permissiv. Bibliotheken/Adapter bleiben immer MIT.

**Bindende Konsequenz für die Architektur:** Der Core (inkl. BYOK-Generierung) darf **keine** Abhängigkeit zu einem Ductus-Backend haben. Der SaaS ist additiv, nie Voraussetzung.

---

## 12. Phasenplan & Meilensteine

### Phase 1 (0–6 Monate) — OSS-Kern, Validierung
- **Deliverables:** `@ductus/schema`, `@ductus/core` (CLI), `ductus` (Dart-Adapter mit go_router-Ableitung), BYOK-Generierung, MDX- + Website-Export, 2 Beispiel-Apps.
- **Erfolgskriterien:** 500+ GitHub-Stars; 10+ echte Apps im Einsatz; Annotations-Konvention stabilisiert (kein Breaking Change über 2 Minor-Releases).

### Phase 2 (6–15 Monate) — 2. Sprache + SaaS-MVP
- **Deliverables:** `@ductus/adapter-typescript` (tree-sitter + Docblock); SaaS mit gehosteter Generierung, Doku-Portal, Merge-Diffs, CI-App; hybrides Pricing (Grundgebühr + Credits).
- **Erfolgskriterien:** „Sprachübergreifend" bewiesen (2 Adapter, identisches Schema); 20+ zahlende Teams **oder** klare Retention.

### Phase 3 (15+ Monate) — Team & Enterprise
- **Deliverables:** Kollaboration, Rollen, SSO, mehrsprachige Ausgabe, Analytics; MCP-Server/Plugin-Integration in KI-Coding-Assistenten.
- **Erfolgskriterien:** Enterprise-Referenzkunden; nutzungsbasierter Umsatz deckt Inferenz-COGS mit gesunder Bruttomarge.

---

## 13. Nicht-funktionale Anforderungen

- **NFR1 (Performance):** `extract` auf einer mittleren App (≈100 Screens) < 10 s ohne LLM.
- **NFR2 (Determinismus):** Gleicher Input ⇒ gleicher `journey-graph.json` (byte-stabil, sortierte Schlüssel) für saubere Diffs.
- **NFR3 (Kostentransparenz):** `generate` schätzt Token-/Kostenverbrauch **vorab** und nach Lauf (Report).
- **NFR4 (Sicherheit):** API-Keys nie loggen/persistieren; keine Quellcode-Inhalte an Dritte außer dem konfigurierten LLM-Provider; `--offline` erzwingt reinen Extract ohne Netz.
- **NFR5 (Privacy/Opt-in-Telemetrie):** Keine Telemetrie ohne explizites Opt-in.
- **NFR6 (Erweiterbarkeit):** Neuer Sprachadapter ohne Core-Änderung integrierbar (nur §7-Vertrag).
- **NFR7 (Kompatibilität):** `schemaVersion` semver-gepflegt; Core lehnt inkompatible Majors klar ab.
- **NFR8 (Node/Dart-Support):** Aktuelle LTS-Node-Version; aktuelle stabile Dart/Flutter-Version.

---

## 14. Risiken & offene Fragen

| # | Risiko / Frage | Gegenmaßnahme |
|---|---|---|
| R1 | LLM-Doku ohne Review zu ungenau | Positionierung als „90 %-Entwurf im PR-Flow"; Faithfulness-Judge; sichtbare Warnflags. |
| R2 | Finanzstarker Akteur (Mintlify/GitBook) launcht dasselbe | Flutter-Nische + Annotations-Standard + Community als Graben; Geschwindigkeit in Phase 1. |
| R3 | Reine Code-Visualisierung trägt kein Geschäft (vgl. CodeSee-Einstellung) | Wert klar bei **Endnutzer-Doku**, nicht Entwickler-Diagramm, verankern. |
| R4 | Doku-Traffic-Monetarisierung fragil im KI-Zeitalter (Tailwind-Signal) | Monetarisierung über Team/Hosting/CI, nicht über Traffic. |
| R5 | Inferenzkosten drücken SaaS-Marge | BYOK im Kern; SaaS mit nutzungsbasierter Preiskomponente + Caching. |
| R6 | go_router-Ableitung deckt nicht alle Navigationsmuster ab | Ableitung als „best effort"; manuelle Annotation als Ergänzung, nie Voraussetzung. |
| Q1 | Granularität-Default: pro Flow oder pro Screen? | In Phase 1 beides anbieten, Default `flow`; anhand Nutzerfeedback festzurren. |
| Q2 | Welcher SSG als Default — Starlight oder Docusaurus? | Phase-1-Entscheidung; Starlight (Speed/Suche) vs. Docusaurus (Versioning). |
| Q3 | Endgültiger Produktname + npm-Scope-Verfügbarkeit | Vor Phase-1-Release klären; „Ductus" ist Platzhalter. |

---

## 15. Anhang — Minimales End-to-End-Beispiel

**Eingabe (Dart, mit go_router + einer Annotation):**
```dart
final router = GoRouter(routes: [
  GoRoute(path: '/login',     name: 'login',     builder: …), // → screen (derived)
  GoRoute(path: '/dashboard', name: 'dashboard', builder: …), // → screen (derived)
]);

@JourneyAction(label: 'Anmelden', from: 'login', to: 'dashboard', trigger: JourneyTrigger.tap)
void onSubmit() {}
```

**Zwischenprodukt (`journey-graph.json`, gekürzt):**
```jsonc
{
  "schemaVersion": "1.0",
  "nodes": [
    { "id": "login", "type": "screen", "title": "Login", "source": "derived" },
    { "id": "dashboard", "type": "screen", "title": "Dashboard", "source": "derived" }
  ],
  "edges": [
    { "id": "e1", "from": "login", "to": "dashboard",
      "trigger": "tap", "label": "Anmelden", "source": "annotation" }
  ]
}
```

**Ausgabe (`docs/auth.mdx`, LLM-generiert, gekürzt):**
```mdx
---
title: Anmeldung
flow: auth
---

## Anmelden

1. Öffnen Sie den **Login**-Bildschirm.
2. Tippen Sie auf **Anmelden**, um fortzufahren.
3. Nach erfolgreicher Anmeldung gelangen Sie zum **Dashboard**.
```

---

*Ende SPEC.md v0.1*
