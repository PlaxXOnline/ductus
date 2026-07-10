# @ductus/schema

Der Vertrag hinter [ductus](https://github.com/PlaxXOnline/ductus): TypeScript-Typen und JSON Schema (Draft 2020-12) für den Journey-Graphen (`journey-graph.json`) — die einzige Vertragsfläche zwischen Sprachadaptern und dem Ductus-Core.

Sprachadapter (z. B. der [Dart-Adapter](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)) extrahieren aus annotiertem App-Code einen Graphen in diesem Format; der Core validiert, merged und übersetzt ihn in Endnutzer-Dokumentation. Wer einen eigenen Adapter schreibt oder `journey-graph.json` programmatisch verarbeitet, braucht genau dieses Paket — sonst nichts.

**Für wen?** Autoren eigener Adapter und Tooling-Entwickler, die den Graphen lesen, erzeugen oder validieren wollen. Zum reinen Benutzen von ductus ist dieses Paket nicht nötig — es kommt als Dependency von [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) mit.

## Installation

```bash
npm install @ductus/schema
```

## Das Datenmodell in 60 Sekunden

Ein Journey-Graph ist ein gerichteter Graph der User-Journey einer App: Screens, Aktionen und Verzweigungen als Nodes, Transitions als Edges, thematische Teilmengen als Flows.

| Typ | Bedeutung | Pflichtfelder |
| --- | --- | --- |
| `JourneyGraph` | Top-Level-Dokument | `schemaVersion`, `flows`, `nodes`, `edges` |
| `JourneyNode` | Screen, Action oder Decision | `id`, `type`, `source`; `title` bei `screen`/`decision`, `label` bei `action` |
| `JourneyEdge` | Gerichtete Transition zwischen zwei Nodes | `id`, `from`, `to`, `source` |
| `JourneyFlow` | Benannte Teilmenge des Graphen mit Einstiegspunkt | `id`, `title`, `start` |
| `SourceRef` | Rückverweis in den Quellcode | `file` (optional `line`, `symbol`) |

Die wichtigsten Felder im Detail:

- **`JourneyNode.type`** — `'screen' | 'action' | 'decision'`. Screens und Decisions tragen einen `title`, Actions ein `label` (das JSON Schema erzwingt das). Optional: `description` (verbessert die LLM-Qualität deutlich), `flow`, `tags`, `sourceRef`.
- **`JourneyEdge`** — verbindet `from` → `to` (Node-ids). Optional: `trigger` (`'tap' | 'submit' | 'auto' | 'back' | 'deeplink' | 'system'`), `label` (Beschriftung der Transition) und `condition` (Bedingung, unter der die Transition gilt — u. a. wichtig, damit Zyklen eine erkennbare Abbruchbedingung haben).
- **`JourneyFlow.start`** — id des Einstiegs-Nodes. Er muss existieren und vom Typ `screen` sein; der Core prüft das bei der Validierung.
- **`source`** — auf Nodes und Edges: `'annotation'` (explizit im Code annotiert) oder `'derived'` (vom Adapter abgeleitet, z. B. aus Router-Konfiguration).
- **`SourceRef`** — verortet ein Element im Quellcode (`file`, optional `line` ab 1 und `symbol`), damit Doku-Aussagen bis zur Codestelle rückverfolgbar bleiben.

Unbekannte Zusatzfelder sind erlaubt (`additionalProperties` bleibt offen): neuere Adapter dürfen Felder ergänzen, ohne ältere Konsumenten zu brechen.

### Versionierung: `schemaVersion`

`schemaVersion` hat das Format `"major.minor"`. Die Regel ist einfach: **gleiche Major-Version ⇒ kompatibel** — Minor-Erweiterungen sind rückwärtskompatibel, inkompatible Majors werden vom Core abgelehnt. Das Paket exportiert dazu:

| Export | Wert/Zweck |
| --- | --- |
| `SCHEMA_VERSION` | `'1.0'` — die Version, die dieses Paket beschreibt |
| `SUPPORTED_SCHEMA_MAJOR` | `1` — vom Core unterstützte Major-Version |
| `parseSchemaVersion(v)` | zerlegt `"major.minor"`, `null` bei ungültigem Format |
| `isSupportedSchemaVersion(v)` | `true`, wenn die Major-Version passt |

## Minimales gültiges Beispiel

```json
{
  "schemaVersion": "1.0",
  "app": { "name": "Demo-App" },
  "flows": [
    { "id": "login", "title": "Anmeldung", "start": "login_screen" }
  ],
  "nodes": [
    {
      "id": "login_screen",
      "type": "screen",
      "title": "Login",
      "description": "Anmeldung mit E-Mail und Passwort.",
      "source": "annotation",
      "sourceRef": { "file": "lib/pages/login_page.dart", "line": 12 }
    },
    {
      "id": "submit_login",
      "type": "action",
      "label": "Anmelden",
      "description": "Sendet die Zugangsdaten ab.",
      "source": "annotation"
    },
    {
      "id": "home_screen",
      "type": "screen",
      "title": "Startseite",
      "description": "Übersicht nach erfolgreicher Anmeldung.",
      "source": "annotation"
    }
  ],
  "edges": [
    { "id": "e1", "from": "login_screen", "to": "submit_login", "trigger": "tap", "source": "annotation" },
    { "id": "e2", "from": "submit_login", "to": "home_screen", "trigger": "submit", "condition": "Zugangsdaten gültig", "source": "annotation" }
  ]
}
```

## Nutzung in TypeScript

Alle Typen kommen aus dem Haupteinstieg:

```ts
import type { JourneyGraph, JourneyNode, JourneyEdge, JourneyFlow, SourceRef } from '@ductus/schema';
import { SCHEMA_VERSION, SUPPORTED_SCHEMA_MAJOR, isSupportedSchemaVersion } from '@ductus/schema';
```

### Validieren mit Ajv

Das JSON Schema gibt es in zwei Formen — als TS-Export `journeyGraphJsonSchema` und als Roh-Datei über den Subpath-Export `@ductus/schema/journey-graph.schema.json`:

```ts
import { Ajv2020 } from 'ajv/dist/2020.js';
import { journeyGraphJsonSchema } from '@ductus/schema';
import type { JourneyGraph } from '@ductus/schema';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile<JourneyGraph>(journeyGraphJsonSchema);

const graph: unknown = JSON.parse(await readFile('journey-graph.json', 'utf8'));
if (!validate(graph)) {
  console.error(validate.errors);
}
```

Das Schema nutzt Draft 2020-12 — bei Ajv also `Ajv2020` verwenden. Für andere Sprachen/Validatoren die Roh-Datei:

```ts
import schema from '@ductus/schema/journey-graph.schema.json' with { type: 'json' };
```

Hinweis: Das JSON Schema deckt die **Struktur** ab. Der Ductus-Core prüft darüber hinaus Integritätsregeln — z. B. keine Edges auf nicht existierende Nodes, eindeutige ids je Sammlung, `flow.start` existiert und ist ein `screen` — sowie Warnungen wie unerreichbare Nodes, fehlende `description` oder Zyklen ohne `condition`.

## Einen eigenen Adapter schreiben

Ein Adapter ist ein beliebiges Programm, das der Core als Subprozess startet. Das Protokoll:

1. **Aufruf:** Der Core ruft den Adapter mit `--project <absoluter Projektpfad> --config <Pfad zu einer temporären JSON-Datei>` auf. Die Config-Datei enthält die adapterspezifischen Schlüssel aus der `ductus.config.yaml` (z. B. `deriveFrom`).
2. **stdout:** ausschließlich das Graph-JSON — ein einziges `JourneyGraph`-Dokument, das gegen dieses Schema validiert. Nichts anderes auf stdout schreiben.
3. **stderr:** sämtliche Diagnostik (Logs, Warnungen). Sie wird vom Core durchgereicht, nie verschluckt.
4. **Exit-Code:** `0` bei Erfolg; jeder andere Code gilt als Adapterfehler.

Der Core prüft die stdout-Ausgabe sofort mit Ajv gegen `journeyGraphJsonSchema`; ungültige Ausgaben brechen den Lauf mit einer präzisen Fehlermeldung ab. Eingebunden wird der Adapter in der `ductus.config.yaml` über den `command`-Schlüssel eines Adapter-Eintrags.

Referenz-Implementierungen und Details im Repository:

- Adapter-Runner des Core: [packages/core/src/adapters/runner.ts](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/src/adapters/runner.ts)
- Dart-Adapter als Vorbild: [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)

## Exporte im Überblick

| Export | Art | Beschreibung |
| --- | --- | --- |
| `JourneyGraph`, `JourneyNode`, `JourneyEdge`, `JourneyFlow`, `SourceRef`, `AppInfo`, `AdapterInfo`, `GraphMeta` | Typen | Datenmodell des Graphen |
| `NodeType`, `TriggerType`, `SourceType` | Typen | String-Union-Typen für `type`, `trigger`, `source` |
| `journeyGraphJsonSchema` | Konstante | JSON Schema (Draft 2020-12) als TS-Objekt |
| `SCHEMA_VERSION`, `SUPPORTED_SCHEMA_MAJOR` | Konstanten | Versions-Konstanten |
| `parseSchemaVersion`, `isSupportedSchemaVersion` | Funktionen | Versions-Parsing und Kompatibilitätsprüfung |
| `@ductus/schema/journey-graph.schema.json` | Subpath-Export | Roh-JSON-Schema-Datei |

## Lizenz

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/schema/LICENSE) — Teil des [ductus-Monorepos](https://github.com/PlaxXOnline/ductus).
