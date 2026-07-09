# @ductus/adapter-dart

Dünner Wrapper, der den Ductus-Dart-Adapter (pub.dev-Paket
[`ductus`](https://pub.dev/packages/ductus)) für `@ductus/core` aufrufbar
macht. Enthält selbst keine Analyse-Logik.

## Installation

```bash
npm install -g @ductus/adapter-dart
# im Zielprojekt (oder global):
dart pub add dev:ductus
```

## Verwendung

Wird normalerweise nicht direkt aufgerufen — `ductus extract` (aus
`@ductus/core`) findet und startet den Wrapper automatisch. Manuell:

```bash
ductus-adapter-dart --project <dir> [--config <json>]
```

stdout ist genau ein kanonisches Graph-JSON (Adapter-Vertrag, SPEC §7.1);
Warnungen gehen auf stderr.

## Weiterführende Doku

Verbindliche Spezifikation:
[SPEC.md](https://github.com/PlaxXOnline/ductus/blob/main/SPEC.md)
im [Ductus-Repository](https://github.com/PlaxXOnline/ductus).

## Lizenz

[MIT](LICENSE)
