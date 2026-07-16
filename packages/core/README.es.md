# @ductus/core

[English](./README.md) | [Deutsch](./README.de.md) | **Español** | [简体中文](./README.zh-CN.md)

**Documentación para usuarios finales directamente desde el código de tu app — automática, verificada, versionable.**

Ductus extrae un grafo de user journey a partir de código fuente anotado
(Dart/Flutter y TypeScript/JavaScript) y lo traduce mediante un
LLM — con tu propia clave de API
(BYOK) — en documentación pulida para usuarios finales: como archivos MDX
o como un sitio web estático. `@ductus/core` es el corazón de la cadena de
herramientas: CLI, orquestador, capa de LLM y módulos de salida.

- **Un grafo, no prosa, como fuente** — los adaptadores leen rutas y anotaciones del código; `ductus extract` las fusiona y valida en `journey-graph.json`. Utilizable sin LLM.
- **Traducción LLM con BYOK** — Anthropic, OpenAI, Mistral, cualquier endpoint compatible con OpenAI (`custom`, p. ej. local) o un proveedor `mock` determinista para tests. Sin dependencias de SDK; la clave permanece en tu variable de entorno.
- **Faithfulness judge** — una segunda pasada de LLM comprueba si el texto generado está respaldado por el grafo. Las violaciones aparecen de forma visible en la salida y en el informe; por encima del umbral, la ejecución falla (exit 2).
- **Costes bajo control** — estimación de tokens/costes antes de la primera llamada al LLM, caché de segmentos en `.ductus/cache` (los segmentos sin cambios no vuelven a costar nada).
- **Dos modos de salida** — archivos MDX para tu pipeline de documentación existente o un sitio web estático listo para usar (sitio interactivo de journeys o Starlight).
- **Listo para CI** — `ductus check` valida el grafo y el faithfulness sin costes de LLM; salida determinista y estable a nivel de bytes.

## Instalación

Requisito: Node.js ≥ 20.

```bash
# de forma global
npm install -g @ductus/core

# o como devDependency en tu proyecto
npm install --save-dev @ductus/core
```

Para proyectos Dart/Flutter, instala además el adaptador:

```bash
npm install -g @ductus/adapter-dart
```

y añade el paquete Dart [`ductus`](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) (anotaciones + extractor) como dependencia en tu proyecto Flutter.

Para proyectos TypeScript/JavaScript (p. ej. React con react-router o Next.js), esto es todo lo que necesitas:

```bash
npm install -g @ductus/core @ductus/adapter-typescript
```

No se requiere ningún SDK ni dependencia adicional en el proyecto de destino — el [adaptador de TypeScript](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) analiza las fuentes por sí mismo (solo parseo, Node puro).

## Inicio rápido

```bash
cd my_project                        # proyecto Flutter o TS/JS

ductus init                          # detecta pubspec.yaml o package.json, crea ductus.config.yaml
ductus extract                       # → journey-graph.json + ductus-report.json

export DUCTUS_LLM_API_KEY=sk-…       # tu propia clave de Anthropic/OpenAI (BYOK)
ductus generate                      # → docs/*.mdx (o un sitio web, según la configuración)

ductus graph --open                  # inspecciona el grafo como HTML en el navegador
ductus check                         # puerta de CI: validación + faithfulness, sin costes de LLM
```

## Referencia de la CLI

Opciones globales (antes o después del comando):

| Opción | Descripción |
|---|---|
| `-c, --config <path>` | Ruta al `ductus.config.yaml` (por defecto: `./ductus.config.yaml`) |
| `--offline` | Sin acceso a la red: `extract`/`check`/`graph` funcionan sin restricciones (los adaptadores trabajan en local), `generate` solo con `llm.provider: mock` |

Comandos:

