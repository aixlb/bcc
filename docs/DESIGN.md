# bcc 设计文档

> 0.4.0 起采用 workspace 布局：桌面应用位于 `apps/bcc-desktop`，CLI 位于 `apps/bcc-cli`，共用核心位于 `packages/bcc-core`。仓库来源和数据兼容约定见 [MIGRATION.md](MIGRATION.md)。下文保留既有设计决策，源码路径已按新布局调整。

## 布局系统

### 整体结构（从外到内）

```
AppShell (scanlines flex h-full flex-col)
  ├── TitleBar
  └── 主体 (flex flex-1 overflow-hidden)
      ├── Sidebar (固定宽度 240px)
      ├── resize handle
      └── MainArea
          └── ResizableSplit vertical (defaultSize: 600)
              ├── first: main (flex flex-1 flex-col)
              │   └── ProjectView (grid h-full grid-rows-[auto_1fr])
              │       ├── 顶部栏 (shrink-0)
              │       └── ResizableSplit horizontal (defaultSize: 520)
              │           ├── first: 视频+控制区
              │           │   └── grid h-full grid-rows-[1fr_auto]
              │           │       ├── video 容器 (min-h-[200px])
              │           │       └── VideoControls
              │           └── second: 剧本/分镜 tab
              └── second: JobDrawer
```

### 关键决策：为什么 ProjectView 用 Grid 而不是 Flex

**问题**：嵌套 flex 中 `flex-1` = `flex: 1 1 0%`，子元素的 `height: 100%` 可能基于 `flex-basis: 0%` 计算为 0，导致视频区域高度为 0。

**表现**：新建项目正常，打开已有剧本/分镜的历史项目后视频被压到底部。

**根因**：历史项目加载内容后触发额外 reflow，浏览器在 `flex-basis: 0%` 的中间状态下计算了错误高度。

**修复**：ProjectView 外层改用 `grid h-full grid-rows-[auto_1fr]`，第二行（ResizableSplit horizontal）天然获得明确的剩余高度，不再依赖 flex stretch 的时机。

### ResizableSplit 不持久化

- sidebar 宽度：固定 240px，不写 localStorage
- ResizableSplit：移除 sessionStorage 读取/保存，每次启动恢复 defaultSize

---

## 媒体协议 media://

### URL 格式

`media://local/<base64url-of-absolute-path>`

用 base64url 编码避免 Windows 路径中的 `:\/` 破坏 URL 解析。

### 实现

主进程 `protocol.handle('media', ...)` 拦截请求：

- 解析 URL → base64url 解码 → 绝对路径
- 支持 Range request（视频 seek 必需）
- 小文件（< 5MB，图片）直接用 `fs.readFile` 返回 Buffer，避免 `Readable.toWeb` 流兼容问题
- 大文件（视频）用 `createReadStream` + `Readable.toWeb`

### CSP

`img-src 'self' data: blob: media:` 已放通。

---

## 分镜图片加载

### 问题

`<img src="media://local/...">` 在某些场景下不显示（控制台无 CSP 错误，文件存在）。

### 修复

`StoryboardEditorTab` 中每张缩略图通过 `fetch(mediaUrl) → res.blob() → URL.createObjectURL(blob)` 加载，绕过 `<img>` 直接引用自定义协议的潜在兼容问题。

`useEffect` 卸载时调用 `URL.revokeObjectURL` 释放内存。

---

## HTML 导出（services/html-export.ts）

### 目标

把剧本 + 分镜导出成**单个自包含 HTML**：离线可开、可直接分享 / 归档。

### 关键决策

