---
"@ductus/core": patch
---

Make the faithfulness judge more robust: parse JSON embedded in prose (not just raw JSON or ```json fences), include a snippet of the raw response in the report when parsing still fails, and skip caching segments whose judge response was unparsable so the next run retries instead of replaying the failure.
