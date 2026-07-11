---
"@ductus/core": minor
---

Verified faithfulness checking — LLM statements are no longer trusted blindly:

- **Deterministic lexicon check** (always on, no LLM): every `**bold**` term in
  step lines of the generated Markdown is checked against the graph segment's
  vocabulary (node titles, edge labels, conditions, app name). Invented UI
  elements are caught deterministically.
- **Judge verification**: the faithfulness judge must now cite the offending
  passage verbatim (`quote`) and name the missing `element`; both are verified
  mechanically. Refuted findings (quote not in text, or element present in the
  segment) are discarded, borderline findings are reported as separate `hints`
  that do not count against `faithfulnessThreshold`.
- **Structured output**: judge calls enforce a JSON schema API-side (Anthropic
  via forced tool use, OpenAI/Mistral via `response_format: json_schema`,
  custom endpoints via `json_object`), eliminating unparsable judge responses
  for these providers.
- `ductus check`, `ductus-report.json` and the segment cache carry the new
  `hints` channel; `PROMPT_VERSION` is bumped to `2`, invalidating existing
  segment caches on first regeneration.
