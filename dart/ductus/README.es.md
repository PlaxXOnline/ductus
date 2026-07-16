# ductus

[English](./README.md) | [Deutsch](./README.de.md) | **Español** | [简体中文](./README.zh-CN.md)

**Documentación para usuarios finales directamente desde tu código Flutter.**
`ductus` proporciona anotaciones de journey y una CLI de adaptador que extraen
un grafo de user journey de tu app — la
[CLI de Ductus (`@ductus/core`)](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
lo convierte en documentación mantenida por LLM en forma de archivos MDX o un
sitio web estático, versionada junto con tu código.

- **Cuatro vías de entrada, libremente combinables:** comentarios `@journey:`
  (sin build), anotaciones de Dart, derivación automática desde
  `go_router`/`auto_route`, builder de build_runner.
- **Coste cero en tiempo de ejecución:** Las anotaciones son marcadores
  puros — sin comportamiento en tiempo de ejecución, sin código adicional en
  el binario de tu app.
- **Sin build necesario:** El adaptador analiza en modo parse-only; el
  proyecto de destino no necesita ni `pub get` ni un build.
- **Determinista:** La salida es JSON canónico y estable en diffs — ideal
  para la revisión de código y CI.

## Instalación

Para anotaciones en el código de tu app (`@JourneyScreen` y compañía en
`lib/`):

```bash
dart pub add ductus
```

Solo la CLI del adaptador, sin anotaciones en el código:

```bash
dart pub add dev:ductus
```

Completamente sin dependencia en el proyecto (convención de comentarios, ver
más abajo):

```bash
dart pub global activate ductus
```

## Inicio rápido: anotar → extraer → generar

```dart
import 'package:ductus/ductus.dart';

@JourneyScreen(
  id: 'login',
  title: 'Sign in',
  flow: 'auth',
  description: 'Screen where the user signs in.',
)
class LoginScreen extends StatelessWidget {
  @JourneyAction(
    label: 'Sign in',
    to: 'dashboard',
    trigger: JourneyTrigger.submit,
    condition: 'credentials valid',
  )
  void onSubmit() { /* … */ }
}

@JourneyFlow(id: 'auth', title: 'Login & registration', start: 'login')
class AuthFlow {}
```

Después, con la CLI de Ductus (Node.js ≥ 20):

```bash
npm install -g @ductus/core @ductus/adapter-dart

ductus init        # crea ductus.config.yaml, detecta pubspec.yaml + router
ductus extract     # construye y valida el grafo → journey-graph.json
ductus generate    # docs vía LLM (BYOK) → docs/*.mdx o un sitio web estático
```

Para `generate` basta con tu propia clave de API (Anthropic, OpenAI o un
endpoint compatible) en la variable de entorno `DUCTUS_LLM_API_KEY`;
`extract` funciona completamente offline. Para probarlo sin clave:
`llm.provider: mock` en `ductus.config.yaml`.

Ejemplos ejecutables:
[flutter_go_router_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_go_router_demo)
(derivación + anotaciones) y
[flutter_comment_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_comment_demo)
(solo comentarios, sin dependencia).

## La API de anotaciones

Todas las anotaciones provienen de `package:ductus/ductus.dart`:

| Anotación | Parámetros (obligatorios en **negrita**) | Efecto en el grafo |
|---|---|---|
| `@JourneyScreen` | **`id`**, **`title`**, `flow`, `description`, `tags` | Nodo de pantalla; en clases |
| `@JourneyAction` | **`label`**, **`to`**, `from`, `id`, `trigger`, `condition` | Transición (arista); en métodos, funciones y campos |
| `@JourneyDecision` | **`id`**, **`title`**, `flow`, `description`, `tags` | Nodo de decisión (punto de bifurcación) |
| `@JourneyFlow` | **`id`**, **`title`**, **`start`**, `description` | Flow con nombre; `start` debe ser el id de una pantalla |

- `trigger` es un `JourneyTrigger`: `tap` (predeterminado), `submit`, `auto`,
  `back`, `deeplink`, `system`.
- Si falta `from` en una `@JourneyAction`, se usa la clase contenedora
  conocida como pantalla.
- Sin un `id` de acción, se genera `e_<from>_<to>` de forma determinista.
- Los argumentos son literales de cadena; si necesitas referencias a
  constantes como `title: MyConstants.title`, usa el builder de build_runner
  (más abajo).

## Sin build: la convención de comentarios `@journey:`

Equivalente a las anotaciones, funciona en comentarios `//` y `///` — el
proyecto entonces ni siquiera necesita `ductus` como dependencia:

```dart
// @journey:screen id="dashboard" title="Overview"
//   description="Central overview after signing in."
class DashboardScreen { … }
```

Un bloque comienza con `@journey:<screen|action|decision|flow>`, los pares
son `key="value"` (`\"` escapa una comilla), la continuación va en las líneas
de comentario inmediatamente siguientes; termina en la primera línea que no
es comentario o en el siguiente bloque `@journey:`. Los campos obligatorios
son los mismos que en las anotaciones; las claves desconocidas se ignoran con
una advertencia, `tags` se separa por comas.

Configuración completamente sin dependencia en el proyecto:

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

La CLI de Ductus encuentra el adaptador activado globalmente mediante
`dart pub global run`; como alternativa, la variable de entorno
`DUCTUS_DART_ADAPTER_DIR` apunta a un directorio que contiene el paquete del
adaptador.

## Derivación automática desde go_router / auto_route

Incluso sin una sola anotación ya obtienes un grafo utilizable:

| Fuente | se convierte en |
|---|---|
| `GoRoute` | Nodo de pantalla |
| `ShellRoute` | Flow |
| `redirect:` | Nodo de decisión |
| `context.go()` / `push()` / `goNamed()` / … con un literal de cadena | Transición |
| Clases `@RoutePage()` (auto_route) | Nodo de pantalla |

Los elementos derivados llevan `source: "derived"`; las anotaciones manuales
con el mismo id sobrescriben los valores derivados campo por campo. Dos
fuentes manuales con valores en conflicto son un error que reporta ambas
ubicaciones de origen. Los ids derivados son el `name` de la ruta o el slug
del path (`/users/:id/edit` ⇒ `users-edit`).

La derivación de `auto_route` es explícitamente **best effort**: solo se
reconocen las pantallas `@RoutePage()` y la tabla de paths, sin aristas de
navegación — las transiciones las añades mediante `@JourneyAction` o
`@journey:action`.

Qué derivaciones se ejecutan lo controla `deriveFrom` (predeterminado:
ambas) — en `ductus.config.yaml` bajo `adapters:` o como JSON `--config` de
la CLI del adaptador.

## El builder de build_runner

Para proyectos que de todos modos ejecutan `build_runner`: el builder
`ductus:journey_builder` se ejecuta como paso de build y escribe el grafo
como `ductus_builder.g.json` en la raíz del proyecto. Su valor añadido es la
**resolución**: los argumentos de anotación constantes no literales
(p. ej. `title: MyConstants.title`) se resuelven a través del AST resuelto en
lugar de rechazarse como error/advertencia.

```bash
dart pub add ductus dev:build_runner
dart run build_runner build
# → ductus_builder.g.json en la raíz del proyecto
```

El builder se activa automáticamente mediante `auto_apply: dependents`; el
proyecto solo necesita su propio `build.yaml` para las opciones — se admiten
`deriveFrom` e `include`, con los mismos valores predeterminados que la CLI
del adaptador:

```yaml
targets:
  $default:
    builders:
      ductus:journey_builder:
        options:
          deriveFrom: [go_router]
          include: [lib/**]
```

El artefacto entra en el pipeline con `--from-builder` — la CLI del adaptador
entonces solo comprueba la `schemaVersion` y pasa el archivo tal cual; no se
realiza ningún escaneo propio:

```bash
dart run ductus:adapter --project . --from-builder
```

o en `ductus.config.yaml`:

```yaml
adapters:
  - dart:
      project: .
      fromBuilder: true
```

Aspectos a tener en cuenta:

- `ductus_builder.g.json` solo está tan actualizado como la última ejecución
  de build_runner — así que ejecuta `dart run build_runner build` antes de
  `ductus extract` (o mantén `watch` en marcha). Si falta el archivo,
  `--from-builder` aborta con una indicación.
- El builder solo ve los archivos incluidos en las fuentes del target de
  build_runner (por defecto se incluye `lib/`); los patrones `include` fuera
  de ese ámbito producen una advertencia sin coincidencias — en ese caso
  amplía `targets.$default.sources` o usa la CLI del adaptador.
- Con anotaciones puramente literales, el resultado es idéntico a nivel de
  bytes al de la CLI del adaptador — salvo por el nombre en `meta.adapters`
  (`dart-builder` en lugar de `dart`).
- `ductus_builder.g.json` debe ir en `.gitignore` (artefacto de build) — no
  confundir con `ductus_graph.g.json`, el archivo de depuración de la CLI
  adaptadora.

## La CLI del adaptador

```
dart run ductus:adapter --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

| Opción | Significado |
|---|---|
| `--project <dir>` | Directorio del proyecto (obligatorio) |
| `--config <file>` | Archivo de configuración JSON, p. ej. `{"deriveFrom": ["go_router"], "include": ["lib/**"]}` (predeterminados: ambas derivaciones activas, `lib/**`) |
| `--no-debug-file` | Suprime el archivo de depuración `ductus_graph.g.json` en el directorio del proyecto |
| `--from-builder` | Pasa `ductus_builder.g.json` tal cual en lugar de escanear por sí misma (equivalente: clave de configuración `"fromBuilder": true`; el flag tiene prioridad) |

Comportamiento: stdout es exactamente un JSON de grafo canónico
(determinista, estable en diffs), las advertencias e indicaciones van a
stderr; exit 0 en caso de éxito, distinto de cero en caso de error. El
análisis es parse-only — el proyecto de destino no necesita ni `pub get` ni un
build; solo `--from-builder` requiere una ejecución previa de build_runner.

Importante para las vías parse-only (comentarios, anotaciones, derivación):
los campos obligatorios (`id`, `title`, `label`, `to`, `start`) y un `from`
explícito deben ser literales de cadena — de lo contrario, el adaptador
aborta con un error. Los campos opcionales que no pueden leerse literalmente
se descartan con una advertencia; un `trigger` ilegible recurre a `tap` con
una advertencia. Las llamadas de navegación solo se reconocen como candidatas
a transición con un argumento literal de cadena (`context.go('/settings')`).

## Trabajar con la CLI de Ductus

El lado Node orquesta el adaptador y convierte el grafo en documentación:

| Comando (`@ductus/core`) | Propósito |
|---|---|
| `ductus init` | Crea `ductus.config.yaml`; detecta `pubspec.yaml` (nombre de la app, go_router/auto_route) |
| `ductus extract` | Ejecuta el adaptador de Dart, valida y escribe `journey-graph.json` |
| `ductus generate` | Genera archivos MDX o un sitio web estático vía LLM (BYOK); incluye la comprobación de faithfulness |
| `ductus check` | Comprueba la validez del grafo y el faithfulness sin escribir archivos (CI) |
| `ductus graph` | Imprime el grafo como Mermaid; `--open` lo renderiza como HTML en el navegador |
| `ductus help [command]` | Imprime un resumen de la CLI o la ayuda de un comando concreto |

La documentación generada usa inglés de forma predeterminada
(`app.locale: en`, con la `voice` `en-you`); para documentación de usuario
final en alemán, establece `style.voice` en `formal-sie` o `informal-du`.

Más información en el
[README del repositorio](https://github.com/PlaxXOnline/ductus) y en la
[documentación de `@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Licencia

MIT — consulta [LICENSE](https://github.com/PlaxXOnline/ductus/blob/main/dart/ductus/LICENSE).
