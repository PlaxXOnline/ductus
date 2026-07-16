# @ductus/core

**English** | [Deutsch](./README.de.md) | [Español](./README.es.md) | [简体中文](./README.zh-CN.md)

**End-user documentation straight from your app code — automatic, verified, versionable.**

Ductus extracts a user-journey graph from annotated source code
(Dart/Flutter and TypeScript/JavaScript) and translates it via
LLM — with your own API key
(BYOK) — into polished end-user documentation: as MDX files or as a
static website. `@ductus/core` is the heart of the toolchain: CLI,
orchestrator, LLM layer, and output modules.

- **A graph, not prose, as the source** — adapters read routes and annotations from the code; `ductus extract` merges and validates them into `journey-graph.json`. Usable without an LLM.
- **BYOK LLM translation** — Anthropic, OpenAI, Mistral, any OpenAI-compatible endpoint (`custom`, e.g. local), or a deterministic `mock` provider for tests. No SDK dependencies; the key stays in your environment variable.
- **Faithfulness judge** — a second LLM pass checks whether the generated text is backed by the graph. Violations appear visibly in the output and in the report; above the threshold the run fails (exit 2).
- **Costs under control** — token/cost estimate before the first LLM call, segment cache under `.ductus/cache` (unchanged segments cost nothing again).
- **Two output modes** — MDX files for your existing docs pipeline or a ready-made static website (interactive journey site or Starlight).
- **CI-ready** — `ductus check` validates the graph and faithfulness without LLM costs; deterministic, byte-stable output.

## Installation

Requirement: Node.js ≥ 20.

```bash
# globally
npm install -g @ductus/core

# or as a devDependency in your project
npm install --save-dev @ductus/core
```

For Dart/Flutter projects, additionally install the adapter:

```bash
npm install -g @ductus/adapter-dart
```

and add the Dart package [`ductus`](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) (annotations + extractor) as a dependency in your Flutter project.

For TypeScript/JavaScript projects (e.g. React with react-router or Next.js), this is all you need:

```bash
npm install -g @ductus/core @ductus/adapter-typescript
```

No additional SDK or dependency in the target project is required — the [TypeScript adapter](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) parses the sources itself (parse-only, pure Node).

## Quickstart

```bash
cd my_project                        # Flutter or TS/JS project

ductus init                          # detects pubspec.yaml or package.json, creates ductus.config.yaml
ductus extract                       # → journey-graph.json + ductus-report.json

export DUCTUS_LLM_API_KEY=sk-…       # your own Anthropic/OpenAI key (BYOK)
ductus generate                      # → docs/*.mdx (or a website, depending on config)

ductus graph --open                  # inspect the graph as HTML in the browser
ductus check                         # CI gate: validation + faithfulness, no LLM costs
```

## CLI reference

Global options (before or after the command):

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to the `ductus.config.yaml` (default: `./ductus.config.yaml`) |
| `--offline` | No network access: `extract`/`check`/`graph` run freely (adapters work locally), `generate` only with `llm.provider: mock` |

Commands:

| Command | Options | Description |
|---|---|---|
| `ductus init` | `--force` | Creates a commented `ductus.config.yaml`. Detects `pubspec.yaml` (`app.name`, `go_router`/`auto_route` ⇒ `deriveFrom`) or `package.json` (`app.name`, `react-router`/`react-router-dom`/`next` ⇒ `deriveFrom`); `pubspec.yaml` takes priority when both exist. Only overwrites an existing config with `--force`. |
| `ductus extract` | — | Runs all adapters, merges and validates the graph. Writes `journey-graph.json` and `ductus-report.json` next to the config. Usable without an LLM. |
| `ductus generate` | `--build` | Extract + LLM generation → MDX or website. `--build` additionally builds the website after the export (`npm ci`/`install` + `npm run build` in the site directory; only with `output.format: website`, cannot be combined with `--offline`). |
| `ductus check` | — | Validation + faithfulness from the segment cache — writes no files, calls no LLM (CI-ready). Segments not yet generated are reported but are not an error. |
| `ductus graph` | `--open`, `--out <path>`, `--journey` | Prints the graph as a Mermaid flowchart on stdout. `--journey` prints the journey diagrams of the flow main paths instead. `--out` writes to a file. `--open` writes `.ductus/graph.html` (flowchart **and** journeys) and opens it in the browser. |
| `ductus help [command]` | — | Without an argument prints a rich CLI overview (workflow, commands, exit codes, configuration); with an argument shows the help for that specific command. |

