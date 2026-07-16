# ductus

[English](./README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | **简体中文**

**直接从 Flutter 代码生成面向最终用户的文档。** `ductus` 提供旅程注解和一个
适配器 CLI，用于从你的应用中提取 journey graph（用户旅程图）——
[Ductus CLI（`@ductus/core`）](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
再将其转化为由 LLM 维护的文档（MDX 文件或静态网站），并随代码一同进行版本管理。

- **四条输入路径，可自由组合：** `@journey:` 注释（免构建）、Dart 注解、
  从 `go_router`/`auto_route` 自动推导、build_runner 构建器。
- **零运行时开销：** 这些注解只是纯粹的标记——没有任何运行时行为，
  不会给应用的二进制文件增加额外代码。
- **无需构建：** 适配器仅做解析（parse-only）分析；目标项目既不需要
  `pub get`，也不需要构建。
- **确定性：** 输出是规范化、diff 稳定的 JSON——非常适合代码评审和 CI。

## 安装

在应用代码中使用注解（`lib/` 中的 `@JourneyScreen` 等）：

```bash
dart pub add ductus
```

只需要适配器 CLI、不在代码中使用注解：

```bash
dart pub add dev:ductus
```

完全不在项目中引入依赖（注释约定，见下文）：

```bash
dart pub global activate ductus
```

## 快速上手：标注 → 提取 → 生成

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

然后使用 Ductus CLI（Node.js ≥ 20）：

```bash
npm install -g @ductus/core @ductus/adapter-dart

ductus init        # 创建 ductus.config.yaml，检测 pubspec.yaml 和路由器
ductus extract     # 构建并校验图 → journey-graph.json
ductus generate    # LLM 文档（BYOK）→ docs/*.mdx 或静态网站
```

对于 `generate`，只需在 `DUCTUS_LLM_API_KEY` 环境变量中提供你自己的
API 密钥（Anthropic、OpenAI 或兼容端点）即可；`extract` 则完全离线运行。
想在没有密钥的情况下试用：在 `ductus.config.yaml` 中设置
`llm.provider: mock`。

可运行的示例：
[flutter_go_router_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_go_router_demo)
（推导 + 注解）和
[flutter_comment_demo](https://github.com/PlaxXOnline/ductus/tree/main/examples/flutter_comment_demo)
（仅注释，无依赖）。

## 注解 API

所有注解都来自 `package:ductus/ductus.dart`：

| 注解 | 参数（**粗体**为必填） | 对图的影响 |
|---|---|---|
| `@JourneyScreen` | **`id`**、**`title`**、`flow`、`description`、`tags` | 屏幕节点；用于类 |
| `@JourneyAction` | **`label`**、**`to`**、`from`、`id`、`trigger`、`condition` | 转场（边）；用于方法、函数和字段 |
| `@JourneyDecision` | **`id`**、**`title`**、`flow`、`description`、`tags` | 决策节点（分支点） |
| `@JourneyFlow` | **`id`**、**`title`**、**`start`**、`description` | 命名的 flow；`start` 必须是某个屏幕的 id |

- `trigger` 是一个 `JourneyTrigger`：`tap`（默认）、`submit`、`auto`、
  `back`、`deeplink`、`system`。
- 如果 `@JourneyAction` 上缺少 `from`，则使用已知为屏幕的外层类。
- 如果没有 action `id`，会确定性地生成 `e_<from>_<to>`。
- 参数必须是字符串字面量；如果需要像 `title: MyConstants.title` 这样的
  常量引用，请使用 build_runner 构建器（见下文）。

## 免构建：`@journey:` 注释约定

与注解等价，可用于 `//` 和 `///` 注释——这样项目甚至不需要把
`ductus` 作为依赖：

```dart
// @journey:screen id="dashboard" title="Overview"
//   description="Central overview after signing in."
class DashboardScreen { … }
```

一个块以 `@journey:<screen|action|decision|flow>` 开始，键值对形式为
`key="value"`（`\"` 转义引号），可在紧随其后的注释行中续行；块在第一个
非注释行处或下一个 `@journey:` 块处结束。必填字段与注解相同；未知的键
会被忽略并给出警告，`tags` 以逗号分隔。

完全不引入项目依赖的设置方式：

```bash
dart pub global activate ductus
npm install -g @ductus/core @ductus/adapter-dart
ductus extract
```

Ductus CLI 通过 `dart pub global run` 找到全局激活的适配器；也可以用
`DUCTUS_DART_ADAPTER_DIR` 环境变量指向包含适配器包的目录。

## 从 go_router / auto_route 自动推导

即使没有任何注解，你也已经能得到一个可用的图：

| 来源 | 生成为 |
|---|---|
| `GoRoute` | 屏幕节点 |
| `ShellRoute` | Flow |
| `redirect:` | 决策节点 |
| 带字符串字面量的 `context.go()` / `push()` / `goNamed()` / … | 转场 |
| `@RoutePage()` 类（auto_route） | 屏幕节点 |

推导出的元素带有 `source: "derived"`；具有相同 id 的手动注解会逐字段
覆盖推导值。两个手动来源出现冲突值时会报错，并同时报告两处源位置。
推导出的 id 取路由的 `name` 或路径 slug（`/users/:id/edit` ⇒ `users-edit`）。

`auto_route` 的推导明确属于**尽力而为（best effort）**：只识别
`@RoutePage()` 屏幕和路径表，不识别导航边——转场需要你通过
`@JourneyAction` 或 `@journey:action` 自行添加。

运行哪些推导由 `deriveFrom` 控制（默认：两者都启用）——可在
`ductus.config.yaml` 的 `adapters:` 下设置，或作为适配器 CLI 的
`--config` JSON 传入。

## build_runner 构建器

对于本来就在运行 `build_runner` 的项目：构建器 `ductus:journey_builder`
作为一个构建步骤运行，并把图以 `ductus_builder.g.json` 写入项目根目录。
它的附加价值在于**解析（resolution）**：非字面量的常量注解参数
（例如 `title: MyConstants.title`）会通过已解析的 AST 得到解析，
而不是被当作错误/警告拒绝。

```bash
dart pub add ductus dev:build_runner
dart run build_runner build
# → 项目根目录中的 ductus_builder.g.json
```

构建器通过 `auto_apply: dependents` 自动生效；项目只需为选项提供自己的
`build.yaml`——支持 `deriveFrom` 和 `include`，默认值与适配器 CLI 相同：

```yaml
targets:
  $default:
    builders:
      ductus:journey_builder:
        options:
          deriveFrom: [go_router]
          include: [lib/**]
```

该产物通过 `--from-builder` 进入流水线——此时适配器 CLI 只检查
`schemaVersion` 并将文件原样传递；不会执行自己的扫描：

```bash
dart run ductus:adapter --project . --from-builder
```

或在 `ductus.config.yaml` 中：

```yaml
adapters:
  - dart:
      project: .
      fromBuilder: true
```

需要注意的事项：

- `ductus_builder.g.json` 的新鲜程度取决于上一次 build_runner 运行——
  因此请在 `ductus extract` 之前运行 `dart run build_runner build`
  （或保持 `watch` 运行）。如果该文件缺失，`--from-builder` 会中止并给出提示。
- 构建器只能看到 build_runner 目标 sources 中的文件（默认包含 `lib/`）；
  超出该范围的 `include` 模式会产生无匹配项的警告——此时请扩展
  `targets.$default.sources` 或改用适配器 CLI。
- 在注解全部为字面量的情况下，结果与适配器 CLI 逐字节一致——只有
  `meta.adapters` 中的名称不同（`dart-builder` 而不是 `dart`）。
- `ductus_builder.g.json` 应加入 `.gitignore`（构建产物）——不要与
  `ductus_graph.g.json` 混淆，后者是适配器 CLI 的调试文件。

## 适配器 CLI

```
dart run ductus:adapter --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

| 选项 | 含义 |
|---|---|
| `--project <dir>` | 项目目录（必填） |
| `--config <file>` | JSON 配置文件，例如 `{"deriveFrom": ["go_router"], "include": ["lib/**"]}`（默认：两种推导均启用，`lib/**`） |
| `--no-debug-file` | 不在项目目录中生成调试文件 `ductus_graph.g.json` |
| `--from-builder` | 直接传递 `ductus_builder.g.json` 而不自行扫描（等价配置键：`"fromBuilder": true`；命令行标志优先） |

行为：stdout 恰好输出一份规范化的图 JSON（确定性、diff 稳定），警告和
提示输出到 stderr；成功时退出码为 0，出错时为非零。分析仅做解析
（parse-only）——目标项目既不需要 `pub get` 也不需要构建；只有
`--from-builder` 需要事先运行过 build_runner。

对仅解析的输入路径（注释、注解、推导）而言，重要的一点是：必填字段
（`id`、`title`、`label`、`to`、`start`）以及显式的 `from` 必须是字符串
字面量——否则适配器会报错并中止。无法按字面量读取的可选字段会被丢弃并
给出警告；无法读取的 `trigger` 会回退为 `tap` 并给出警告。导航调用只有
在参数为字符串字面量时才会被识别为转场候选（`context.go('/settings')`）。

## 配合 Ductus CLI 使用

Node 端负责编排适配器，并把图转化为文档：

| 命令（`@ductus/core`） | 用途 |
|---|---|
| `ductus init` | 创建 `ductus.config.yaml`；检测 `pubspec.yaml`（应用名称、go_router/auto_route） |
| `ductus extract` | 运行 Dart 适配器，进行校验并写出 `journey-graph.json` |
| `ductus generate` | 通过 LLM（BYOK）生成 MDX 文件或静态网站；包含 faithfulness 检查 |
| `ductus check` | 检查图的有效性和 faithfulness，但不写任何文件（CI） |
| `ductus graph` | 以 Mermaid 形式输出图；`--open` 会在浏览器中渲染为 HTML |
| `ductus help [command]` | 打印 CLI 总览或某个命令的帮助 |

生成的文档默认为英语（`app.locale: en`，voice 为 `en-you`）；如需面向
德语最终用户的文档，请将 `style.voice` 设为 `formal-sie` 或
`informal-du`。

更多信息见[仓库 README](https://github.com/PlaxXOnline/ductus)
和 [`@ductus/core` 文档](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)。

## 许可证

MIT——见 [LICENSE](https://github.com/PlaxXOnline/ductus/blob/main/dart/ductus/LICENSE)。
