# AGENTS.md

本文件是 `aixlb/bcc` 的项目级维护规则。`CLAUDE.md` 仅链接本文件，不另存一份规则。

## 仓库边界

- `bcc` 是公开 MIT 源码仓库，包含桌面版、CLI、共用核心和 Agent skill。
- DSH 插件在独立公开 MIT 仓库 `aixlb/dsh-bcc` 维护；不要在这里恢复一份插件源码。
- 原 `v2script` 私有源码仓库和独立 skill 仓库停止作为编辑源，不再跨仓库同步。
- 迁移基线、历史保留及兼容约定以 [docs/MIGRATION.md](docs/MIGRATION.md) 为准；发布流程以 [docs/RELEASE.md](docs/RELEASE.md) 为准。

## 结构与职责

| 目录 | 职责 |
|---|---|
| `apps/bcc-desktop/src/` | Electron 主进程、preload、React 界面，适配核心事件与 IPC |
| `apps/bcc-cli/src/` | 纯 Node CLI，解析参数并调用核心 |
| `packages/bcc-core/src/` | 共用管线、运行时、配置、供应商、媒体处理、导出及 shared 契约 |
| `skills/bcc/` | skill 源文档及随版本提交的 `bin/bcc.cjs` |
| `methods/` | 方法论源文档，生成压缩运行时数据 |
| `scripts/` | 构建、打包、发布及冒烟检查 |
| `cli-dist/` | npm 包 README / 配置与 `build:publish` 生成的发布文件 |

业务能力优先放进 `bcc-core`，桌面层与 CLI 层只做宿主适配。核心不得引入 Electron / React 运行时依赖。共享类型和默认值集中维护。

## 兼容约定

- 桌面版 `appId=com.xlbstoryboard.app`、`productName=XLB Storyboard` 保持不变，保留原配置、用户数据与安装身份。更名仓库不等于更名应用数据目录。
- npm 包名保持 `@aixlb/bcc`，命令保持 `bcc`。
- 管线与导出命令的 stdout 输出产物绝对路径；`probe` / `shots` / `master` 按命令契约输出 JSON 或文本。进度和诊断走 stderr，退出码 0/1。
- 原桌面 Releases 与 tag 保留原样，不用新的源码快照覆盖旧 tag。
- skill 保持自包含。改 CLI / 核心后执行 `npm run build:skill`，将更新后的 `skills/bcc/bin/bcc.cjs` 与源码一起提交。
- 修改 `methods/` 或大师清单后执行 `npm run gen:masters`，更新 `packages/bcc-core/src/shared/masters-{meta,data}.ts`；生成文件不手改。仓库中的方法论源可公开，运行产物沿用压缩嵌入方式。

## 开发与验证

```bash
npm ci
npm run dev
npm run check
```

开发与打包使用 Node.js 24 LTS；发布 CLI / skill 的运行时仍支持 Node.js 20+。所有命令从仓库根目录运行。`check` 包含类型检查、测试、桌面构建、CLI 构建和 skill 构建。只对实际改动运行相称检查；发布前执行完整检查和目标平台包内冒烟测试。

不要提交 `config.yaml`、API Key、签名凭据、`node_modules/`、`out/`、安装包及临时检查文件。`skills/bcc/bin/bcc.cjs` 是有意提交的分发产物。

## 发布

本仓库直接发布桌面 Release 与 skill；CLI 发布到 npm。`publish:skill` 是本地 `build:skill` 的兼容入口，无远端推送。`publish:app` 指向当前 `aixlb/bcc` Release。

CI 在本仓库 push / pull request 上验证；手动 Windows / macOS 构建使用当前仓库的 `GITHUB_TOKEN`，无需跨仓库 `RELEASE_TOKEN`。安装依赖使用 `npm ci`。