| Comando | Opciones | Descripción |
|---|---|---|
| `ductus init` | `--force` | Crea un `ductus.config.yaml` comentado. Detecta `pubspec.yaml` (`app.name`, `go_router`/`auto_route` ⇒ `deriveFrom`) o `package.json` (`app.name`, `react-router`/`react-router-dom`/`next` ⇒ `deriveFrom`); `pubspec.yaml` tiene prioridad si existen ambos. Solo sobrescribe una configuración existente con `--force`. |
| `ductus extract` | — | Ejecuta todos los adaptadores, fusiona y valida el grafo. Escribe `journey-graph.json` y `ductus-report.json` junto a la configuración. Utilizable sin LLM. |
| `ductus generate` | `--build` | Extracción + generación con LLM → MDX o sitio web. `--build` construye además el sitio web tras la exportación (`npm ci`/`install` + `npm run build` en el directorio del sitio; solo con `output.format: website`, no combinable con `--offline`). |
| `ductus check` | — | Validación + faithfulness desde la caché de segmentos — no escribe archivos ni llama a ningún LLM (listo para CI). Los segmentos aún no generados se notifican, pero no son un error. |
| `ductus graph` | `--open`, `--out <path>`, `--journey` | Imprime el grafo como flowchart de Mermaid en stdout. `--journey` imprime en su lugar los diagramas de journey de los caminos principales de los flows. `--out` escribe en un archivo. `--open` escribe `.ductus/graph.html` (flowchart **y** journeys) y lo abre en el navegador. |
| `ductus help [command]` | — | Sin argumento imprime una visión general completa de la CLI (flujo de trabajo, comandos, códigos de salida, configuración); con un argumento muestra la ayuda de ese comando concreto. |

## Configuración: `ductus.config.yaml`

`ductus init` genera exactamente esta plantilla (con valores prellenados a partir del `pubspec.yaml` o del `package.json`):

```yaml
# Configuración de Ductus
app:
  name: MyApp
  locale: en

adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]

llm:
  provider: anthropic        # anthropic | openai | mistral | custom | mock
  model: claude-sonnet-4-5
  apiKeyEnv: DUCTUS_LLM_API_KEY
  temperature: 0.2
  faithfulnessCheck: true

style:
  voice: en-you              # formal-sie | informal-du | en-you
  granularity: flow          # flow | screen

output:
  format: mdx                # mdx | website
  dir: docs/
  website:
    generator: journey       # journey | starlight | docusaurus
    diagrams: true
```

`app.locale` (por defecto: `en`) es el idioma de la documentación generada
para usuarios finales. `style.voice` (por defecto: `en-you`) define su tono:
`en-you` se dirige al lector con el «you» natural del inglés; `formal-sie`
e `informal-du` siguen estando plenamente soportados para documentación de
usuario final en alemán (el «Sie» formal y el «du» informal,
respectivamente).

En proyectos TypeScript/JavaScript, la sección `adapters:` tiene en cambio este aspecto:

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

Otras claves opcionales (con valores por defecto cuando corresponde):

| Clave | Descripción |
|---|---|
| `app.platforms` | Lista de plataformas de destino (puramente informativa, acaba en los metadatos del grafo) |
| `adapters[].project` | Directorio del proyecto relativo a la configuración (por defecto: `.`) |
| `adapters[].command` | Sobrescribe explícitamente el comando del adaptador |
| `adapters[].extra` | Opciones adicionales que se pasan 1:1 al adaptador (p. ej. los globs `include` de los adaptadores de Dart y TypeScript; las claves desconocidas colocadas directamente en la entrada del adaptador también acaban ahí) |
| `llm.maxTokens` | Máximo de tokens de salida por llamada al LLM (por defecto: `2048`) |
| `llm.baseUrl` | URL base del endpoint — **obligatoria** con `provider: custom` |
| `llm.faithfulnessThreshold` | Total de violaciones de faithfulness permitidas; por encima, exit 2 (por defecto: `0`) |
| `llm.pricing.inputPerMTokUsd` / `llm.pricing.outputPerMTokUsd` | USD por 1M de tokens — solo con estos valores convierte Ductus la estimación a USD |
| `output.website.template` | Directorio de plantilla propio en lugar del incluido |

