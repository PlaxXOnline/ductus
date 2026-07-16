# Changelog

## 0.3.0

- English is now the language of the package: CLI diagnostics (errors,
  warnings, usage text) and the API documentation are English. Message
  formats, the adapter contract (canonical graph JSON on stdout, diagnostics
  on stderr, exit codes), and the extraction behavior are unchanged.
  German-language product features (German journey content and German
  documentation output) are unaffected.
- The derived decision node for go_router redirects is now titled
  `Redirect: <Screen>` instead of `Weiterleitung: <Screen>` (tool-generated
  default title in the graph output; override via annotations as before).
- The German README translation (README.de.md) uses consistent informal
  address throughout.

## 0.2.0

- build_runner builder `journey_builder` (path D): writes the journey graph
  as `ductus_builder.g.json` into the target package's project root; active
  automatically via `auto_apply: dependents` on
  `dart run build_runner build`. Imported through `package:ductus/builder.dart`
  (factory `ductusJourneyBuilder`) — `package:ductus/ductus.dart` stays free
  of build/source_gen imports. Not to be confused with `ductus_graph.g.json`,
  the debug file of the adapter CLI.
- Resolution of non-literal constant annotation arguments (e.g.
  `title: MyConstants.title`) via the resolved AST (source_gen
  `TypeChecker`/`ConstantReader`); anything not constant-resolvable behaves
  like in the parse-only adapter (same error and warning formats).
- Parity guarantee: with purely literal annotations, `ductus_builder.g.json`
  is byte-identical to the stdout output of the parse-only adapter — except
  for exactly one intended difference: the artifact carries the
  `meta.adapters` entry `{"name": "dart-builder", "version": …}` instead of
  `{"name": "dart", …}` (provenance: which feeder produced the graph).
- Builder options `deriveFrom`/`include` in the target project's `build.yaml`
  (same keys and defaults as the CLI's `--config` JSON); `include` patterns
  without matches — e.g. outside the build_runner target sources — produce a
  warning in the build log.
- Adapter CLI: new flag `--from-builder` (config key `fromBuilder`; the flag
  wins) — emits `ductus_builder.g.json` to stdout after a `schemaVersion`
  check instead of scanning itself; if the file is missing, a clear error
  points to `dart run build_runner build`.
- New dependencies `build`/`source_gen` (ranges determined empirically, see
  the comment in `pubspec.yaml`); dev: `build_runner`/`build_test` for the
  builder tests.

## 0.1.0

- Journey annotations `@JourneyScreen`, `@JourneyAction`, `@JourneyDecision`,
  `@JourneyFlow` — pure markers without runtime behavior and without
  dependencies.
- Build-free comment convention (`// @journey:screen id="…" …`) as an
  equivalent alternative to the annotations.
- Automatic derivation from `go_router` (routes → screens, `ShellRoute` →
  flows, `redirect:` → decisions, `context.go()/push()/…` → transitions) and
  `auto_route` (`@RoutePage()` → screens) — best effort, overridable field by
  field via manual annotations.
- Adapter CLI `dart run ductus:adapter` following the Ductus adapter contract
  (stdout is exactly one graph JSON, diagnostics on stderr, exit 0/non-zero):
  parse-only via `package:analyzer`; the target project needs neither
  `pub get` nor a build.
- Canonical, diff-stable graph output (`journey-graph.json` form) on stdout;
  warnings on stderr, optional debug file `ductus_graph.g.json`.
