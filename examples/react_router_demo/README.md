# react_router_demo — Derivation (path C) + comments (path A)

This demo shows the core promise of Ductus in a React project: a useful
journey graph exists **before** a single comment is written — `@journey:`
comments only enrich where semantics are missing. No `npm install` in the
project is needed: the adapter parses the sources without installation.

## What happens here?

**Automatically derived (path C, `source: "derived"`):**

- The four routes from `createBrowserRouter` (`/login`, `/register`,
  `/dashboard`, `/settings` in `src/router.tsx`) become screen nodes —
  `DashboardScreen` and `SettingsScreen` are deliberately **not** annotated
  and exist in the graph purely through derivation.
- The pathless layout route (`element: <AppShell />` with `children`) groups
  `dashboard` and `settings` into a flow (`shell-0`) — the react-router
  counterpart to the `ShellRoute`.
- The `loader: requireAuth` on `/dashboard` calls `redirect('/login')` and
  becomes the decision node `dashboard_redirect`; the string literal
  `'/login'` yields a conditional edge towards `login`.
- `<Link to="…">` with visible text (a label!) and `navigate('/…')` calls
  with a literal argument become transitions, e.g. `dashboard → settings`
  (“Einstellungen”) and `settings → login` (sign out).

**Manually enriched (path A, `source: "annotation"`):**

- `LoginScreen` and `RegisterScreen` carry `@journey:screen` comments with a
  German title, `flow` and `description` (better LLM prose) — with the
  **same ids** (`login`, `register`) that the derivation builds from the
  paths.
- A `@journey:action` with `trigger="submit"` leads from `login` into the
  `@journey:decision` `login-check` (“Zugangsdaten gültig?”), which branches
  with **two conditional auto actions** to `dashboard` or back to `login`.
- A `@journey:flow` (`auth`, start `login`) bundles the sign-in flow.
- The edge `register → login` derived from `navigate('/login')` merges with
  the `@journey:action` of the same direction.

Manual values override derived ones field by field (precedence rule:
comment beats derivation, per field).

## Try it

```sh
npm install -g @ductus/core @ductus/adapter-typescript

# in the examples/react_router_demo directory
ductus extract             # create + validate the graph → journey-graph.json
ductus generate            # additionally LLM docs → docs/*.mdx
```

The checked-in `ductus.config.yaml` uses `llm.provider: mock` — `generate`
therefore runs without an API key. For real prose, set `provider: anthropic`
and provide a key via `DUCTUS_LLM_API_KEY`. `extract` runs completely
offline.
