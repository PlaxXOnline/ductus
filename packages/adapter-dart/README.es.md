# @ductus/adapter-dart

[English](./README.md) | [Deutsch](./README.de.md) | **Español** | [简体中文](./README.zh-CN.md)

El wrapper de npm que hace ejecutable el adaptador de Dart de Ductus para [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) — el análisis de código propiamente dicho vive en el paquete de pub.dev [`ductus`](https://pub.dev/packages/ductus) y se ejecuta en la cadena de herramientas de Dart.

Este paquete **no contiene lógica de análisis**. Solo proporciona el binario `ductus-adapter-dart`, que invoca `dart run ductus:adapter` con el contexto de paquete adecuado, reenvía stdout/stderr y el código de salida, y garantiza que **stdout es exactamente un documento JSON del grafo** (el preámbulo de pub, como `Resolving dependencies...`, se redirige a stderr; no se pierde nada).

**Requisito previo:** un [SDK de Dart](https://dart.dev/get-dart) instalado en el `PATH` (ya presente en proyectos Flutter). Node.js ≥ 20.

## Instalación

```bash
npm install --save-dev @ductus/core @ductus/adapter-dart
```

Además, `ductus:adapter` debe poder resolverse en el lado de Dart — basta con cualquiera de estas dos opciones:

```bash
# Opción 1: en el proyecto de destino (recomendado, versionado con el proyecto)
dart pub add dev:ductus

# Opción 2: de forma global, sin ninguna entrada en el proyecto de destino
dart pub global activate ductus
```

Si importas las anotaciones de Dart (vía B, ver más abajo) en `lib/`, añade `ductus` como dependencia normal en su lugar: `dart pub add ductus`.

## Inicio rápido con @ductus/core

```bash
npx ductus init       # crea ductus.config.yaml
npx ductus extract    # invoca el adaptador de Dart → journey-graph.json
npx ductus generate   # LLM (BYOK) → documentación para usuarios finales como MDX o sitio web
```

El fragmento relevante de `ductus.config.yaml` (tal como lo genera `ductus init`):

```yaml
adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]
```

Para más información sobre configuración, proveedores de LLM y formatos de salida, consulta el README de [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Cómo encuentra @ductus/core el adaptador

`ductus extract` resuelve el comando para la entrada de adaptador `dart` en este orden (implementado de forma idéntica en el runner de core y en este wrapper):

| # | Fuente | Comportamiento |
|---|--------|----------------|
| 1 | `command:` en la entrada del adaptador de `ductus.config.yaml` | Siempre gana — el comando configurado se ejecuta tal cual. |
| 2 | Binario `ductus-adapter-dart` (este paquete) | Se busca en `node_modules/.bin` junto a la configuración y después en el `PATH`. Internamente, el wrapper continúa la cadena con los pasos 3–5. |
| 3 | Variable de entorno `DUCTUS_DART_ADAPTER_DIR` | `dart run ductus:adapter` con este directorio como directorio de trabajo — útil cuando ni el proyecto ni pub-global conocen el paquete (p. ej., un checkout de monorepo). |
| 4 | El `pubspec.yaml` del proyecto de destino declara `ductus` | `dart run ductus:adapter` directamente en el proyecto de destino (`dependencies` o `dev_dependencies`). |
| 5 | Paquete activado globalmente (`dart pub global activate ductus`) | `dart pub global run ductus:adapter`; en una activación por ruta, `dart run` se ejecuta directamente en el directorio fuente. |

Si no aplica ningún paso, la invocación se aborta con un mensaje de error que enumera las opciones (`dart pub add dev:ductus`, `dart pub global activate ductus` o `DUCTUS_DART_ADAPTER_DIR`). Por tanto, el proyecto de destino **no** necesita ninguna dependencia de `ductus` mientras aplique alguno de los otros pasos.

## Qué fuentes entiende el adaptador

El adaptador de Dart combina cuatro vías de entrada en un solo grafo; las anotaciones manuales sobrescriben los valores derivados campo por campo:

| Vía | Fuente | ¿Dependencia en el proyecto de destino? |
|------|--------|-----------------------------------------|
| A | Convención de comentarios `@journey:screen`, `@journey:action`, `@journey:decision`, `@journey:flow` en comentarios `//`/`///` | Ninguna — completamente libre de build |
| B | Anotaciones de Dart `@JourneyScreen`, `@JourneyAction`, `@JourneyDecision`, `@JourneyFlow` | `ductus` (solo import, sin comportamiento en tiempo de ejecución) |
| C | Derivación automática desde `go_router` (`GoRoute` → pantallas, `ShellRoute` → flows, `redirect:` → decisiones, `context.go()/push()/…` → transiciones) y desde `auto_route` (`@RoutePage()` → pantallas, best effort) | Ninguna (solo el propio paquete del router) |
| D | Artefacto de build_runner `ductus_builder.g.json` — el builder del paquete `ductus` se ejecuta como paso de build y resuelve también constantes no literales; el adaptador reenvía el artefacto con `--from-builder` o con la clave de configuración `fromBuilder: true` | `ductus` + `build_runner` |

Detalles, ejemplos y buenas prácticas para las cuatro vías: [README del paquete `ductus`](https://pub.dev/packages/ductus). Dos aplicaciones de demostración ejecutables (solo la vía A, y las vías B+C combinadas) se encuentran en [examples/](https://github.com/PlaxXOnline/ductus/tree/main/examples).

## Invocación directa (opcional)

Normalmente `ductus extract` inicia el wrapper automáticamente. De forma manual:

```bash
ductus-adapter-dart --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

- `--project <dir>` (obligatorio): el proyecto Dart/Flutter que se va a analizar.
- `--config <json-file>`: configuración del adaptador como objeto JSON con las claves `deriveFrom` (por defecto `["go_router", "auto_route"]`), `include` (patrones glob relativos al proyecto, por defecto `["lib/**"]`) y `fromBuilder` (por defecto `false`). `@ductus/core` genera este archivo automáticamente a partir de la entrada del adaptador en `ductus.config.yaml`.
- `--no-debug-file`: suprime el archivo de depuración `ductus_graph.g.json` en el directorio del proyecto.
- `--from-builder`: reenvía el artefacto de build_runner `ductus_builder.g.json` en lugar de escanear por su cuenta (vía D; equivalente a la clave de configuración `fromBuilder: true`; el flag gana).

stdout es exactamente un JSON canónico del grafo; las advertencias y los diagnósticos van a stderr. El código de salida del adaptador de Dart se reenvía sin cambios.

## Enlaces

- [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) — CLI, orquestador, capa LLM (BYOK), salida MDX/sitio web
- [`ductus` en pub.dev](https://pub.dev/packages/ductus) — anotaciones, CLI del adaptador, builder de build_runner ([código fuente](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus))
- [Repositorio de Ductus](https://github.com/PlaxXOnline/ductus)

## Licencia

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-dart/LICENSE)
