# go_router_demo — Derivation (path C) + annotations (path B)

This demo shows the core promise of Ductus: a useful journey graph exists
**before** a single annotation is written — annotations only enrich where
semantics are missing.

## What happens here?

**Automatically derived (path C, `source: "derived"`):**

- The four `GoRoute` entries (`login`, `register`, `dashboard`, `settings`)
  become screen nodes — `DashboardScreen` and `SettingsScreen` are deliberately
  **not** annotated and exist in the graph purely through derivation.
- The `ShellRoute` groups `dashboard` and `settings` into a flow.
- The top-level `redirect` becomes a decision node; the string literal
  `'/login'` in its body yields a conditional edge towards `login`.
- `context.goNamed(…)` calls with a literal argument become transition
  candidates.

**Manually enriched (path B, `source: "annotation"`):**

- `LoginScreen` and `RegisterScreen` carry `@JourneyScreen` with an explicit
  title and `description` (better LLM prose).
- `@JourneyAction` on the submit handlers provides the label, trigger and
  condition of the transitions (`login → dashboard`, `register → login`).
- `@JourneyFlow(id: 'auth', …)` bundles the sign-in flow with start `login`.

Manual values override derived ones field by field (precedence rule:
annotation beats derivation, per field).

## Try it

```sh
# in the examples/flutter_go_router_demo directory
ductus init                # detects the Dart adapter + go_router
ductus extract             # create + validate the graph → journey-graph.json
ductus generate            # additionally LLM docs (BYOK) → docs/*.mdx
```

`generate` requires an API key (`DUCTUS_LLM_API_KEY`).
`extract` runs completely offline.
