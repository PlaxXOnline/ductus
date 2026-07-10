# Demo-Daten für die GitHub-Pages-Site

`ductus.data.json` ist die Datenquelle der
[Live-Demo](https://plaxxonline.github.io/ductus/). Sie wurde mit
`ductus generate` aus [`examples/flutter_comment_demo`](../examples/flutter_comment_demo)
erzeugt (Provider `mistral`, Modell `ministral-3b-2512` — bewusst ein sehr
kleines Modell; auch der dort transparent gemeldete Judge-Ausfall ist Teil
der Demo).

Der Workflow [.github/workflows/pages.yml](../.github/workflows/pages.yml)
baut daraus bei jedem Push auf `main` die Site: [templates/journey](../templates/journey)
+ diese Datei → `astro build --site https://plaxxonline.github.io --base /ductus/`.

## Aktualisieren

```bash
cd examples/flutter_comment_demo
export DUCTUS_LLM_API_KEY=…        # eigener Key (BYOK)
ductus generate                     # → docs/ductus.data.json
cp docs/ductus.data.json ../../demo/ductus.data.json
```
