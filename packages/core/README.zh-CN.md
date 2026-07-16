# @ductus/core

[English](./README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | **简体中文**

**直接从应用代码生成最终用户文档——自动、可验证、可版本化。**

Ductus 从带注解的源代码（Dart/Flutter 与 TypeScript/JavaScript）中提取
journey graph（用户旅程图），并通过 LLM——使用你自己的 API 密钥
（BYOK）——将其转换为精良的最终用户文档：以 MDX 文件或
静态网站的形式输出。`@ductus/core` 是整个工具链的核心：CLI、
编排器、LLM 层与输出模块。

- **以图（而非散文）为源** —— 适配器从代码中读取路由与注解；`ductus extract` 将其合并、校验并生成 `journey-graph.json`。无需 LLM 即可使用。
- **BYOK 式 LLM 转换** —— 支持 Anthropic、OpenAI、Mistral、任意兼容 OpenAI 的端点（`custom`，例如本地模型），或用于测试的确定性 `mock` 提供商。无 SDK 依赖；密钥始终留在你的环境变量中。
- **Faithfulness judge（忠实性裁判）** —— 第二次 LLM 调用检查生成的文本是否有图作为依据。违规会醒目地出现在输出和报告中；超过阈值时运行失败（退出码 2）。
- **成本尽在掌控** —— 首次 LLM 调用前给出 token/成本估算，分段缓存位于 `.ductus/cache`（未变更的分段不再产生任何费用）。
- **两种输出模式** —— 生成 MDX 文件接入你现有的文档流水线，或生成一个开箱即用的静态网站（交互式 journey 站点或 Starlight）。
- **可直接用于 CI** —— `ductus check` 在零 LLM 成本的情况下校验图与 faithfulness；输出确定且字节级稳定。

## 安装

要求：Node.js ≥ 20。

```bash
# 全局安装
npm install -g @ductus/core

# 或作为项目的 devDependency
npm install --save-dev @ductus/core
```

对于 Dart/Flutter 项目，还需安装适配器：

```bash
npm install -g @ductus/adapter-dart
```

并在你的 Flutter 项目中添加 Dart 包 [`ductus`](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)（注解 + 提取器）作为依赖。

对于 TypeScript/JavaScript 项目（例如使用 react-router 的 React 或 Next.js），只需：

```bash
npm install -g @ductus/core @ductus/adapter-typescript
```

目标项目中无需任何额外的 SDK 或依赖——[TypeScript 适配器](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript)会自行解析源码（仅解析，纯 Node 实现）。

## 快速上手

```bash
cd my_project                        # Flutter 或 TS/JS 项目

ductus init                          # 检测 pubspec.yaml 或 package.json，生成 ductus.config.yaml
ductus extract                       # → journey-graph.json + ductus-report.json

export DUCTUS_LLM_API_KEY=sk-…       # 你自己的 Anthropic/OpenAI 密钥（BYOK）
ductus generate                      # → docs/*.mdx（或网站，取决于配置）

ductus graph --open                  # 在浏览器中以 HTML 形式查看图
ductus check                         # CI 门禁：校验 + faithfulness，零 LLM 成本
```

## CLI 参考

全局选项（可置于命令之前或之后）：

| 选项 | 说明 |
|---|---|
| `-c, --config <path>` | `ductus.config.yaml` 的路径（默认：`./ductus.config.yaml`） |
| `--offline` | 不访问网络：`extract`/`check`/`graph` 可自由运行（适配器在本地工作），`generate` 仅在 `llm.provider: mock` 时可用 |

命令：

| 命令 | 选项 | 说明 |
|---|---|---|
| `ductus init` | `--force` | 生成带注释的 `ductus.config.yaml`。检测 `pubspec.yaml`（`app.name`，`go_router`/`auto_route` ⇒ `deriveFrom`）或 `package.json`（`app.name`，`react-router`/`react-router-dom`/`next` ⇒ `deriveFrom`）；两者同时存在时以 `pubspec.yaml` 为准。仅在指定 `--force` 时才覆盖已有配置。 |
| `ductus extract` | — | 运行所有适配器，合并并校验图。在配置文件旁写入 `journey-graph.json` 和 `ductus-report.json`。无需 LLM 即可使用。 |
| `ductus generate` | `--build` | 提取 + LLM 生成 → MDX 或网站。`--build` 会在导出后额外构建网站（在站点目录中执行 `npm ci`/`install` + `npm run build`；仅适用于 `output.format: website`，不能与 `--offline` 组合使用）。 |
| `ductus check` | — | 校验 + 从分段缓存读取 faithfulness 结果——不写文件、不调用 LLM（可直接用于 CI）。尚未生成的分段会被报告，但不视为错误。 |
| `ductus graph` | `--open`、`--out <path>`、`--journey` | 将图作为 Mermaid flowchart 打印到 stdout。`--journey` 改为打印各 flow 主路径的 journey 图。`--out` 写入文件。`--open` 写入 `.ductus/graph.html`（flowchart **和** journey 图）并在浏览器中打开。 |
| `ductus help [command]` | — | 不带参数时打印完整的 CLI 概览（工作流、命令、退出码、配置）；带参数时显示该命令的帮助。 |

## 配置：`ductus.config.yaml`

`ductus init` 生成的正是下面这个模板（其中的值会根据 `pubspec.yaml` 或
`package.json` 预填）：

```yaml
# Ductus 配置
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

`app.locale`（默认：`en`）是生成的最终用户文档所使用的语言。
`style.voice`（默认：`en-you`）决定其语气：`en-you` 以平实的英语
“you”称呼读者；`formal-sie` 和 `informal-du` 仍完整支持德语最终用户
文档（分别对应正式的“Sie”和非正式的“du”）。

在 TypeScript/JavaScript 项目中，`adapters:` 部分则形如：

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

其他可选键（在适用处附默认值）：

| 键 | 说明 |
|---|---|
| `app.platforms` | 目标平台列表（纯信息用途，会写入图的元数据） |
| `adapters[].project` | 相对于配置文件的项目目录（默认：`.`） |
| `adapters[].command` | 显式覆盖适配器命令 |
| `adapters[].extra` | 原样（1:1）传递给适配器的附加选项（例如 Dart 和 TypeScript 适配器的 `include` glob；直接写在适配器条目里的未知键也会归入此处） |
| `llm.maxTokens` | 每次 LLM 调用的最大输出 token 数（默认：`2048`） |
| `llm.baseUrl` | 端点的基础 URL——使用 `provider: custom` 时**必填** |
| `llm.faithfulnessThreshold` | 允许的 faithfulness 违规总数；超过即退出码 2（默认：`0`） |
| `llm.pricing.inputPerMTokUsd` / `llm.pricing.outputPerMTokUsd` | 每 100 万 token 的美元价格——只有提供这些值，Ductus 才会将估算换算成美元 |
| `output.website.template` | 使用自定义模板目录替代内置模板 |

未知的顶层键只会产生警告（向前兼容）。

## 输出模式

### `format: mdx`

为每个分段（flow 或 screen，取决于 `style.granularity`）向
`output.dir` 写入一个带 YAML frontmatter 的 MDX 页面。启用
`diagrams: true` 时，每个 flow 页面都包含以 Mermaid `flowchart`
呈现的流程，且——只要推导出的主路径至少有两个节点——还会以
`journey` 图额外呈现主路径。Faithfulness 违规会以醒目的警告框
显示在页面顶部。输出是字节级稳定的——非常适合提交入库并做 diff。

### `format: website`

将一个完整的 Astro 网站脚手架生成到 `output.dir`（之后执行
`npm install`、`npm run dev` 或 `npm run build`——或直接使用
`ductus generate --build`）。

| 生成器 | 说明 |
|---|---|
| `journey` *（默认）* | 基于 `ductus.data.json` 构建的交互式 journey 站点：可点击的 journey 图（确定性布局）、“Play path”路径播放、⌘K/Ctrl+K 搜索（覆盖 journey/步骤/操作）、每个 journey 的步骤列表 + 由 LLM 撰写的详细指南。站点 UI 跟随 `app.locale`（默认为英文，`de` 时为德文 UI）。[查看模板](https://github.com/PlaxXOnline/ductus/tree/main/templates/journey) |
| `starlight` | 基于 Astro/Starlight 的经典文档站点；生成的 MDX 页面放入 `src/content/docs/`，Mermaid 图在浏览器中渲染。[查看模板](https://github.com/PlaxXOnline/ductus/tree/main/templates/starlight) |
| `docusaurus` | 尚未提供——`generate` 会给出明确提示并中止；请改用 `journey` 或 `starlight`。 |

## LLM：BYOK、成本、缓存与 faithfulness

**Bring Your Own Key（自带密钥）。** API 密钥来自 `llm.apiKeyEnv`
指定的环境变量（默认：`DUCTUS_LLM_API_KEY`），绝不会出现在任何
输出或错误信息中。

| 提供商 | 备注 |
|---|---|
| `anthropic` | Anthropic Messages API；需要密钥 |
| `openai` | OpenAI Chat Completions；需要密钥 |
| `mistral` | Mistral Chat Completions（兼容 OpenAI，api.mistral.ai）；需要密钥——请显式设置 `model`，例如 `mistral-large-latest` |
| `custom` | 通过 `llm.baseUrl` 使用任意兼容 OpenAI 的端点（例如本地模型）——未设置密钥时不发送 Authorization 头 |
| `mock` | 确定性、无网络——用于测试、CI 和 `--offline` |

**运行前的成本估算。** 在首次调用提供商之前，`generate` 会打印
一份估算（分段数、输入/输出 token 数，配置了 `llm.pricing` 时还
包括美元金额）。该启发式按约每 4 个字符 1 个 token 计算；实际
数字会在运行结束后出现在输出和 `ductus-report.json` 中。

**分段缓存。** 结果存储在 `.ductus/cache` 下，以分段内容、提示词
版本、模型和风格（`voice`/`locale`）为键。后续运行中未变更的分段
不产生任何 LLM 费用；`generate` 会报告缓存命中与重新生成的数量。

**Faithfulness 检查。** 两层机制保障生成的文本——LLM 的断言绝不会
未经验证就被接受：

1. **确定性词汇检查**（始终启用，无需 LLM）：步骤行中所有标记为
   UI 元素的加粗（`**bold**`）术语都会与图分段的词汇表（节点标题、
   边标签、条件、应用名称）进行比对。凭空捏造的 UI 元素必定会被
   捕获——与模型和 judge 无关。
2. **Faithfulness judge**（`llm.faithfulnessCheck: true`，默认开启）：
   第二次 LLM 调用查找语义偏差。judge 本身不被信任——它的结论要
   经过验证：每条发现都必须逐字引用问题段落，并指出声称缺失的
   元素；代码会对两者进行机械校验。被驳回的发现（引文不在文本中，
   或元素实际上存在于图中）会被丢弃；边界情况作为**提示**（`hints`）
   保留——只有得到确认的发现才计为违规。使用 `anthropic`、`openai`
   和 `mistral` 时，结构化输出（tool use 或 `json_schema`）还会在
   API 侧强制保证 JSON 有效。

违规会以警告框写入输出，并在报告中列出；提示单独列出，**不**计入
阈值。如果违规数量超过 `llm.faithfulnessThreshold`（默认：`0`），
运行以退出码 2 结束——输出仍会写出，以便你检查被标记的段落。

## 退出码

| 代码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 图存在校验错误，或多个适配器输出之间存在合并冲突（详情逐行输出到 stderr） |
| `2` | Faithfulness 违规超过阈值 |
| `3` | 配置、LLM、适配器或网站构建错误（包括 `--build` + `--offline` 之类的用法错误） |

## CI 方案：零 LLM 成本的 `ductus check`

`ductus check` 运行适配器、校验图，并且只从分段缓存读取
faithfulness 结果——不调用 LLM，也不需要 API 密钥。若要让
faithfulness 部分在 CI 中生效，请将 `.ductus/cache` 目录提交到
仓库（它来自你上一次本地运行的 `ductus generate`）。

```yaml
# GitHub Actions（节选）
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - uses: subosito/flutter-action@v2   # Dart 适配器需要 Dart/Flutter SDK
  - run: npm install -g @ductus/core @ductus/adapter-dart
  - run: flutter pub get
  - run: ductus check                  # 退出码 1 = 图损坏，退出码 2 = faithfulness
```

对于 TypeScript/JavaScript 项目，可以去掉 SDK 那一行——
TypeScript 适配器是纯 Node 实现，无需额外的 SDK：

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm install -g @ductus/core @ductus/adapter-typescript
  - run: ductus check
```

## 说明：Mermaid 与 CDN

`ductus graph --open` 生成的 HTML 页面在打开时会从 CDN 加载
Mermaid（jsdelivr，mermaid@11）——因此浏览器中的渲染需要一次
网络访问。Starlight 网站的图表渲染同理；离线时，图表源码仍以
代码块形式可读。`--offline` 本身只影响 `generate`（仅允许配合
`llm.provider: mock` 使用，不能与 `--build` 组合）。

## 生态系统

| 包 | 说明 |
|---|---|
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) | 让 Dart 适配器 CLI 可被调用的 npm 包装器 |
| [`@ductus/adapter-typescript`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-typescript) | TypeScript/JavaScript 适配器：`@journey:` 注释 + 从 react-router/Next.js 推导 |
| [`ductus`（Dart）](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | pub.dev 包：面向 Flutter/Dart 的注解、提取器和 build_runner 构建器 |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | journey graph 的 JSON Schema 与 TypeScript 类型 |

更多内容见 [Ductus 仓库](https://github.com/PlaxXOnline/ductus)：
[示例项目](https://github.com/PlaxXOnline/ductus/tree/main/examples) ·
[最佳实践](https://github.com/PlaxXOnline/ductus#best-practices)（图质量、工作流、LLM 与成本）。

## 许可证

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/core/LICENSE)
