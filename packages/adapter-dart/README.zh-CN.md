# @ductus/adapter-dart

[English](./README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | **简体中文**

一个 npm 包装器，让 Ductus 的 Dart 适配器可供 [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) 调用运行——实际的代码分析位于 pub.dev 包 [`ductus`](https://pub.dev/packages/ductus) 中，并在 Dart 工具链中执行。

本包**不包含任何分析逻辑**。它只提供 `ductus-adapter-dart` 可执行文件，该文件在合适的包上下文中调用 `dart run ductus:adapter`，透传 stdout/stderr 和退出码，并保证：**stdout 恰好是一份图 JSON 文档**（诸如 `Resolving dependencies...` 之类的 pub 前置输出会被重定向到 stderr，不会丢失任何内容）。

**前提条件：**`PATH` 上已安装 [Dart SDK](https://dart.dev/get-dart)（Flutter 项目中已自带）。Node.js ≥ 20。

## 安装

```bash
npm install --save-dev @ductus/core @ductus/adapter-dart
```

此外，Dart 侧必须能够解析 `ductus:adapter`——以下两种方式任选其一即可：

```bash
# 方式 1：安装在目标项目中（推荐，随项目一起进行版本管理）
dart pub add dev:ductus

# 方式 2：全局安装，目标项目中完全无需任何条目
dart pub global activate ductus
```

如果你在 `lib/` 中导入 Dart 注解（路径 B，见下文），请改为将 `ductus` 添加为常规依赖：`dart pub add ductus`。

## 使用 @ductus/core 快速上手

```bash
npx ductus init       # 创建 ductus.config.yaml
npx ductus extract    # 调用 Dart 适配器 → journey-graph.json
npx ductus generate   # LLM（BYOK）→ 面向最终用户的文档（MDX 或网站）
```

`ductus.config.yaml` 中的相关片段（由 `ductus init` 生成）：

```yaml
adapters:
  - dart:
      project: .
      deriveFrom: [go_router, auto_route]
```

关于配置、LLM 提供商和输出格式的更多信息，请参阅 [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) 的 README。

## @ductus/core 如何找到适配器

`ductus extract` 按以下顺序为 `ductus.config.yaml` 中的 `dart` 适配器条目解析要执行的命令（core 运行器与本包装器中的实现完全一致）：

| # | 来源 | 行为 |
|---|------|------|
| 1 | `ductus.config.yaml` 适配器条目中的 `command:` | 始终优先——配置的命令按原样执行。 |
| 2 | `ductus-adapter-dart` 可执行文件（本包） | 先在配置文件旁的 `node_modules/.bin` 中查找，然后在 `PATH` 上查找。包装器内部会继续执行步骤 3–5 的解析链。 |
| 3 | 环境变量 `DUCTUS_DART_ADAPTER_DIR` | 以该目录为工作目录执行 `dart run ductus:adapter`——当项目和 pub-global 都无法识别该包时很有用（例如 monorepo 检出）。 |
| 4 | 目标项目的 `pubspec.yaml` 声明了 `ductus` | 直接在目标项目中执行 `dart run ductus:adapter`（`dependencies` 或 `dev_dependencies`）。 |
| 5 | 全局激活的包（`dart pub global activate ductus`） | `dart pub global run ductus:adapter`；若是路径激活，`dart run` 直接在源目录中运行。 |

如果没有任何步骤适用，调用将中止并输出一条错误消息，其中列出可选方案（`dart pub add dev:ductus`、`dart pub global activate ductus` 或 `DUCTUS_DART_ADAPTER_DIR`）。因此，只要其他任一步骤适用，目标项目就**不**需要 `ductus` 依赖。

## 适配器支持哪些输入来源

Dart 适配器将四条输入路径合并为一张图；手动注解会逐字段覆盖推导出的值：

| 路径 | 来源 | 目标项目中的依赖？ |
|------|------|--------------------|
| A | `//`/`///` 注释中的注释约定 `@journey:screen`、`@journey:action`、`@journey:decision`、`@journey:flow` | 无——完全无需构建 |
| B | Dart 注解 `@JourneyScreen`、`@JourneyAction`、`@JourneyDecision`、`@JourneyFlow` | `ductus`（仅用于导入，无运行时行为） |
| C | 自动推导：从 `go_router`（`GoRoute` → 屏幕，`ShellRoute` → flow，`redirect:` → 决策，`context.go()/push()/…` → 转场）以及从 `auto_route`（`@RoutePage()` → 屏幕，尽力而为） | 无（只需路由包本身） |
| D | build_runner 产物 `ductus_builder.g.json`——`ductus` 包中的构建器作为构建步骤运行，并能解析非字面量常量；适配器通过 `--from-builder` 或配置键 `fromBuilder: true` 透传该产物 | `ductus` + `build_runner` |

关于全部四条路径的细节、示例和最佳实践：[`ductus` 包的 README](https://pub.dev/packages/ductus)。两个可运行的演示应用（仅路径 A，以及路径 B+C 组合）位于 [examples/](https://github.com/PlaxXOnline/ductus/tree/main/examples)。

## 直接调用（可选）

通常 `ductus extract` 会自动启动包装器。手动调用：

```bash
ductus-adapter-dart --project <dir> [--config <json-file>] [--no-debug-file] [--from-builder]
```

- `--project <dir>`（必需）：要分析的 Dart/Flutter 项目。
- `--config <json-file>`：以 JSON 对象形式提供的适配器配置，包含键 `deriveFrom`（默认 `["go_router", "auto_route"]`）、`include`（相对于项目的 glob 模式，默认 `["lib/**"]`）和 `fromBuilder`（默认 `false`）。`@ductus/core` 会根据 `ductus.config.yaml` 中的适配器条目自动生成此文件。
- `--no-debug-file`：不在项目目录中生成调试文件 `ductus_graph.g.json`。
- `--from-builder`：直接透传 build_runner 产物 `ductus_builder.g.json`，而不自行扫描（路径 D；等同于配置键 `fromBuilder: true`，以该标志为准）。

stdout 恰好是一份规范化的图 JSON；警告和诊断信息输出到 stderr。Dart 适配器的退出码原样透传。

## 链接

- [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)——CLI、编排器、LLM 层（BYOK）、MDX/网站输出
- [pub.dev 上的 `ductus`](https://pub.dev/packages/ductus)——注解、适配器 CLI、build_runner 构建器（[源代码](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)）
- [Ductus 仓库](https://github.com/PlaxXOnline/ductus)

## 许可证

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-dart/LICENSE)
