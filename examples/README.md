# Ductus — Example apps

Three minimal apps (two Flutter, one React) demonstrating three of the four
input paths of Ductus (path A: comment convention, path B: Dart annotations,
path C: automatic routing derivation). All of them produce a validated
`journey-graph.json` with `ductus extract` and end-user docs as MDX with
`ductus generate` (BYOK).

| Demo | Shows | Key point |
|---|---|---|
| [`flutter_go_router_demo/`](flutter_go_router_demo/) | **Path C** (automatic derivation from go_router) + **Path B** (Dart annotations) | Dashboard/Settings are unannotated and come purely from the routing derivation; Login/Register are enriched via `@JourneyScreen`/`@JourneyAction`. |
| [`flutter_comment_demo/`](flutter_comment_demo/) | **Path A** (comment convention `@journey:`) | Completely build-free — no `ductus` dependency, no router package; the entire graph comes from comment blocks. |
| [`react_router_demo/`](react_router_demo/) | **Path C** (automatic derivation from react-router) + **Path A** (comment convention `@journey:`) | TypeScript/React instead of Flutter: Dashboard/Settings come purely from the routing derivation (including shell flow and redirect decision); Login/Register are enriched via `@journey:` comments. |

Details and commands are in each demo's README.
