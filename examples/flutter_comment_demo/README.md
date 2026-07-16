# comment_demo — Comment convention (path A)

This demo shows the universal, **build-free** input path: all journey
information lives in `@journey:` comment blocks. The app therefore
deliberately has **no** dependency on the `ductus` package — comments need
neither an import nor a build step and work identically in every language.

## What happens here?

A small notes app with four screens (`Navigator.push`, no router package):

| Screen | id |
|---|---|
| Note list (start) | `note-list` |
| Note detail | `note-detail` |
| Note editor | `note-editor` |
| Settings | `settings` |

Annotated via comments are:

- one `@journey:flow` (`notes`, start `note-list`) in `lib/main.dart`,
- one `@journey:screen` with a `description` per screen,
- several `@journey:action` with `from`/`to`/`trigger` (tap, submit, back),
- one `@journey:decision` (`save-check`) in the editor with **two conditional
  actions**: “Titel vorhanden” (title present) → back to the list,
  “Titel fehlt” (title missing) → back to the editor.

Since no router package is involved, there is nothing to derive — the entire
graph comes from the comments (`source: "annotation"`).

## Try it

```sh
# in the examples/flutter_comment_demo directory
ductus init                # creates ductus.config.yaml
ductus extract             # create + validate the graph → journey-graph.json
ductus generate            # additionally LLM docs (BYOK) → docs/*.mdx
```

`generate` requires an API key (`DUCTUS_LLM_API_KEY`).
`extract` runs completely offline.
