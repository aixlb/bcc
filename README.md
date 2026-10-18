# bcc · 包拆拆

把视频拆成**剧本、分镜表和风格指南**。本公开仓库包含桌面版、命令行和 Agent skill，三者共用 `bcc-core`，采用 [MIT 协议](LICENSE)。

Created by **@玩AI的小笼包**。桌面应用继续显示为 **XLB Storyboard**，保留原有应用标识与数据目录，升级后可继续使用已有配置和项目。

## 选择入口

| 入口 | 适用场景 | 获取方式 |
|---|---|---|
| 桌面版 | 预览视频、编辑剧本与分镜、导出成品 | [下载 Releases](https://github.com/aixlb/bcc/releases) |
| CLI `bcc` | 批量处理、脚本与自动化 | `npm i -g @aixlb/bcc`，需要 Node.js 20+ |
| Agent skill | 在 Agent 中分析视频，调用本地工具处理素材与导出 | `npx skills add aixlb/bcc --skill bcc` |
| DSH 插件 | 在 DSH 中使用会话模型和插件界面 | 独立仓库 [aixlb/dsh-bcc](https://github.com/aixlb/dsh-bcc) |

DSH 插件有独立的源码、构建和发布流程，不放在本仓库里。两个仓库均采用 MIT 协议。

## 能做什么

| 能力 | 流程 | 导出格式 |
|---|---|---|
| 拆剧本 | 视频 → 带时间码的剧本 | docx / md / txt / html |
| 拆分镜 | 检测镜头 → 关键帧 → 逐镜分析 | xlsx / html |
| 风格研究 | 多条视频 → 分镜分析 → 风格指南 | md / txt |

桌面版支持流式生成、剧本与视频同步预览、分镜编辑和多供应商配置。CLI 提供相同的处理管线，也提供探测、切镜、方法论和导出工具供 Agent 调用。

## 桌面版

从 [Releases](https://github.com/aixlb/bcc/releases) 下载适合平台的包。打开设置，填写模型供应商的 API Key，分别选择剧本与分镜模型，再测试连接。

桌面版支持 Gemini、Kimi、MiniMax 和自定义 OpenAI 兼容接口。桌面版代理留空时跟随系统设置；CLI 使用显式配置或 `HTTPS_PROXY` 等环境变量。

迁移保留 `appId=com.xlbstoryboard.app` 和 `productName=XLB Storyboard`，不因仓库更名改变已有用户数据位置。配置和数据的详细兼容约定见 [迁移说明](docs/MIGRATION.md)。

## CLI

```bash
npm i -g @aixlb/bcc
bcc --help
bcc config set gemini.api_key YOUR_API_KEY
bcc config test
bcc script ./a.mp4 --out 剧本.docx
bcc storyboard ./a.mp4 --out 分镜.xlsx
bcc research a.mp4 b.mp4 --out 风格指南.md
```

`--out` 按扩展名推断格式，`--format docx,md,html` 可一次导出多个格式。用 `--data-dir` 或 `BCC_DATA_DIR` 指定数据根目录；默认路径保持与原桌面版兼容。

API 管线命令会调用所配置的模型。Agent 工具命令 `probe` / `shots` / `master` / `export` 只做本地处理，由 Agent 自己的模型负责内容分析：

```bash
bcc probe a.mp4
bcc shots a.mp4 --frames-dir ./frames
bcc master --list
bcc export script --from 剧本.md --out 剧本.docx --video a.mp4
bcc export storyboard --from 分镜.json --out 分镜.xlsx --video a.mp4
```

生成管线与导出命令的 stdout 输出产物绝对路径；探测、切镜和方法论命令输出各自的 JSON 或文本结果。进度和诊断走 stderr，退出码 0 表示成功、1 表示失败。

首次处理视频时，CLI / skill 会按需解析或下载 ffmpeg、ffprobe；也可用 `--ffmpeg-path` / `--ffprobe-path` 指定现有程序。

## Agent skill

```bash
npx skills add aixlb/bcc --skill bcc
```

skill 位于 [skills/bcc](skills/bcc/SKILL.md)，随仓库提交自包含的 `bin/bcc.cjs`，无需另装 npm CLI。工作流、质量要求及 JSON 契约在 skill 的 `references/` 中按需加载。

拆剧本需要 Agent 的模型支持相应视频输入；拆分镜可用关键帧分析。skill 不替 Agent 提供模型服务。DSH 用户也可选择有独立界面的 [dsh-bcc 插件](https://github.com/aixlb/dsh-bcc)。

## 开发

需要 Node.js 20+，从仓库根目录安装和运行：

```bash
npm ci
npm run dev
npm run check
```

依赖安装时需要下载 Electron 和 ffmpeg；网络受限时为当前终端配置可用的代理后重新运行 `npm ci`。

```text
apps/
  bcc-desktop/src/       Electron 主进程、preload 与 React 界面
  bcc-cli/src/           命令行入口与命令
packages/
  bcc-core/src/          共用管线、服务、类型与导出
skills/bcc/              Agent skill 文档与自包含运行时
methods/                 剧本方法论及生成输入
scripts/                 构建、打包、发布与检查
docs/                    使用、设计、迁移与发布文档
cli-dist/                npm CLI 包，构建时生成运行文件
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动桌面开发模式 |
| `npm run check` | 类型检查、测试、桌面构建、CLI 构建、skill 构建 |
| `npm run build` | 桌面版编译到 `out/` |
| `npm run build:cli` | CLI 编译到 `out/cli/index.mjs` |
| `npm run build:skill` | 重建 `skills/bcc/bin/bcc.cjs`，随源码一起提交 |
| `npm run build:publish` | 生成 `@aixlb/bcc` npm 包到 `cli-dist/` |
| `npm run dist:win` / `npm run dist:mac` | 在对应平台打包到 `release/` |
| `npm run publish:app` | 上传当前版本桌面包到本仓库 Release |

`publish:skill` 保留为本地构建兼容命令，不再向其他仓库同步。发布步骤见 [docs/RELEASE.md](docs/RELEASE.md)，项目维护约定见 [AGENTS.md](AGENTS.md)。

默认配置示例见 [config.example.yaml](config.example.yaml)，模型列表扩展示例见 [models.example.json](models.example.json)。`config.yaml` 含 API Key，不应提交。

剧本提示词位于 `packages/bcc-core/src/services/prompt.ts`，分镜默认值位于 `packages/bcc-core/src/shared/defaults.ts`，研究提示词位于 `packages/bcc-core/src/services/research-prompt.ts`。分镜固定 JSON 契约由程序追加。

## 仓库迁移

本仓库由原 `aixlb/XLBstoryboard` 更名，保留既有 Releases 与 tag；0.4.0 将原 `v2script` 桌面 / CLI 源码和原 `bcc` skill 集中到这里，后续直接在本仓库维护。历史源码基线和旧仓库去向见 [docs/MIGRATION.md](docs/MIGRATION.md)。

## License

[MIT](LICENSE) · Copyright © 2026 aixlb / 玩AI的小笼包。
