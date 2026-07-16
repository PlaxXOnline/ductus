# ductus

**English** | [Deutsch](./README.de.md) | [Español](./README.es.md) | [简体中文](./README.zh-CN.md)

**End-user documentation straight from your Flutter code.** `ductus` provides
journey annotations and an adapter CLI that extract a user-journey graph from
your app — the [Ductus CLI (`@ductus/core`)](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
turns it into LLM-maintained documentation as MDX files or a static website,
versioned with your code.

- **Four input paths, freely combinable:** `@journey:` comments (build-free),
  Dart annotations, automatic derivation from `go_router`/`auto_route`,
  build_runner builder.
- **Zero runtime cost:** The annotations are pure markers — no runtime
  behavior, no extra code in your app binary.
- **No build required:** The adapter analyzes parse-only; the target project
  needs neither `pub get` nor a build.
- **Deterministic:** The output is canonical, diff-stable JSON — ideal for
  code review and CI.

## Installation

For annotations in your app code (`@JourneyScreen` & co. in `lib/`):

```bash
dart pub add ductus
```

Only the adapter CLI, without annotations in the code:

```bash
dart pub add dev:ductus
```

Entirely without a dependency in the project (comment convention, see below):

```bash
dart pub global activate ductus
```

## Quickstart: annotate → extract → generate

```dart
import 'package:ductus/ductus.dart';

@JourneyScreen(
  id: 'login',
  title: 'Sign in',
  flow: 'auth',
  description: 'Screen where the user signs in.',
)
class LoginScreen extends StatelessWidget {
  @JourneyAction(
    label: 'Sign in',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'credentials valid',
  )
  void onSubmit() { /* … */ }
}

@JourneyFlow(id: 'auth', title: 'Login & registration', start: 'login')
class AuthFlow {}
```

Then with the Ductus CLI (Node.js ≥ 20):

```bash
npm install -g @ductus/core @ductus/adapter-dart

ductus init        # creates ductus.config.yaml, detects pubspec.yaml + router
ductus extract     # build + validate the graph → journey-graph.json
ductus generate    # LLM docs (BYOK) → docs/*.mdx or a static website
```

For `generate`, your own API key (Anthropic, OpenAI, or a compatible
endpoint) in the `DUCTUS_LLM_API_KEY` environment variable is all it takes;
`extract` runs completely offline. To try it out without a key:
`llm.provider: mock` in `ductus.config.yaml`.

Runnable examples:
[flutter_go_router_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_go_router_demo)
(derivation + annotations) and
[flutter_comment_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_comment_demo)
(comments only, no dependency).

## The annotation API

All annotations come from `package:ductus/ductus.dart`:

| Annotation | Parameters (required in **bold**) | Effect on the graph |
|---|---|---|
| `@JourneyScreen` | **`id`**, **`title`**, `flow`, `description`, `tags` | Screen node; on classes |
| `@JourneyAction` | **`label`**, **`to`**, `from`, `id`, `trigger`, `condition` | Transition (edge); on methods, functions, and fields |
| `@JourneyDecision` | **`id`**, **`title`**, `flow`, `description`, `tags` | Decision node (branching point) |
| `@JourneyFlow` | **`id`**, **`title`**, **`start`**, `description` | Named flow; `start` must be the id of a screen |

- `trigger` is a `JourneyTrigger`: `tap` (default), `submit`, `auto`,
  `back`, `deeplink`, `system`.
- If `from` is missing on a `@JourneyAction`, the enclosing class known as a
  screen is used.
- Without an action `id`, `e_<from>_<to>` is generated deterministically.
- Arguments are string literals; if you need constant references like
  `title: MyConstants.title`, use the build_runner builder (below).

## Build-free: the `@journey:` comment convention

Equivalent to the annotations, works in `//` and `///` comments — the
project then doesn't even need `ductus` as a dependency:

```dart
// @journey:screen id="dashboard" title="Overview"
//   description="Central overview after signing in."
class DashboardScreen { … }
```

A block starts with `@journey:<screen|action|decision|flow>`, pairs are
`key="value"` (`\"` escapes a quote), continuation on immediately following
comment lines; it ends at the first non-comment line or at the next
`@journey:` block. Required fields are the same as for the annotations;
unknown keys are ignored with a warning, `tags` is comma-separated.

Setup entirely without a project dependency:

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

The Ductus CLI finds the globally activated adapter via
`dart pub global run`; alternatively, the `DUCTUS_DART_ADAPTER_DIR`
environment variable points to a directory containing the adapter package.

## Automatic derivation from go_router / auto_route

Even without a single annotation, you already get a usable graph:

| Source | becomes |
|---|---|
| `GoRoute` | Screen node |
| `ShellRoute` | Flow |
| `redirect:` | Decision node |
| `context.go()` / `push()` / `goNamed()` / … with a string literal | Transition |
| `@RoutePage()` classes (auto_route) | Screen node |

Derived elements carry `source: "derived"`; manual annotations with the same
id override derived values field by field. Two manual sources with
conflicting values are an error that reports both source locations. Derived
ids are the route `name` or the path slug
(`/users/:id/edit` ⇒ `users-edit`).

The `auto_route` derivation is explicitly **best effort**: only
`@RoutePage()` screens and the path table are recognized, no navigation
edges — you add transitions via `@JourneyAction` or `@journey:action`.

Which derivations run is controlled by `deriveFrom` (default: both) — in
`ductus.config.yaml` under `adapters:` or as the adapter CLI's `--config`
JSON.

## The build_runner builder

For projects that run `build_runner` anyway: the builder
`ductus:journey_builder` runs as a build step and writes the graph as
`ductus_builder.g.json` into the project root. Its added value is
**resolution**: non-literal constant annotation arguments
(e.g. `title: MyConstants.title`) are resolved via the resolved AST instead
of being rejected as an error/warning.

```bash
dart pub add ductus dev:build_runner
dart run build_runner build
# → ductus_builder.g.json in the project root
```

The builder is active automatically via `auto_apply: dependents`; the
project only needs its own `build.yaml` for options — `deriveFrom` and
`include` are supported, with the same defaults as the adapter CLI:

```yaml
targets:
  $default:
    builders:
      ductus:journey_builder:
        options:
          deriveFrom: [go_router]
          include: [lib/**]
```

The artifact enters the pipeline with `--from-builder` — the adapter CLI
then only checks the `schemaVersion` and passes the file through; no scan of
its own takes place:

```bash
dart run ductus:adapter --project . --from-builder
```

or in `ductus.config.yaml`:

```yaml
adapters:
  - dart:
      project: .
      fromBuilder: true
```

Things to keep in mind:

- `ductus_builder.g.json` is only as fresh as the last build_runner run —
  so run `dart run build_runner build` before `ductus extract` (or keep
  `watch` running). If the file is missing, `--from-builder` aborts with a
  hint.
- The builder only sees files in the build_runner target sources (default
  includes `lib/`); `include` patterns outside of that produce a warning
  with no matches — then extend `targets.$default.sources` or use the
  adapter CLI.
- With purely literal annotations, the result is byte-identical to the
  adapter CLI — except for the `meta.adapters` name (`dart-builder` instead
  of `dart`).
- `ductus_builder.g.json` belongs in `.gitignore` (build artifact) — not to
  be confused with `ductus_graph.g.json`, the adapter CLI's debug file.

## The adapter CLI

```
dart run ductus:adapter --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

| Option | Meaning |
|---|---|
| `--project <dir>` | Project directory (required) |
| `--config <file>` | JSON configuration file, e.g. `{"deriveFrom": ["go_router"], "include": ["lib/**"]}` (defaults: both derivations on, `lib/**`) |
| `--no-debug-file` | Suppresses the debug file `ductus_graph.g.json` in the project directory |
| `--from-builder` | Passes `ductus_builder.g.json` through instead of scanning itself (equivalent: config key `"fromBuilder": true`; the flag wins) |

Behavior: stdout is exactly one canonical graph JSON (deterministic,
diff-stable), warnings and hints go to stderr; exit 0 on success, non-zero
on errors. The analysis is parse-only — the target project needs neither
`pub get` nor a build; only `--from-builder` requires a prior build_runner
run.

Important for the parse-only paths (comments, annotations, derivation):
required fields (`id`, `title`, `label`, `to`, `start`) and an explicit
`from` must be string literals — otherwise the adapter aborts with an error.
Optional fields that cannot be read literally are dropped with a warning; an
unreadable `trigger` falls back to `tap` with a warning. Navigation calls
are only recognized as transition candidates with a string-literal argument
(`context.go('/settings')`).

## Working with the Ductus CLI

The Node side orchestrates the adapter and turns the graph into docs:

| Command (`@ductus/core`) | Purpose |
|---|---|
| `ductus init` | Creates `ductus.config.yaml`; detects `pubspec.yaml` (app name, go_router/auto_route) |
| `ductus extract` | Runs the Dart adapter, validates, and writes `journey-graph.json` |
| `ductus generate` | Generates MDX files or a static website via LLM (BYOK); includes the faithfulness check |
| `ductus check` | Checks graph validity and faithfulness without writing files (CI) |
| `ductus graph` | Prints the graph as Mermaid; `--open` renders it as HTML in the browser |
| `ductus help [command]` | Prints a CLI overview or the help for a specific command |

Generated documentation defaults to English (`app.locale: en`, voice
`en-you`); for German end-user docs, set `style.voice` to `formal-sie` or
`informal-du`.

Learn more in the [repository README](https://github.com/PlaxXOnline/ductus)
and the [`@ductus/core` documentation](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## License

MIT — see [LICENSE](https://github.com/PlaxXOnline/ductus/blob/main/dart/ductus/LICENSE).
