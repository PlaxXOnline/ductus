---
"@ductus/core": patch
---

The deterministic vocabulary check now parses bold spans containing nested
italics (`**Tap *Edit note***`) correctly. Previously the span was closed at
the wrong delimiter of a `***` run, so the prose BETWEEN two real spans was
reported as an invented UI element while the real terms went unchecked.
