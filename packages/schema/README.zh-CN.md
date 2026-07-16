# @ductus/schema

[English](./README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | **简体中文**

[ductus](https://github.com/PlaxXOnline/ductus) 背后的契约：为 journey graph（用户旅程图，`journey-graph.json`）提供的 TypeScript 类型与 JSON Schema（Draft 2020-12）——语言适配器与 Ductus 核心之间唯一的契约层。

语言适配器（例如 [Dart 适配器](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)）从带注解的应用代码中提取这种格式的图；核心负责校验、合并，并将其转换为面向最终用户的文档。如果你正在编写自己的适配器，或需要以编程方式处理 `journey-graph.json`，这个包正是你所需要的——除此之外别无其他。

**这个包适合谁？** 面向自定义适配器的作者，以及需要读取、生成或校验该图的工具开发者。仅仅使用 ductus 并不需要这个包——它会作为 [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) 的依赖随之安装。

## 安装

```bash
npm install @ductus/schema
```

## 60 秒了解数据模型

journey graph 是描述应用用户旅程的有向图：屏幕、操作和分支作为节点，转场作为边，主题子集作为 flow。

| 类型 | 含义 | 必填字段 |
| --- | --- | --- |
| `JourneyGraph` | 顶层文档 | `schemaVersion`、`flows`、`nodes`、`edges` |
| `JourneyNode` | 屏幕、操作或决策 | `id`、`type`、`source`；`screen`/`decision` 需要 `title`，`action` 需要 `label` |
| `JourneyEdge` | 两个节点之间的有向转场 | `id`、`from`、`to`、`source` |
| `JourneyFlow` | 图的带入口点的命名子集 | `id`、`title`、`start` |
| `SourceRef` | 指回源代码的反向引用 | `file`（可选 `line`、`symbol`） |

最重要的字段详解：

- **`JourneyNode.type`** — `'screen' | 'action' | 'decision'`。屏幕和决策带有 `title`，操作带有 `label`（JSON Schema 会强制执行这一点）。可选字段：`description`（能明显提升 LLM 输出质量）、`flow`、`tags`、`sourceRef`。
- **`JourneyEdge`** — 连接 `from` → `to`（节点 id）。可选字段：`trigger`（`'tap' | 'submit' | 'auto' | 'back' | 'deeplink' | 'system'`）、`label`（转场的说明文字），以及 `condition`（转场生效的条件——其重要性之一在于让循环具有可识别的退出条件）。
- **`JourneyFlow.start`** — 入口节点的 id。该节点必须存在且类型为 `screen`；核心会在校验时检查这一点。
- **`source`** — 位于节点和边上：`'annotation'`（在代码中显式注解）或 `'derived'`（由适配器推导得出，例如来自路由配置）。
- **`SourceRef`** — 定位源代码中的元素（`file`，可选的从 1 开始计数的 `line` 和 `symbol`），使文档中的表述能够一直追溯到具体的代码位置。

允许存在未知的额外字段（`additionalProperties` 保持开放）：较新的适配器可以添加字段，而不会破坏较旧的消费者。

### 版本管理：`schemaVersion`

`schemaVersion` 的格式为 `"major.minor"`。规则很简单：**主版本相同 ⇒ 兼容**——次版本的新增内容向后兼容，不兼容的主版本会被核心拒绝。该包导出：

| 导出 | 值/用途 |
| --- | --- |
| `SCHEMA_VERSION` | `'1.0'`——本包所描述的版本 |
| `SUPPORTED_SCHEMA_MAJOR` | `1`——核心支持的主版本 |
| `parseSchemaVersion(v)` | 拆分 `"major.minor"`，格式无效时返回 `null` |
| `isSupportedSchemaVersion(v)` | 主版本匹配时返回 `true` |

## 最小有效示例

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

## 在 TypeScript 中使用

所有类型都来自主入口点：

```ts
import type { JourneyGraph, JourneyNode, JourneyEdge, JourneyFlow, SourceRef } from '@ductus/schema';
import { SCHEMA_VERSION, SUPPORTED_SCHEMA_MAJOR, isSupportedSchemaVersion } from '@ductus/schema';
```

### 使用 Ajv 进行校验

JSON Schema 以两种形式提供——作为 TS 导出 `journeyGraphJsonSchema`，以及通过子路径导出 `@ductus/schema/journey-graph.schema.json` 提供的原始文件：

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

该 schema 使用 Draft 2020-12——因此在 Ajv 中请使用 `Ajv2020`。对于其他语言/校验器，请使用原始文件：

```ts
import schema from '@ductus/schema/journey-graph.schema.json' with { type: 'json' };
```

注意：JSON Schema 覆盖的是**结构**。除此之外，Ductus 核心还会检查完整性规则——例如不允许指向不存在节点的边、每个集合内 id 唯一、`flow.start` 存在且为 `screen`——并给出警告，例如不可达的节点、缺失的 `description`，或没有 `condition` 的循环。

## 编写你自己的适配器

适配器可以是任何由核心作为子进程启动的程序。协议如下：

1. **调用：** 核心以 `--project <absolute project path> --config <path to a temporary JSON file>` 调用适配器。该配置文件包含 `ductus.config.yaml` 中该适配器专属的键（例如 `deriveFrom`）。
2. **stdout：** 仅输出图的 JSON——一份能通过本 schema 校验的单个 `JourneyGraph` 文档。不要向 stdout 写入任何其他内容。
3. **stderr：** 所有诊断信息（日志、警告）。核心会原样透传，绝不吞掉。
4. **退出码：** 成功时为 `0`；任何其他退出码都视为适配器错误。

核心会立即使用 Ajv 依据 `journeyGraphJsonSchema` 校验 stdout 的输出；无效输出会使本次运行以精确的错误消息中止。适配器通过 `ductus.config.yaml` 中适配器条目的 `command` 键接入。

仓库中的参考实现与细节：

- 核心的适配器运行器：[packages/core/src/adapters/runner.ts](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/src/adapters/runner.ts)
- 作为蓝本的 Dart 适配器：[dart/ductus](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)
- 作为第二个参考实现的 TypeScript 适配器：[packages/adapter-typescript](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript)——它直接使用本包（`SCHEMA_VERSION`），并以与核心相同的语言演示该协议。

## 导出一览

| 导出 | 种类 | 说明 |
| --- | --- | --- |
| `JourneyGraph`、`JourneyNode`、`JourneyEdge`、`JourneyFlow`、`SourceRef`、`AppInfo`、`AdapterInfo`、`GraphMeta` | 类型 | 图的数据模型 |
| `NodeType`、`TriggerType`、`SourceType` | 类型 | 用于 `type`、`trigger`、`source` 的字符串联合类型 |
| `journeyGraphJsonSchema` | 常量 | 以 TS 对象形式提供的 JSON Schema（Draft 2020-12） |
| `SCHEMA_VERSION`、`SUPPORTED_SCHEMA_MAJOR` | 常量 | 版本常量 |
| `parseSchemaVersion`、`isSupportedSchemaVersion` | 函数 | 版本解析与兼容性检查 |
| `@ductus/schema/journey-graph.schema.json` | 子路径导出 | 原始 JSON Schema 文件 |

## 许可证

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/schema/LICENSE)——[ductus monorepo](https://github.com/PlaxXOnline/ductus) 的一部分。
