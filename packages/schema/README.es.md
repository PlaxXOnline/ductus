# @ductus/schema

[English](./README.md) | [Deutsch](./README.de.md) | **Español** | [简体中文](./README.zh-CN.md)

El contrato detrás de [ductus](https://github.com/PlaxXOnline/ductus): tipos de TypeScript y JSON Schema (Draft 2020-12) para el grafo de journey (`journey-graph.json`) — la única superficie de contrato entre los adaptadores de lenguaje y el núcleo de Ductus.

Los adaptadores de lenguaje (p. ej. el [adaptador de Dart](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)) extraen un grafo en este formato a partir del código anotado de la app; el núcleo lo valida, lo fusiona y lo traduce en documentación para el usuario final. Si estás escribiendo tu propio adaptador o procesas `journey-graph.json` de forma programática, este paquete es exactamente lo que necesitas — nada más.

**¿Para quién es esto?** Autores de adaptadores personalizados y desarrolladores de herramientas que quieran leer, producir o validar el grafo. No necesitas este paquete solo para usar ductus — se incluye como dependencia de [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core).

## Instalación

```bash
npm install @ductus/schema
```

## El modelo de datos en 60 segundos

Un grafo de journey es un grafo dirigido del user journey de una app: pantallas, acciones y bifurcaciones como nodos, transiciones como aristas y subconjuntos temáticos como flows.

| Tipo | Significado | Campos obligatorios |
| --- | --- | --- |
| `JourneyGraph` | Documento de nivel superior | `schemaVersion`, `flows`, `nodes`, `edges` |
| `JourneyNode` | Pantalla, acción o decisión | `id`, `type`, `source`; `title` para `screen`/`decision`, `label` para `action` |
| `JourneyEdge` | Transición dirigida entre dos nodos | `id`, `from`, `to`, `source` |
| `JourneyFlow` | Subconjunto del grafo con nombre y punto de entrada | `id`, `title`, `start` |
| `SourceRef` | Referencia inversa al código fuente | `file` (opcionales `line`, `symbol`) |

Los campos más importantes en detalle:

- **`JourneyNode.type`** — `'screen' | 'action' | 'decision'`. Las pantallas y las decisiones llevan un `title`, las acciones un `label` (el JSON Schema lo exige). Opcionales: `description` (mejora notablemente la calidad del LLM), `flow`, `tags`, `sourceRef`.
- **`JourneyEdge`** — conecta `from` → `to` (ids de nodos). Opcionales: `trigger` (`'tap' | 'submit' | 'auto' | 'back' | 'deeplink' | 'system'`), `label` (rótulo de la transición) y `condition` (la condición bajo la cual se aplica la transición — importante, entre otras cosas, para que los ciclos tengan una condición de salida reconocible).
- **`JourneyFlow.start`** — id del nodo de entrada. Debe existir y ser de tipo `screen`; el núcleo lo comprueba durante la validación.
- **`source`** — en nodos y aristas: `'annotation'` (anotado explícitamente en el código) o `'derived'` (derivado por el adaptador, p. ej. de la configuración del router).
- **`SourceRef`** — localiza un elemento en el código fuente (`file`, opcionalmente `line` — con base 1 — y `symbol`) para que las afirmaciones de la documentación sigan siendo trazables hasta la ubicación en el código.

Se permiten campos adicionales desconocidos (`additionalProperties` permanece abierto): los adaptadores más nuevos pueden añadir campos sin romper a los consumidores más antiguos.

### Versionado: `schemaVersion`

`schemaVersion` tiene el formato `"major.minor"`. La regla es simple: **misma versión major ⇒ compatible** — las adiciones minor son retrocompatibles, los majors incompatibles son rechazados por el núcleo. El paquete exporta:

| Export | Valor/propósito |
| --- | --- |
| `SCHEMA_VERSION` | `'1.0'` — la versión que describe este paquete |
| `SUPPORTED_SCHEMA_MAJOR` | `1` — versión major soportada por el núcleo |
| `parseSchemaVersion(v)` | descompone `"major.minor"`; `null` para un formato inválido |
| `isSupportedSchemaVersion(v)` | `true` si la versión major coincide |

## Ejemplo mínimo válido

```json
{
  "schemaVersion": "1.0",
  "app": { "name": "Demo App" },
  "flows": [
    { "id": "login", "title": "Sign-in", "start": "login_screen" }
  ],
  "nodes": [
    {
      "id": "login_screen",
      "type": "screen",
      "title": "Login",
      "description": "Sign in with email and password.",
      "source": "annotation",
      "sourceRef": { "file": "lib/pages/login_page.dart", "line": 12 }
    },
    {
      "id": "submit_login",
      "type": "action",
      "label": "Sign in",
      "description": "Submits the credentials.",
      "source": "annotation"
    },
    {
      "id": "home_screen",
      "type": "screen",
      "title": "Home",
      "description": "Overview after a successful sign-in.",
      "source": "annotation"
    }
  ],
  "edges": [
    { "id": "e1", "from": "login_screen", "to": "submit_login", "trigger": "tap", "source": "annotation" },
    { "id": "e2", "from": "submit_login", "to": "home_screen", "trigger": "submit", "condition": "credentials valid", "source": "annotation" }
  ]
}
```

## Uso en TypeScript

Todos los tipos provienen del punto de entrada principal:

```ts
import type { JourneyGraph, JourneyNode, JourneyEdge, JourneyFlow, SourceRef } from '@ductus/schema';
import { SCHEMA_VERSION, SUPPORTED_SCHEMA_MAJOR, isSupportedSchemaVersion } from '@ductus/schema';
```

### Validación con Ajv

El JSON Schema está disponible en dos formas — como el export de TS `journeyGraphJsonSchema` y como archivo en bruto mediante el subpath export `@ductus/schema/journey-graph.schema.json`:

```ts
import { Ajv2020 } from 'ajv/dist/2020.js';
import { journeyGraphJsonSchema } from '@ductus/schema';
import type { JourneyGraph } from '@ductus/schema';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile<JourneyGraph>(journeyGraphJsonSchema);

const graph: unknown = JSON.parse(await readFile('journey-graph.json', 'utf8'));
if (!validate(graph)) {
  console.error(validate.errors);
}
```

El esquema usa Draft 2020-12 — por eso, con Ajv, usa `Ajv2020`. Para otros lenguajes/validadores, usa el archivo en bruto:

```ts
import schema from '@ductus/schema/journey-graph.schema.json' with { type: 'json' };
```

Nota: el JSON Schema cubre la **estructura**. Más allá de eso, el núcleo de Ductus comprueba reglas de integridad — p. ej. que no haya aristas hacia nodos inexistentes, ids únicos por colección, que `flow.start` exista y sea un `screen` — además de advertencias como nodos inalcanzables, `description` ausente o ciclos sin `condition`.

## Escribir tu propio adaptador

Un adaptador es cualquier programa que el núcleo lanza como subproceso. El protocolo:

1. **Invocación:** el núcleo llama al adaptador con `--project <absolute project path> --config <path to a temporary JSON file>`. El archivo de configuración contiene las claves específicas del adaptador provenientes de `ductus.config.yaml` (p. ej. `deriveFrom`).
2. **stdout:** únicamente el JSON del grafo — un único documento `JourneyGraph` que valide contra este esquema. No escribas nada más en stdout.
3. **stderr:** todos los diagnósticos (logs, advertencias). El núcleo lo reenvía tal cual, nunca lo silencia.
4. **Código de salida:** `0` en caso de éxito; cualquier otro código cuenta como error del adaptador.

El núcleo valida de inmediato la salida de stdout contra `journeyGraphJsonSchema` usando Ajv; una salida inválida aborta la ejecución con un mensaje de error preciso. El adaptador se conecta en `ductus.config.yaml` mediante la clave `command` de una entrada de adaptador.

Implementaciones de referencia y detalles en el repositorio:

- El runner de adaptadores del núcleo: [packages/core/src/adapters/runner.ts](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/src/adapters/runner.ts)
- El adaptador de Dart como modelo: [dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)
- El adaptador de TypeScript como segunda implementación de referencia: [packages/adapter-typescript](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) — usa este paquete directamente (`SCHEMA_VERSION`) y demuestra el protocolo en el mismo lenguaje que el núcleo.

## Los exports de un vistazo

| Export | Categoría | Descripción |
| --- | --- | --- |
| `JourneyGraph`, `JourneyNode`, `JourneyEdge`, `JourneyFlow`, `SourceRef`, `AppInfo`, `AdapterInfo`, `GraphMeta` | Tipos | Modelo de datos del grafo |
| `NodeType`, `TriggerType`, `SourceType` | Tipos | Tipos de unión de strings para `type`, `trigger`, `source` |
| `journeyGraphJsonSchema` | Constante | JSON Schema (Draft 2020-12) como objeto de TS |
| `SCHEMA_VERSION`, `SUPPORTED_SCHEMA_MAJOR` | Constantes | Constantes de versión |
| `parseSchemaVersion`, `isSupportedSchemaVersion` | Funciones | Análisis de versión y comprobación de compatibilidad |
| `@ductus/schema/journey-graph.schema.json` | Subpath export | Archivo JSON Schema en bruto |

## Licencia

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/schema/LICENSE) — parte del [monorepo de ductus](https://github.com/PlaxXOnline/ductus).
