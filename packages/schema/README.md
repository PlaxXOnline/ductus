# @ductus/schema

**English** | [Deutsch](./README.de.md) | [Español](./README.es.md) | [简体中文](./README.zh-CN.md)

The contract behind [ductus](https://github.com/PlaxXOnline/ductus): TypeScript types and JSON Schema (Draft 2020-12) for the journey graph (`journey-graph.json`) — the single contract surface between language adapters and the Ductus core.

Language adapters (e.g. the [Dart adapter](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)) extract a graph in this format from annotated app code; the core validates it, merges it, and translates it into end-user documentation. If you are writing your own adapter or processing `journey-graph.json` programmatically, this package is exactly what you need — nothing else.

**Who is this for?** Authors of custom adapters and tooling developers who want to read, produce, or validate the graph. You do not need this package just to use ductus — it ships as a dependency of [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Installation

```bash
npm install @ductus/schema
```

## The data model in 60 seconds

A journey graph is a directed graph of an app's user journey: screens, actions, and branches as nodes, transitions as edges, and thematic subsets as flows.

| Type | Meaning | Required fields |
| --- | --- | --- |
| `JourneyGraph` | Top-level document | `schemaVersion`, `flows`, `nodes`, `edges` |
| `JourneyNode` | Screen, action, or decision | `id`, `type`, `source`; `title` for `screen`/`decision`, `label` for `action` |
| `JourneyEdge` | Directed transition between two nodes | `id`, `from`, `to`, `source` |
| `JourneyFlow` | Named subset of the graph with an entry point | `id`, `title`, `start` |
| `SourceRef` | Back-reference into the source code | `file` (optional `line`, `symbol`) |

The most important fields in detail:

- **`JourneyNode.type`** — `'screen' | 'action' | 'decision'`. Screens and decisions carry a `title`, actions a `label` (the JSON Schema enforces this). Optional: `description` (noticeably improves LLM quality), `flow`, `tags`, `sourceRef`.
- **`JourneyEdge`** — connects `from` → `to` (node ids). Optional: `trigger` (`'tap' | 'submit' | 'auto' | 'back' | 'deeplink' | 'system'`), `label` (caption for the transition), and `condition` (the condition under which the transition applies — important, among other things, so that cycles have a recognizable exit condition).
- **`JourneyFlow.start`** — id of the entry node. It must exist and be of type `screen`; the core checks this during validation.
- **`source`** — on nodes and edges: `'annotation'` (explicitly annotated in the code) or `'derived'` (derived by the adapter, e.g. from router configuration).
- **`SourceRef`** — locates an element in the source code (`file`, optional 1-based `line` and `symbol`) so that documentation claims remain traceable down to the code location.

Unknown extra fields are allowed (`additionalProperties` stays open): newer adapters may add fields without breaking older consumers.

### Versioning: `schemaVersion`

`schemaVersion` has the format `"major.minor"`. The rule is simple: **same major version ⇒ compatible** — minor additions are backwards compatible, incompatible majors are rejected by the core. The package exports:

| Export | Value/purpose |
| --- | --- |
| `SCHEMA_VERSION` | `'1.0'` — the version this package describes |
| `SUPPORTED_SCHEMA_MAJOR` | `1` — major version supported by the core |
| `parseSchemaVersion(v)` | splits `"major.minor"`, `null` for an invalid format |
| `isSupportedSchemaVersion(v)` | `true` if the major version matches |

## Minimal valid example

```json
{
  "schemaVersion": "1.0",
  "app": { "name": "Demo App" },
  "flows": [
    { "id": "login", "title": "Sign-in", "start": "login_screen" }
  ],
  "nodes": [
    {
      "id": "login_screen",
      "type": "screen",
      "title": "Login",
      "description": "Sign in with email and password.",
      "source": "annotation",
      "sourceRef": { "file": "lib/pages/login_page.dart", "line": 12 }
    },
    {
      "id": "submit_login",
      "type": "action",
      "label": "Sign in",
      "description": "Submits the credentials.",
      "source": "annotation"
    },
    {
      "id": "home_screen",
      "type": "screen",
      "title": "Home",
      "description": "Overview after a successful sign-in.",
      "source": "annotation"
    }
  ],
  "edges": [
    { "id": "e1", "from": "login_screen", "to": "submit_login", "trigger": "tap", "source": "annotation" },
    { "id": "e2", "from": "submit_login", "to": "home_screen", "trigger": "submit", "condition": "credentials valid", "source": "annotation" }
  ]
}
```

## Usage in TypeScript

All types come from the main entry point:

```ts
import type { JourneyGraph, JourneyNode, JourneyEdge, JourneyFlow, SourceRef } from '@ductus/schema';
import { SCHEMA_VERSION, SUPPORTED_SCHEMA_MAJOR, isSupportedSchemaVersion } from '@ductus/schema';
```

### Validating with Ajv

The JSON Schema is available in two forms — as the TS export `journeyGraphJsonSchema` and as a raw file via the subpath export `@ductus/schema/journey-graph.schema.json`:

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

The schema uses Draft 2020-12 — so with Ajv, use `Ajv2020`. For other languages/validators, use the raw file:

```ts
import schema from '@ductus/schema/journey-graph.schema.json' with { type: 'json' };
```

Note: the JSON Schema covers the **structure**. Beyond that, the Ductus core checks integrity rules — e.g. no edges to non-existent nodes, unique ids per collection, `flow.start` exists and is a `screen` — plus warnings such as unreachable nodes, missing `description`, or cycles without a `condition`.

## Writing your own adapter

An adapter is any program the core launches as a subprocess. The protocol:

1. **Invocation:** the core calls the adapter with `--project <absolute project path> --config <path to a temporary JSON file>`. The config file contains the adapter-specific keys from `ductus.config.yaml` (e.g. `deriveFrom`).
2. **stdout:** the graph JSON only — a single `JourneyGraph` document that validates against this schema. Write nothing else to stdout.
3. **stderr:** all diagnostics (logs, warnings). The core passes it through, never swallows it.
4. **Exit code:** `0` on success; any other code counts as an adapter error.

The core immediately validates the stdout output against `journeyGraphJsonSchema` using Ajv; invalid output aborts the run with a precise error message. The adapter is wired up in `ductus.config.yaml` via the `command` key of an adapter entry.

Reference implementations and details in the repository:

- The core's adapter runner: [packages/core/src/adapters/runner.ts](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/src/adapters/runner.ts)
- The Dart adapter as a blueprint: [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)
- The TypeScript adapter as a second reference implementation: [packages/adapter-typescript](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) — it uses this package directly (`SCHEMA_VERSION`) and demonstrates the protocol in the same language as the core.

## Exports at a glance

| Export | Kind | Description |
| --- | --- | --- |
| `JourneyGraph`, `JourneyNode`, `JourneyEdge`, `JourneyFlow`, `SourceRef`, `AppInfo`, `AdapterInfo`, `GraphMeta` | Types | Data model of the graph |
| `NodeType`, `TriggerType`, `SourceType` | Types | String union types for `type`, `trigger`, `source` |
| `journeyGraphJsonSchema` | Constant | JSON Schema (Draft 2020-12) as a TS object |
| `SCHEMA_VERSION`, `SUPPORTED_SCHEMA_MAJOR` | Constants | Version constants |
| `parseSchemaVersion`, `isSupportedSchemaVersion` | Functions | Version parsing and compatibility check |
| `@ductus/schema/journey-graph.schema.json` | Subpath export | Raw JSON Schema file |

## License

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/schema/LICENSE) — part of the [ductus monorepo](https://github.com/PlaxXOnline/ductus).
