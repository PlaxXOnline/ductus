# Demo data for the GitHub Pages site

`ductus.data.json` is the data source of the
[live demo](https://plaxxonline.github.io/ductus/). It was produced with
`ductus generate` from [`examples/flutter_comment_demo`](../examples/flutter_comment_demo)
(provider `mistral`, model `ministral-3b-2512` — deliberately a very small
model; the judge failure transparently reported there is part of the demo,
too).

The workflow [.github/workflows/pages.yml](../.github/workflows/pages.yml)
builds the site from it on every push to `main`: [templates/journey](../templates/journey)
+ this file → `astro build --site https://plaxxonline.github.io --base /ductus/`.

## Updating

```bash
cd examples/flutter_comment_demo
export DUCTUS_LLM_API_KEY=…        # your own key (BYOK)
ductus generate                     # → docs/ductus.data.json
cp docs/ductus.data.json ../../demo/ductus.data.json
```
