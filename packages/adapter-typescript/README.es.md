# @ductus/adapter-typescript

[English](./README.md) | [Deutsch](./README.de.md) | **Español** | [简体中文](./README.zh-CN.md)

**Documentación para usuarios finales directamente desde tu código TypeScript/JavaScript.**
El adaptador de Ductus para proyectos TS/JS extrae un grafo de user journey
a partir de comentarios `@journey:` y de configuraciones de
react-router/Next.js — la
[CLI de Ductus (`@ductus/core`)](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
lo convierte en documentación pulida mediante LLM (BYOK), como archivos MDX
o como sitio web estático, versionada junto a tu código.

- **Sin build y sin dependencias en el proyecto de destino:** el adaptador
  analiza las fuentes mediante la API del compilador de TypeScript (solo
  parseo) — sin `npm install` en el proyecto de destino, sin build, sin
  necesidad de tsconfig.
- **Dos vías de entrada, combinables libremente:** comentarios `@journey:`
  (vía A, sintaxis idéntica a la del adaptador de Dart) y derivación
  automática desde react-router o Next.js (vía C).
- **TS y JS, con y sin JSX:** escanea `.ts`, `.tsx`, `.mts`, `.cts`,
  `.js`, `.jsx`, `.mjs`, `.cjs`.
- **Determinista:** la salida es JSON canónico y estable a nivel de bytes —
  ideal para la revisión de código y CI.

## Instalación

Requisito previo: Node.js ≥ 20 — nada más, el adaptador se ejecuta
íntegramente en Node.

```bash
# en el proyecto (recomendado, versionado con el proyecto)
npm install --save-dev @ductus/core @ductus/adapter-typescript

# o de forma global, sin ninguna entrada en el proyecto de destino
npm install -g @ductus/core @ductus/adapter-typescript
```

## Inicio rápido con @ductus/core

```bash
npx ductus init       # detecta package.json, crea ductus.config.yaml
npx ductus extract    # invoca el adaptador → journey-graph.json
npx ductus generate   # LLM (BYOK) → docs para usuarios finales como MDX o sitio web
```

`npx ductus help <comando>` muestra las opciones de cada comando. La
sección relevante de `ductus.config.yaml` (tal como la genera
`ductus init`):

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

`ductus init` lee el `package.json`: `app.name` se convierte en el nombre
del paquete, y `deriveFrom` enumera los routers encontrados en
`dependencies` o `devDependencies` (`react-router`/`react-router-dom`
⇒ `react-router`, `next` ⇒ `next`); si no se encuentra ninguno, se
mantiene el valor por defecto `[react-router, next]`. Si existe un
`pubspec.yaml` en el mismo directorio, este tiene prioridad — los
proyectos Flutter a menudo incluyen un `package.json` para herramientas.

Más sobre configuración, proveedores de LLM y formatos de salida en el
README de
[`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Sin build: la convención de comentarios `@journey:`

La vía de entrada manual (vía A) — sintaxis y semántica idénticas a las
del
[adaptador de Dart](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus),
funciona en comentarios de línea `//`:

```tsx
// @journey:flow id="auth" title="Sign-in" start="login"

// @journey:screen id="login" title="Sign-in" flow="auth"
//   description="Screen where the user signs in."
export function LoginPage() {
  // @journey:action label="Sign in" to="dashboard" trigger="submit"
  //   condition="credentials valid"
  const onSubmit = () => { /* … */ };
  return /* … */;
}
```

Un bloque comienza con `@journey:<screen|action|decision|flow>`, los pares
son `key="value"` (`\"` escapa una comilla), la continuación va en las
líneas de comentario inmediatamente siguientes; termina en la primera
línea que no es comentario o en el siguiente bloque `@journey:`. Las
claves y triggers desconocidos se ignoran con una advertencia (un `trigger`
desconocido recurre a `tap`); los campos obligatorios ausentes abortan la
ejecución con un error. `tags` se separa por comas.

| Bloque | Claves (obligatorias en **negrita**) | Efecto en el grafo |
|---|---|---|
| `@journey:screen` | **`id`**, **`title`**, `flow`, `description`, `tags` | Nodo de pantalla |
| `@journey:action` | **`label`**, **`to`**, `from`, `id`, `trigger`, `condition` | Transición (arista) |
| `@journey:decision` | **`id`**, **`title`**, `flow`, `description`, `tags` | Nodo de decisión (punto de bifurcación) |
| `@journey:flow` | **`id`**, **`title`**, **`start`**, `description` | Flow con nombre; `start` debe ser el id de una pantalla |

- `trigger` es uno de `tap` (por defecto), `submit`, `auto`, `back`,
  `deeplink`, `system`.
- **Vinculación con el componente:** los bloques `screen`/`decision` se
  vinculan al componente que los envuelve o al inmediatamente siguiente —
  una clase de nivel superior, una declaración de función o un `const`
  con un inicializador de función, incluidos los wrappers
  `memo(…)`/`forwardRef(…)`.
- Si un `@journey:action` no tiene `from`, se aplica el componente
  envolvente que sea una pantalla conocida (vía `@journey:screen` o por
  derivación); si de esa forma no puede determinarse ninguna pantalla, la
  ejecución aborta con un error.
- Sin un `id` de acción, se genera `e_<from>_<to>` de forma determinista.

Las anotaciones tipadas y un builder (vías B y D del adaptador de Dart)
están ausentes aquí deliberadamente — TypeScript no los necesita, la vía A
es la vía manual y se mantiene libre de cualquier dependencia en el
proyecto de destino.

## Derivación automática desde react-router / Next.js

Incluso sin una sola anotación ya obtienes un grafo útil (vía C). Qué
derivaciones se ejecutan lo controla `deriveFrom` (por defecto: ambas).

### `react-router`

Se reconocen las rutas de objeto de `createBrowserRouter`,
`createHashRouter`, `createMemoryRouter` y `useRoutes` — como array
inline o como constante de rutas en el mismo archivo (`const routes = […];
createBrowserRouter(routes)`) — así como el JSX `<Route>` (que también
cubre `createRoutesFromElements`):

| Fuente | se convierte en |
|---|---|
| Ruta con path | Nodo de pantalla |
| Ruta de layout sin path con hijos | Flow `shell-N` (`start` = primera pantalla hija) |
| `loader` (inline o declarado en el mismo archivo) que llama a `redirect('…')` | Nodo de decisión `<screen>_redirect` con aristas `auto` |
| `<Link to>` / `<NavLink to>` | Transición (`tap`; `label` = único hijo de texto) |
| `<Navigate to>` | Transición (`auto`) |
| `navigate('…')` — solo en archivos que usan `useNavigate` | Transición (`tap`) |

Los paths anidados se unen de forma absoluta (`path: 'detail'` bajo
`/users` ⇒ `/users/detail`). `element={<X />}` o `Component={X}` asocia
el componente con la pantalla — un wrapper único como `<Suspense>` se
atraviesa; esta asociación es la manera en que el adaptador encuentra el
`from` de las aristas de navegación.

### `next`

Enrutamiento basado en archivos, App Router y Pages Router (cada uno
también bajo `src/`):

| Fuente | se convierte en |
|---|---|
| App Router: `app/**/page.*` | Nodo de pantalla |
| Grupo de rutas `(name)/` | Flow `name` (`start` = primera página del grupo) |
| Pages Router: `pages/**` (excluyendo `_app`/`_document`/`_error` y `api/`) | Nodo de pantalla |
| `redirect('…')` / `permanentRedirect('…')` en un archivo de página con un import de `next/navigation` | Nodo de decisión `<screen>_redirect` con aristas `auto` |
| `<Link href>` | Transición (`tap`; `label` = único hijo de texto) |
| `router.push('…')` / `router.replace('…')` — solo en archivos que usan `useRouter` | Transición (`tap`) |

Las parallel routes `@slot`, las intercepting routes `(.)` y las carpetas
`_private` no son destinos independientes y se omiten.

Las pantallas del Pages Router solo se crean con **evidencia de Next**:
`next` en las `dependencies`/`devDependencies` del `package.json`, un
`next.config.*`, o un import de `next`/`next/…` en las fuentes
escaneadas. Sin evidencia, `(src/)pages/` permanece en silencio — el
nombre de la carpeta es una convención habitual también en proyectos
react-router y de lo contrario produciría pantallas fantasma. El App
Router (`app/**/page.*`) es inequívoco como convención y no necesita
evidencia.

### Ids derivados y notas

- El id de la pantalla es la propiedad `id:` de la ruta (react-router) o
  el slug del path: la `/` inicial se elimina, `/` → `-`, los segmentos
  de parámetro (`:id`, `[id]`) se eliminan, path vacío ⇒ `root` —
  `/users/:id/edit` ⇒ `users-edit`. El `title` es el id humanizado
  (`users-edit` ⇒ «Users edit»).
- Los nodos y aristas derivados llevan `source: "derived"` y un
  `sourceRef` que apunta al lugar donde se encontraron (los flows no
  tienen `source`/`sourceRef` en el esquema).
- Los destinos u orígenes irresolubles (el path no coincide con ninguna
  ruta conocida, el componente envolvente no es ninguna pantalla
  conocida) no son un error: el adaptador escribe una nota en stderr y
  descarta la arista.

## Reglas de fusión

Idénticas a las del adaptador de Dart: las entradas manuales `@journey:`
sobrescriben los valores derivados **campo por campo** — siempre que usen
**el mismo id** (los ids derivados están en `journey-graph.json` tras
`ductus extract`). Si dos fuentes **manuales** se contradicen, la
ejecución aborta fail-fast citando ambas ubicaciones. Las aristas sin id
explícito reciben `e_<from>_<to>` de forma determinista (en caso de
colisión `_2`, `_3`, …); la salida se ordena canónicamente y es estable a
nivel de bytes entre ejecuciones repetidas, `meta.adapters` contiene
`[{ "name": "typescript", "version": … }]`.

## La CLI del adaptador

Normalmente `ductus extract` arranca el adaptador automáticamente. De
forma manual:

```bash
ductus-adapter-typescript --project <dir> [--config <json-file>] [--no-debug-file]
```

| Opción | Significado |
|---|---|
| `--project <dir>` | Directorio del proyecto (obligatorio) |
| `--config <json-file>` | Archivo de configuración JSON (claves más abajo); `@ductus/core` lo genera automáticamente a partir de la entrada del adaptador en `ductus.config.yaml` |
| `--no-debug-file` | Suprime el archivo de depuración `ductus_graph.g.json` en el directorio del proyecto (por defecto: se escribe) |

Comportamiento: stdout es exactamente un JSON canónico del grafo, todos
los diagnósticos (advertencias, notas) van a stderr.

| Código de salida | Significado |
|---|---|
| `0` | Éxito |
| `64` | Error de uso (falta `--project`, opción desconocida) |
| `1` | Error del adaptador (campos obligatorios ausentes, `from` irresoluble, conflicto de fusión, configuración inválida) |

Claves del JSON de `--config` (se corresponden con la entrada del
adaptador en la sección `adapters:` de `ductus.config.yaml`):

| Clave | Por defecto | Significado |
|---|---|---|
| `deriveFrom` | `["react-router", "next"]` | Fuentes de derivación (vía C) |
| `include` | `["src/**", "app/**", "pages/**", "lib/**"]` | Patrones glob relativos al proyecto que se escanean |

Se escanean archivos con las extensiones `.ts`, `.tsx`, `.mts`, `.cts`,
`.js`, `.jsx`, `.mjs`, `.cjs`. `node_modules`, `dist`, `build`, `out`,
`coverage` y los directorios con punto (`.git`, `.next`, …) no se
escanean nunca — con independencia de los globs de `include`.

## Cómo encuentra @ductus/core el adaptador

`ductus extract` resuelve el comando para la entrada de adaptador
`typescript` en este orden:

| # | Fuente | Comportamiento |
|---|---|---|
| 1 | `command:` en la entrada del adaptador de `ductus.config.yaml` | Siempre gana — el comando configurado se ejecuta tal cual. |
| 2 | `node_modules/.bin` junto al `ductus.config.yaml` | El binario `ductus-adapter-typescript` de `npm install -D @ductus/adapter-typescript`. |
| 3 | `PATH` | El binario de `npm install -g @ductus/adapter-typescript`. |

Si ningún paso coincide, la llamada aborta con un mensaje de error que
nombra ambas opciones de instalación. A diferencia del adaptador de Dart, no
se requiere ninguna cadena de herramientas adicional — el adaptador se
ejecuta en el mismo Node que ejecuta `@ductus/core`.

## Limitaciones

- **Solo parseo significa: únicamente literales de cadena.** Los paths y
  destinos deben ser legibles de forma estática (`'…'`, `"…"` o un
  template literal sin interpolación) — los paths dinámicos como
  `` navigate(`/users/${id}`) `` no se reconocen, y las rutas sin un
  `path` literal se omiten con una nota.
- **`navigate(…)`/`router.push(…)` necesitan el contexto del hook:**
  `navigate('…')` solo se reconoce en archivos que usan `useNavigate`,
  `router.push`/`router.replace` solo en archivos con `useRouter` — así,
  las funciones libres con el mismo nombre no se capturan por error.
- **La resolución se detiene en el límite del archivo:** las constantes
  de rutas (`createBrowserRouter(routes)`) y las funciones `loader` solo
  se resuelven cuando están declaradas en el mismo archivo — los arrays
  de rutas o guards importados
  (`import { requireAuth } from './guards'`) pasan desapercibidos.
- **Los bloques `@journey:` solo funcionan en comentarios de línea
  `//`**, no en comentarios de bloque `/* … */`.
- **Sin Vue, Svelte ni Angular en esta versión:** `deriveFrom` conoce
  `react-router` y `next`. La vía A, en cambio, funciona de forma
  agnóstica al framework en cualquier proyecto TS/JS.

Los errores de sintaxis en archivos individuales no abortan la ejecución
— la API del compilador de TypeScript parsea con tolerancia a fallos, el
adaptador informa del archivo con una advertencia en stderr y continúa el
análisis en modo best effort.

## Enlaces

| Paquete | Descripción |
|---|---|
| [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) | CLI, orquestador, capa LLM (BYOK), salida MDX/sitio web |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | JSON Schema y tipos TypeScript del grafo de journey |
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) + [`ductus` (Dart)](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | La contraparte Dart/Flutter de este adaptador |
| [`react_router_demo`](https://github.com/PlaxXOnline/ductus/tree/main/examples/react_router_demo) | App de ejemplo ejecutable: derivación desde react-router + comentarios `@journey:` |

Más en el [repositorio de Ductus](https://github.com/PlaxXOnline/ductus).

## Licencia

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-typescript/LICENSE)
