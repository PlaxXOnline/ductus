---
"@ductus/core": patch
"@ductus/schema": patch
"@ductus/adapter-typescript": patch
"@ductus/adapter-dart": patch
---

The example apps (flutter_comment_demo, flutter_go_router_demo,
react_router_demo) are now English — annotation content, UI strings, and
configs (`locale: en`, `voice: en-you`) — and the demo-derived artifacts in
the root README were regenerated from the English graph; e2e expectations
updated accordingly. Test runs now build all workspaces exactly once in a
vitest global setup, fixing a build race between test files that each built
in `beforeAll`. The German README translations (`README.de.md`) use
consistent informal address throughout.
