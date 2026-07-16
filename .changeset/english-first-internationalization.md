---
"@ductus/core": minor
"@ductus/schema": patch
"@ductus/adapter-typescript": patch
"@ductus/adapter-dart": patch
---

English is now the default language across the toolchain. All CLI output,
help text, error messages and code comments are English; `ductus init`
scaffolds `app.locale: en` and `style.voice: en-you` (German voices
`formal-sie`/`informal-du` remain fully supported). New `ductus help
[command]` subcommand with a rich overview: typical workflow, per-command
one-liners, exit codes, config and API-key notes. Generated output is now
locale-aware instead of hardcoded German: MDX section headings, the
faithfulness-warning aside, the Mermaid journey section, the misc-segment
title and the mock provider follow `app.locale`/voice (German only for
`de*` locales); the page-slug fallback changed from `seite` to `page`, and
the journey website template falls back to English UI strings for non-German
locales. The faithfulness judge now receives an English prompt for the
`en-you` voice (German voices keep the previous prompt byte-identically);
PROMPT_VERSION was bumped to 3, so existing segment caches regenerate once. Derived redirect decision nodes are titled `Redirect: <Screen>`
(previously `Weiterleitung: <Screen>`). READMEs are English with German,
Spanish and Simplified Chinese translations alongside.
