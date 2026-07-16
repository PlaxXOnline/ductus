# @ductus/adapter-typescript

[English](./README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | **简体中文**

**直接从你的 TypeScript/JavaScript 代码生成面向最终用户的文档。**
面向 TS/JS 项目的 Ductus 适配器从 `@journey:` 注释以及 react-router/Next.js
配置中提取 journey graph（用户旅程图）——
[Ductus CLI（`@ductus/core`）](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
借助 LLM（BYOK）将其转化为精良的文档，可输出为 MDX 文件或静态网站，
并与代码一同进行版本管理。

- **免构建，目标项目零依赖：** 适配器通过 TypeScript 编译器 API
  （仅解析）读取源码——目标项目无需 `npm install`，无需构建，
  也无需 tsconfig。
- **两条输入路径，可自由组合：** `@journey:` 注释（路径 A，语法与
  Dart 适配器完全一致）以及从 react-router 或 Next.js 自动推导（路径 C）。
- **支持 TS 与 JS，带或不带 JSX：** 扫描 `.ts`、`.tsx`、`.mts`、
  `.cts`、`.js`、`.jsx`、`.mjs`、`.cjs`。
- **确定性输出：** 输出为规范化、字节级稳定的 JSON——非常适合
  代码评审与 CI。

## 安装

前提条件：Node.js ≥ 20——除此之外别无所求，适配器完全运行在 Node 中。

```bash
# 在项目内安装（推荐，与项目一起进行版本管理）
npm install --save-dev @ductus/core @ductus/adapter-typescript

# 或全局安装，目标项目中完全不留任何条目
npm install -g @ductus/core @ductus/adapter-typescript
```

## 使用 @ductus/core 快速上手

```bash
npx ductus init       # 检测 package.json，创建 ductus.config.yaml
npx ductus extract    # 调用适配器 → journey-graph.json
npx ductus generate   # LLM（BYOK）→ 面向最终用户的文档，MDX 或网站
```

`npx ductus help <command>` 显示各命令的选项。`ductus.config.yaml` 中的
相关部分（由 `ductus init` 生成）：

```yaml
adapters:
  - typescript:
      project: .
      deriveFrom: [react-router, next]
```

`ductus init` 会读取 `package.json`：`app.name` 取自包名，`deriveFrom`
列出在 `dependencies` 或 `devDependencies` 中找到的路由器
（`react-router`/`react-router-dom` ⇒ `react-router`，`next` ⇒ `next`）；
若一个都没有找到，则保留默认值 `[react-router, next]`。如果同一目录下
存在 `pubspec.yaml`，则以它为准——Flutter 项目常常为了工具链而带有
`package.json`。

关于配置、LLM 提供商和输出格式的更多内容，请参阅
[`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core)
的 README。

## 免构建：`@journey:` 注释约定

手动输入路径（路径 A）——语法和语义与
[Dart 适配器](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus)
完全一致，可用于 `//` 行注释：

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

一个块以 `@journey:<screen|action|decision|flow>` 开始，键值对形如
`key="value"`（`\"` 转义引号），可在紧随其后的注释行中续写；块在
第一处非注释行或下一个 `@journey:` 块处结束。未知的键和 trigger 会被
忽略并给出警告（未知的 `trigger` 回退为 `tap`）；缺少必填字段会使
运行以错误终止。`tags` 以逗号分隔。

| 块 | 键（必填**加粗**） | 对图的影响 |
|---|---|---|
| `@journey:screen` | **`id`**、**`title`**、`flow`、`description`、`tags` | 屏幕节点 |
| `@journey:action` | **`label`**、**`to`**、`from`、`id`、`trigger`、`condition` | 转场（边） |
| `@journey:decision` | **`id`**、**`title`**、`flow`、`description`、`tags` | 决策节点（分支点） |
| `@journey:flow` | **`id`**、**`title`**、**`start`**、`description` | 命名的 flow；`start` 必须是某个屏幕的 id |

- `trigger` 取值为 `tap`（默认）、`submit`、`auto`、`back`、
  `deeplink`、`system` 之一。
- **组件绑定：** `screen`/`decision` 块绑定到包含它的组件或紧随其后的
  组件——即顶层的类、函数声明，或初始化为函数的 `const`，包括
  `memo(…)`/`forwardRef(…)` 包装。
- 如果某个 `@journey:action` 没有 `from`，则采用包含它的、已知为屏幕的
  组件（通过 `@journey:screen` 或来自推导）；如果无法据此确定屏幕，
  运行会以错误终止。
- 若 action 没有 `id`，会确定性地生成 `e_<from>_<to>`。

类型化注解和构建器（Dart 适配器的路径 B 和 D）在这里被有意省略——
TypeScript 不需要它们，路径 A 就是手动路径，并且不在目标项目中引入
任何依赖。

## 从 react-router / Next.js 自动推导

即使没有任何注解，你也已经能得到一张有用的图（路径 C）。运行哪些
推导由 `deriveFrom` 控制（默认：两者都运行）。

### `react-router`

可识别来自 `createBrowserRouter`、`createHashRouter`、
`createMemoryRouter` 和 `useRoutes` 的对象路由——既可以是内联数组，
也可以是同一文件中的路由常量（`const routes = […];
createBrowserRouter(routes)`）——以及 `<Route>` JSX（同时也覆盖
`createRoutesFromElements`）：

| 来源 | 生成 |
|---|---|
| 带 path 的路由 | 屏幕节点 |
| 带子路由的无 path 布局路由 | flow `shell-N`（`start` = 第一个子屏幕） |
| 调用 `redirect('…')` 的 `loader`（内联或在同一文件中声明） | 决策节点 `<screen>_redirect`，带 `auto` 边 |
| `<Link to>` / `<NavLink to>` | 转场（`tap`；`label` = 唯一的文本子节点） |
| `<Navigate to>` | 转场（`auto`） |
| `navigate('…')` —— 仅在使用 `useNavigate` 的文件中 | 转场（`tap`） |

嵌套路径按绝对路径拼接（`/users` 下的 `path: 'detail'`
⇒ `/users/detail`）。`element={<X />}` 或 `Component={X}` 将组件与
屏幕关联——形如 `<Suspense>` 的单层包装会被看穿；适配器正是通过这一
关联找到导航边的 `from`。

### `next`

基于文件的路由，App Router 和 Pages Router（两者也可位于 `src/` 下）：

| 来源 | 生成 |
|---|---|
| App Router：`app/**/page.*` | 屏幕节点 |
| 路由组 `(name)/` | flow `name`（`start` = 该组的第一个页面） |
| Pages Router：`pages/**`（不含 `_app`/`_document`/`_error` 和 `api/`） | 屏幕节点 |
| 页面文件中带 `next/navigation` 导入的 `redirect('…')` / `permanentRedirect('…')` | 决策节点 `<screen>_redirect`，带 `auto` 边 |
| `<Link href>` | 转场（`tap`；`label` = 唯一的文本子节点） |
| `router.push('…')` / `router.replace('…')` —— 仅在使用 `useRouter` 的文件中 | 转场（`tap`） |

`@slot` 并行路由、`(.)` 拦截路由和 `_private` 文件夹不是独立目标，
会被跳过。

只有存在 **Next 证据** 时才会创建 Pages-Router 屏幕：`package.json`
的 `dependencies`/`devDependencies` 中包含 `next`、存在
`next.config.*`，或被扫描的源码中有来自 `next`/`next/…` 的导入。
没有证据时，`(src/)pages/` 保持沉默——这个文件夹名在 react-router
项目中同样是常见约定，否则会产生幻影屏幕。App Router
（`app/**/page.*`）作为约定没有歧义，不需要证据。

### 推导出的 id 与说明

- 屏幕 id 取路由的 `id:` 属性（react-router）或路径 slug：去掉开头的
  `/`，`/` → `-`，参数段（`:id`、`[id]`）被去除，空路径 ⇒ `root`——
  `/users/:id/edit` ⇒ `users-edit`。`title` 是人性化处理后的 id
  （`users-edit` ⇒ “Users edit”）。
- 推导出的节点和边带有 `source: "derived"`，以及指向其发现位置的
  `sourceRef`（flow 在 schema 中没有 `source`/`sourceRef`）。
- 无法解析的目标或来源（路径不匹配任何已知路由、包含组件不是已知
  屏幕）不算错误：适配器向 stderr 写入一条说明并丢弃该边。

## 合并规则

与 Dart 适配器完全一致：手动的 `@journey:` 条目**逐字段**覆盖推导出
的值——前提是它们使用**相同的 id**（推导出的 id 在 `ductus extract`
之后位于 `journey-graph.json` 中）。如果两个**手动**来源相互矛盾，
运行会 fail-fast 终止并同时指出两个位置。没有显式 id 的边会确定性地
得到 `e_<from>_<to>`（冲突时追加 `_2`、`_3`……）；输出经过规范化
排序，在多次运行间字节级稳定，`meta.adapters` 包含
`[{ "name": "typescript", "version": … }]`。

## 适配器 CLI

通常由 `ductus extract` 自动启动适配器。手动方式：

```bash
ductus-adapter-typescript --project <dir> [--config <json-file>] [--no-debug-file]
```

| 选项 | 含义 |
|---|---|
| `--project <dir>` | 项目目录（必填） |
| `--config <json-file>` | JSON 配置文件（键见下文）；`@ductus/core` 会根据 `ductus.config.yaml` 中的适配器条目自动生成 |
| `--no-debug-file` | 不在项目目录中写入调试文件 `ductus_graph.g.json`（默认：写入） |

行为：stdout 恰好是一份规范化的图 JSON，所有诊断信息（警告、说明）
都输出到 stderr。

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `64` | 用法错误（缺少 `--project`、未知选项） |
| `1` | 适配器错误（缺少必填字段、无法解析的 `from`、合并冲突、无效配置） |

`--config` JSON 的键（对应 `ductus.config.yaml` 中 `adapters:` 部分的
适配器条目）：

| 键 | 默认值 | 含义 |
|---|---|---|
| `deriveFrom` | `["react-router", "next"]` | 推导来源（路径 C） |
| `include` | `["src/**", "app/**", "pages/**", "lib/**"]` | 相对于项目、参与扫描的 glob 模式 |

扫描扩展名为 `.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs`、
`.cjs` 的文件。`node_modules`、`dist`、`build`、`out`、`coverage` 以及
点目录（`.git`、`.next`……）永远不会被扫描——与 `include` glob 无关。

## @ductus/core 如何找到适配器

`ductus extract` 按以下顺序为适配器条目 `typescript` 解析命令：

| # | 来源 | 行为 |
|---|---|---|
| 1 | `ductus.config.yaml` 适配器条目中的 `command:` | 永远优先——配置的命令原样执行。 |
| 2 | `ductus.config.yaml` 旁边的 `node_modules/.bin` | 来自 `npm install -D @ductus/adapter-typescript` 的可执行文件 `ductus-adapter-typescript`。 |
| 3 | `PATH` | 来自 `npm install -g @ductus/adapter-typescript` 的可执行文件。 |

如果没有任何一步命中，调用会以一条同时列出两种安装方式的错误消息
终止。与 Dart 适配器不同，这里不需要额外的工具链——适配器运行在与
`@ductus/core` 相同的 Node 中。

## 局限

- **仅解析意味着：只支持字符串字面量。** 路径和目标必须可静态读取
  （`'…'`、`"…"` 或不含插值的模板字面量）——像
  `` navigate(`/users/${id}`) `` 这样的动态路径不会被识别，没有字面量
  `path` 的路由会被跳过并给出说明。
- **`navigate(…)`/`router.push(…)` 需要 hook 上下文：** `navigate('…')`
  仅在使用 `useNavigate` 的文件中被识别，`router.push`/
  `router.replace` 仅在有 `useRouter` 的文件中——因此同名的自由函数
  不会被误捕获。
- **解析止步于文件边界：** 路由常量（`createBrowserRouter(routes)`）
  和 `loader` 函数只有在同一文件中声明时才会被解析——导入的路由数组
  或守卫（`import { requireAuth } from './guards'`）不会被识别。
- **`@journey:` 块只支持 `//` 行注释**，不支持 `/* … */` 块注释。
- **此版本不支持 Vue、Svelte 或 Angular：** `deriveFrom` 只认识
  `react-router` 和 `next`。不过路径 A 与框架无关，可用于任何 TS/JS
  项目。

个别文件中的语法错误不会中止运行——TypeScript 编译器 API 以容错
方式解析，适配器通过 stderr 上的警告报告该文件，并尽力继续分析。

## 链接

| 包 | 说明 |
|---|---|
| [`@ductus/core`](https://github.com/PlaxXOnline/ductus/tree/main/packages/core) | CLI、编排器、LLM 层（BYOK）、MDX/网站输出 |
| [`@ductus/schema`](https://github.com/PlaxXOnline/ductus/tree/main/packages/schema) | journey graph 的 JSON Schema 和 TypeScript 类型 |
| [`@ductus/adapter-dart`](https://github.com/PlaxXOnline/ductus/tree/main/packages/adapter-dart) + [`ductus`（Dart）](https://github.com/PlaxXOnline/ductus/tree/main/dart/ductus) | 本适配器的 Dart/Flutter 对应实现 |
| [`react_router_demo`](https://github.com/PlaxXOnline/ductus/tree/main/examples/react_router_demo) | 可运行的示例应用：react-router 推导 + `@journey:` 注释 |

更多内容见 [Ductus 仓库](https://github.com/PlaxXOnline/ductus)。

## 许可证

[MIT](https://github.com/PlaxXOnline/ductus/blob/main/packages/adapter-typescript/LICENSE)
