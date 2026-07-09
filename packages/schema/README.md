# @ductus/schema

JSON Schema und TypeScript-Typen für den Ductus-Journey-Graphen
(`journey-graph.json`) — die sprachunabhängige Austauschform zwischen
Sprachadaptern und dem Ductus-Core.

## Installation

```bash
npm install @ductus/schema
```

## Verwendung

```ts
import type { JourneyGraph } from '@ductus/schema';

const graph: JourneyGraph = JSON.parse(
  await readFile('journey-graph.json', 'utf8'),
);
```

Das rohe JSON Schema (z. B. für Ajv oder andere Validatoren):

```ts
import schema from '@ductus/schema/journey-graph.schema.json' with { type: 'json' };
```

## Weiterführende Doku

Verbindliche Spezifikation und Datenformen: siehe
[SPEC.md](https://github.com/PlaxXOnline/ductus/blob/main/SPEC.md) und
[docs/DESIGN-DECISIONS.md](https://github.com/PlaxXOnline/ductus/blob/main/docs/DESIGN-DECISIONS.md)
im [Ductus-Repository](https://github.com/PlaxXOnline/ductus).

## Lizenz

[MIT](LICENSE)