Las claves de nivel superior desconocidas solo producen advertencias (compatibilidad hacia delante).

## Modos de salida

### `format: mdx`

Escribe en `output.dir` una página MDX con frontmatter YAML por segmento
(flow o pantalla, según `style.granularity`). Con `diagrams: true`, cada
página de flow contiene el flow como `flowchart` de Mermaid y — en cuanto
el camino principal derivado tiene al menos dos nodos — adicionalmente el
camino principal como diagrama `journey`. Las violaciones de faithfulness
aparecen como una caja de advertencia visible en la parte superior de la
página. La salida es estable a nivel de bytes — ideal para versionarla y
hacer diffs.

### `format: website`

Genera el andamiaje de un sitio web Astro completo en `output.dir`
(después: `npm install`, `npm run dev` o `npm run build` — o directamente
`ductus generate --build`).

| Generador | Descripción |
|---|---|
| `journey` *(por defecto)* | Sitio interactivo de journeys construido a partir de `ductus.data.json`: grafo de journeys clicable con disposición determinista, «Play path», búsqueda con ⌘K/Ctrl+K en journeys/pasos/acciones, lista de pasos + guía detallada escrita por el LLM para cada journey. La interfaz del sitio sigue `app.locale` (inglés por defecto, interfaz en alemán para `de`). [Ver plantilla](https://github.com/PlaxXOnline/ductus/tree/main/templates/journey) |
| `starlight` | Sitio de documentación clásico basado en Astro/Starlight; las páginas MDX generadas van a `src/content/docs/`, los diagramas de Mermaid se renderizan en el navegador. [Ver plantilla](https://github.com/PlaxXOnline/ductus/tree/main/templates/starlight) |
| `docusaurus` | Aún no incluido — `generate` aborta con un mensaje claro; usa `journey` o `starlight`. |

## LLM: BYOK, costes, caché, faithfulness

**Bring Your Own Key.** La clave de API proviene de la variable de entorno
indicada por `llm.apiKeyEnv` (por defecto: `DUCTUS_LLM_API_KEY`) y nunca
aparece en ninguna salida ni en ningún mensaje de error.

| Proveedor | Notas |
|---|---|
| `anthropic` | Anthropic Messages API; clave obligatoria |
| `openai` | OpenAI Chat Completions; clave obligatoria |
| `mistral` | Mistral Chat Completions (compatible con OpenAI, api.mistral.ai); clave obligatoria — establece `model` explícitamente, p. ej. `mistral-large-latest` |
| `custom` | Cualquier endpoint compatible con OpenAI mediante `llm.baseUrl` (p. ej. modelos locales) — sin clave configurada no se envía ninguna cabecera Authorization |
| `mock` | Determinista, sin red — para tests, CI y `--offline` |

**Estimación de costes antes de la ejecución.** Antes de la primera llamada
al proveedor, `generate` imprime una estimación (segmentos, tokens de
entrada/salida y, con `llm.pricing`, también USD). La heurística asume
~4 caracteres por token; las cifras reales aparecen tras la ejecución en la
salida y en `ductus-report.json`.

**Caché de segmentos.** Los resultados se guardan en `.ductus/cache`,
indexados por contenido del segmento, versión del prompt, modelo y estilo
(`voice`/`locale`). Los segmentos sin cambios no generan costes de LLM en
ejecuciones posteriores; `generate` informa de aciertos y regeneraciones.

**Comprobación de faithfulness.** Dos capas protegen el texto generado —
las afirmaciones del LLM nunca se aceptan sin verificar:

1. **Comprobación determinista de vocabulario** (siempre activa, sin LLM):
   todos los términos en `**negrita**` marcados como elementos de UI en las
   líneas de pasos se cotejan con el vocabulario del segmento del grafo
   (títulos de nodos, etiquetas de aristas, condiciones, nombre de la app).
   Un elemento de UI inventado se detecta con garantía — independientemente
   del modelo y del judge.
2. **Faithfulness judge** (`llm.faithfulnessCheck: true`, por defecto): una
   segunda llamada al LLM busca desviaciones semánticas. No se confía en el
   judge — se le verifica: cada hallazgo debe citar textualmente el pasaje
   infractor y nombrar el elemento supuestamente ausente; el código
   comprueba ambas cosas de forma mecánica. Los hallazgos refutados (la
   cita no aparece en el texto, o el elemento sí está en el grafo) se
   descartan; los casos límite se conservan como **pistas** (`hints`) —
   solo los hallazgos confirmados cuentan como violaciones. Con
   `anthropic`, `openai` y `mistral`, la salida estructurada (tool use o
   `json_schema`) impone además JSON válido del lado de la API.

Las violaciones se escriben en la salida como una caja de advertencia y se
listan en el informe; las pistas aparecen allí por separado y **no** cuentan
para el umbral. Si el número de violaciones supera
`llm.faithfulnessThreshold` (por defecto: `0`), la ejecución termina con el
código de salida 2 — la salida se escribe igualmente para que puedas
inspeccionar los pasajes señalados.

## Códigos de salida

| Código | Significado |
|---|---|
| `0` | Éxito |
| `1` | Error de validación en el grafo o conflicto de fusión entre las salidas de varios adaptadores (detalles línea a línea en stderr) |
| `2` | Violaciones de faithfulness por encima del umbral |
| `3` | Error de configuración, de LLM, de adaptador o de construcción del sitio web (incluidos errores de uso como `--build` + `--offline`) |

## Receta para CI: `ductus check` sin costes de LLM

`ductus check` ejecuta los adaptadores, valida el grafo y lee los
resultados de faithfulness exclusivamente desde la caché de segmentos — sin
llamadas al LLM y sin necesidad de clave de API. Para que la parte de
faithfulness surta efecto en CI, versiona el directorio `.ductus/cache` en
el repositorio (proviene de tu último `ductus generate` local).

```yaml
# GitHub Actions (extracto)
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - uses: subosito/flutter-action@v2   # el adaptador de Dart necesita el SDK de Dart/Flutter
  - run: npm install -g @ductus/core @ductus/adapter-dart
  - run: flutter pub get
  - run: ductus check                  # exit 1 = grafo roto, exit 2 = faithfulness
```

Para proyectos TypeScript/JavaScript desaparece la línea del SDK — el
adaptador de TypeScript es Node puro y no requiere ningún SDK adicional:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm install -g @ductus/core @ductus/adapter-typescript
  - run: ductus check
```

## Nota: Mermaid y CDN

La página HTML que produce `ductus graph --open` carga Mermaid desde un CDN
al abrirse (jsdelivr, mermaid@11) — por lo que renderizarla en el navegador
necesita acceso a la red una vez. Lo mismo aplica al renderizado de
diagramas del sitio web de Starlight; sin conexión, el código fuente del
diagrama sigue siendo legible como bloque de código. `--offline` en sí solo
afecta a `generate` (permitido únicamente con `llm.provider: mock`, no
combinable con `--build`).

## Ecosistema

| Paquete | Descripción |
|---|---|
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) | Wrapper de npm que hace invocable la CLI del adaptador de Dart |
| [`@ductus/adapter-typescript`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) | Adaptador de TypeScript/JavaScript: comentarios `@journey:` + derivación desde react-router/Next.js |
| [`ductus` (Dart)](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | Paquete de pub.dev: anotaciones, extractor y builder de build_runner para Flutter/Dart |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | JSON Schema y tipos de TypeScript del journey graph |

Más en el [repositorio de Ductus](https://github.com/PlaxXOnline/ductus):
[proyectos de ejemplo](https://github.com/PlaxXOnline/ductus/tree/main/examples) ·
[buenas prácticas](https://github.com/PlaxXOnline/ductus#best-practices) (calidad del grafo, flujo de trabajo, LLM y costes).

## Licencia

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/LICENSE)
