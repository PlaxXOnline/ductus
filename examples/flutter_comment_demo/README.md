# comment_demo — Kommentar-Konvention (Weg A)

Diese Demo zeigt den universellen, **buildfreien** Eingabeweg: Alle
Journey-Informationen stehen in `@journey:`-Kommentarblöcken. Die App hat
deshalb bewusst **keine** Abhängigkeit auf das `ductus`-Paket — Kommentare
brauchen weder Import noch Build-Schritt und funktionieren identisch in jeder
Sprache.

## Was passiert hier?

Eine kleine Notiz-App mit vier Screens (`Navigator.push`, kein Router-Paket):

| Screen | id |
|---|---|
| Notizliste (Start) | `note-list` |
| Notiz-Detail | `note-detail` |
| Notiz-Editor | `note-editor` |
| Einstellungen | `settings` |

Annotiert per Kommentar sind:

- ein `@journey:flow` (`notes`, Start `note-list`) in `lib/main.dart`,
- je Screen ein `@journey:screen` mit `description`,
- mehrere `@journey:action` mit `from`/`to`/`trigger` (tap, submit, back),
- ein `@journey:decision` (`save-check`) im Editor mit **zwei bedingten
  Actions**: „Titel vorhanden" → zurück zur Liste, „Titel fehlt" → zurück in
  den Editor.

Da kein Router-Paket im Spiel ist, gibt es nichts abzuleiten — der komplette
Graph stammt aus den Kommentaren (`source: "annotation"`).

## Ausprobieren

```sh
# im Verzeichnis examples/flutter_comment_demo
ductus init                # legt ductus.config.yaml an
ductus extract             # Graph erzeugen + validieren → journey-graph.json
ductus generate            # zusätzlich LLM-Doku (BYOK) → docs/*.mdx
```

Für `generate` muss ein API-Key gesetzt sein (`DUCTUS_LLM_API_KEY`).
`extract` läuft komplett offline.