## Configuration: `ductus.config.yaml`

`ductus init` generates exactly this template (values prefilled from the `pubspec.yaml` or `package.json`):

```yaml
# Ductus configuration
app:
  name: MyApp
  locale: en

adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]

llm:
  provider: anthropic        # anthropic | openai | mistral | custom | mock
  model: claude-sonnet-4-5
  apiKeyEnv: DUCTUS_LLM_API_KEY
  temperature: 0.2
  faithfulnessCheck: true

style:
  voice: en-you              # formal-sie | informal-du | en-you
  granularity: flow          # flow | screen

output:
  format: mdx                # mdx | website
  dir: docs/
  website:
    generator: journey       # journey | starlight | docusaurus
    diagrams: true
```

`app.locale` (default: `en`) is the language of the generated end-user
documentation. `style.voice` (default: `en-you`) sets its tone: `en-you`
addresses the reader in plain English “you”; `formal-sie` and `informal-du`
remain fully supported for German end-user docs (formal “Sie” and informal
“du”, respectively).

In TypeScript/JavaScript projects the `adapters:` section looks like this instead:

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

Further optional keys (with defaults where applicable):

| Key | Description |
|---|---|
| `app.platforms` | List of target platforms (purely informational, ends up in the graph metadata) |
| `adapters[].project` | Project directory relative to the config (default: `.`) |
| `adapters[].command` | Explicitly override the adapter command |
| `adapters[].extra` | Additional options passed 1:1 to the adapter (e.g. the `include` globs of the Dart and TypeScript adapters; unknown keys placed directly in the adapter entry end up there as well) |
| `llm.maxTokens` | Max output tokens per LLM call (default: `2048`) |
| `llm.baseUrl` | Base URL of the endpoint — **required** with `provider: custom` |
| `llm.faithfulnessThreshold` | Total faithfulness violations allowed; above it, exit 2 (default: `0`) |
| `llm.pricing.inputPerMTokUsd` / `llm.pricing.outputPerMTokUsd` | USD per 1M tokens — only with these values does Ductus convert the estimate to USD |
| `output.website.template` | Custom template directory instead of the bundled one |

Unknown top-level keys are only warnings (forward-compatible).

## Output modes

### `format: mdx`

Writes one MDX page with YAML frontmatter per segment (flow or screen,
depending on `style.granularity`) to `output.dir`. With `diagrams: true`,
every flow page contains the flow as a Mermaid `flowchart` and — as soon as
the derived main path has at least two nodes — additionally the main path
as a `journey` diagram. Faithfulness violations appear as a visible warning
box at the top of the page. The output is byte-stable — ideal for checking
in and diffing.

### `format: website`

Scaffolds a complete Astro website into `output.dir` (afterwards:
`npm install`, `npm run dev` or `npm run build` — or directly
`ductus generate --build`).