- **单文件 + base64 内嵌**：所有关键帧（含按场景时间码抓的剧本帧）读盘后转 base64 data URI 内嵌，导出物不依赖任何外部文件 / 网络。
- **数据 / 视图分离**：主进程只做数据编组，把结构化 JSON 注入页面，交由内嵌的**原生 JS**（无第三方依赖）渲染剧本 / 分镜两个视图、搜索、灯箱、主题切换。
- **内嵌客户端 JS 的硬约束**：不使用模板字符串 / 反引号 / `${`（避免与外层 TS 模板字符串冲突），全部用字符串拼接。
- **JSON 注入安全**：序列化后把 `<` 转义为 `<`，并清掉 U+2028/U+2029，避免提前结束 `<script>` 或破坏解析。
- **剧本场景截图**：剧本本身无图，导出时按每个场景 `startSec` 用 `extractFrame` 限并发（4）抓帧到临时目录，内嵌后清理。
- **表格列宽**：`table-layout:fixed` + `colgroup` 固定列宽——自动布局会把「提示词描述」压到几十像素、把「音效」撑到数百像素（单行高达 2000+px、整页超长）；固定列宽把大头给提示词描述，时码竖排三行以进一步收窄列宽。
- **主题**：默认放映厅（暗），可切剧本纸（浅）并记忆；遵守 `prefers-reduced-motion`，提供打印样式。

---

## framework-agnostic core 与 CLI（0.2.0）

### 目标

把业务逻辑从 Electron / IPC 中剥离成**单一入口**（`packages/bcc-core/src`），让 GUI 与 CLI 调用同一套核心，并可在纯 Node / 单元测试下运行。

### 分层

- `packages/bcc-core/src/pipelines/*`：三条管线纯入口 `runScript` / `runStoryboardOnce` / `runResearch`，形如 `(输入, { onProgress, signal }) → 结果`；不写 IPC、不认 jobId/WebContents。
- `packages/bcc-core/src/index.ts`：对外门面，聚合运行时注入、配置、管线、导出、存储、视频与连接测试。CLI 与测试通过这个入口调用核心。
- `apps/bcc-desktop/src/main/*`：Electron 适配层，处理窗口、IPC、宿主路径与代理，将核心进度桥接到界面。
- `apps/bcc-cli/src/*`：纯 Node 适配层。`util.parseArgs` 解析参数，装配运行时上下文后调 core，进度走 stderr、产物路径走 stdout。

### 关键决策：两处 Electron 硬依赖的切断

业务模块原本只在两处运行时依赖 Electron，均改为**注入式**，由各宿主在启动时注入：

- **数据根**：`packages/bcc-core/src/runtime.ts` 持有可注入的 `getDataRoot`。GUI 注入桌面层的 `electron-paths`（`app.getAppPath` / `userData` 解析），CLI 注入智能优先级（`--data-dir` > `BCC_DATA_DIR` > cwd > 平台 userData），测试直接 `setDataRoot(临时目录)`。`config.yaml` 始终位于数据根同级。
- **系统代理**：`gemini` 的代理解析改为注入的 `ProxyResolver`。GUI 注入 `session.resolveProxy`（读 PAC/WPAD/IE），CLI 不注入 → 回退 `HTTPS_PROXY` 环境变量。其余 service 的 `import type { WebContents }` 是类型导入，编译期擦除，运行时无 Electron 依赖。

### CLI 数据共用与代理取舍

- CLI 的 userData 兜底路径解析到与 Electron `productName` 一致的 `XLB Storyboard`，才能与安装版 GUI 真正共用 config 与项目库。
- CLI 不拉起 Electron，故无系统代理自动探测；这是「纯 Node、易测试」与「自动跟随系统代理」之间的取舍，文档已提示改用显式配置 / 环境变量。

### 风格研究更名（distillation → research）

内部命名、IPC 通道、磁盘目录、配置键统一更名；为不丢存量数据：配置旧键 `distillation:` 读时回退、保存时写 `research:`；磁盘 `distillations/` 启动时一次性迁移为 `research/`（并存时保守保留旧目录）。

### 测试

vitest 直接对 core 门面与纯入口做单元测试；`runScript` 通过注入假 `generate` / `probeVideo` 在无网络、无 ffmpeg 下验证结果结构、进度序列与取消。