| Generator | Description |
|---|---|
| `journey` *(default)* | Interactive journey site built from `ductus.data.json`: clickable journey graph with deterministic layout, “Play path”, ⌘K/Ctrl+K search across journeys/steps/actions, step list + detailed LLM-written guide per journey. The site UI follows `app.locale` (English by default, German UI for `de`). [View template](https://github.com/PlaxXOnline/ductus/tree/main/templates/journey) |
| `starlight` | Classic docs site based on Astro/Starlight; the generated MDX pages go to `src/content/docs/`, Mermaid diagrams are rendered in the browser. [View template](https://github.com/PlaxXOnline/ductus/tree/main/templates/starlight) |
| `docusaurus` | Not included yet — `generate` aborts with a clear message; please use `journey` or `starlight`. |

## LLM: BYOK, costs, cache, faithfulness

**Bring Your Own Key.** The API key comes from the environment variable
named by `llm.apiKeyEnv` (default: `DUCTUS_LLM_API_KEY`) and never appears
in any output or error message.

| Provider | Notes |
|---|---|
| `anthropic` | Anthropic Messages API; key required |
| `openai` | OpenAI Chat Completions; key required |
| `mistral` | Mistral Chat Completions (OpenAI-compatible, api.mistral.ai); key required — set `model` explicitly, e.g. `mistral-large-latest` |
| `custom` | Any OpenAI-compatible endpoint via `llm.baseUrl` (e.g. local models) — without a key set, no Authorization header is sent |
| `mock` | Deterministic, no network — for tests, CI, and `--offline` |

**Cost estimate before the run.** Before the first provider call,
`generate` prints an estimate (segments, input/output tokens, with
`llm.pricing` also USD). The heuristic assumes ~4 characters per token;
the actual numbers appear after the run in the output and in
`ductus-report.json`.

**Segment cache.** Results are stored under `.ductus/cache`, keyed by
segment content, prompt version, model, and style (`voice`/`locale`).
Unchanged segments incur no LLM costs on subsequent runs; `generate`
reports hits and regenerations.

**Faithfulness check.** Two layers safeguard the generated text — LLM
claims are never accepted unverified:

1. **Deterministic vocabulary check** (always active, no LLM): all
   `**bold**` terms marked as UI elements in step lines are checked against
   the vocabulary of the graph segment (node titles, edge labels,
   conditions, app name). An invented UI element is guaranteed to be
   caught — regardless of model and judge.
2. **Faithfulness judge** (`llm.faithfulnessCheck: true`, default): a
   second LLM call looks for semantic deviations. The judge is not
   trusted — it is verified: every finding must quote the offending passage
   verbatim and name the allegedly missing element; code checks both
   mechanically. Refuted findings (quote not in the text, or element
   present in the graph after all) are discarded; borderline cases are kept
   as **hints** (`hints`) — only confirmed findings count as violations.
   With `anthropic`, `openai`, and `mistral`, structured output (tool use
   or `json_schema`) additionally enforces valid JSON on the API side.

Violations are written into the output as a warning box and listed in the
report; hints appear there separately and do **not** count against the
threshold. If the number of violations exceeds `llm.faithfulnessThreshold`
(default: `0`), the run ends with exit code 2 — the output is still
written so you can inspect the flagged passages.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Validation error in the graph or merge conflict between multiple adapter outputs (details line by line on stderr) |
| `2` | Faithfulness violations above the threshold |
| `3` | Config, LLM, adapter, or website build error (including usage errors such as `--build` + `--offline`) |

## CI recipe: `ductus check` without LLM costs

`ductus check` runs the adapters, validates the graph, and reads
faithfulness results exclusively from the segment cache — no LLM call, no
API key needed. For the faithfulness part to take effect in CI, check the
`.ductus/cache` directory into the repository (it comes from your last
local `ductus generate`).

```yaml
# GitHub Actions (excerpt)
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - uses: subosito/flutter-action@v2   # the Dart adapter needs the Dart/Flutter SDK
  - run: npm install -g @ductus/core @ductus/adapter-dart
  - run: flutter pub get
  - run: ductus check                  # exit 1 = broken graph, exit 2 = faithfulness
```

For TypeScript/JavaScript projects the SDK line goes away — the
TypeScript adapter is pure Node, no additional SDK is required:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm install -g @ductus/core @ductus/adapter-typescript
  - run: ductus check
```

## Note: Mermaid & CDN

The HTML page produced by `ductus graph --open` loads Mermaid from a CDN
when opened (jsdelivr, mermaid@11) — so rendering in the browser needs
network access once. The same applies to the diagram rendering of the
Starlight website; offline, the diagram source remains readable as a code
block. `--offline` itself only affects `generate` (allowed only with
`llm.provider: mock`, cannot be combined with `--build`).

## Ecosystem

| Package | Description |
|---|---|
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) | npm wrapper that makes the Dart adapter CLI callable |
| [`@ductus/adapter-typescript`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) | TypeScript/JavaScript adapter: `@journey:` comments + derivation from react-router/Next.js |
| [`ductus` (Dart)](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | pub.dev package: annotations, extractor, and build_runner builder for Flutter/Dart |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | JSON Schema and TypeScript types of the journey graph |

More in the [Ductus repository](https://github.com/PlaxXOnline/ductus):
[example projects](https://github.com/PlaxXOnline/ductus/tree/main/examples) ·
[best practices](https://github.com/PlaxXOnline/ductus#best-practices) (graph quality, workflow, LLM & costs).

## License

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/LICENSE)
