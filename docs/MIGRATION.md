# 0.4.0 仓库迁移记录

从本次迁移起，维护两个公开 MIT 仓库：

| 仓库 | 内容与发布目标 |
|---|---|
| [aixlb/bcc](https://github.com/aixlb/bcc) | 桌面版、CLI、bcc-core、Agent skill；桌面包发本仓库 Releases，CLI 发 npm `@aixlb/bcc` |
| [aixlb/dsh-bcc](https://github.com/aixlb/dsh-bcc) | 独立 DSH 插件，使用 DSH 会话模型及插件界面，独立构建与发布 |

## 源码来源

| 原仓库 | 本次导入基线 | 处理方式 |
|---|---|---|
| `aixlb/v2script` | `ba6b8658517c370827a79dc84920bdf62e784250` | 以当前源码快照导入；私有历史留在原仓库，不把其完整历史加入公开仓库 |
| 原 skill 仓库 `aixlb/bcc` | `682d912c5c9041bd35b1da12f614f74f624019fb` | skill 文档与自包含分发方式并入主仓库 `skills/bcc/`；原独立仓库让出 `bcc` 名称后留作历史备份 |
| `aixlb/XLBstoryboard` | 原有公开发布仓库 | 在原仓库上更名为 `bcc`，保留 Releases、附件、Issues 与原 tag |
| `aixlb/dsh-bcc` | 原插件仓库 | 保持独立仓库，公开源码并采用 MIT 协议 |

不改写原桌面发布 tag，不用本次快照覆盖旧发布代码。仓库更名后，维护文档和新发布使用 `aixlb/bcc` 链接；已有下载资产继续保留在同一个 GitHub 仓库中。

## 新目录

| 旧目录 | 新目录 |
|---|---|
| `src/main/`、`src/preload/`、`src/renderer/` | `apps/bcc-desktop/src/main/`、`preload/`、`renderer/` |
| `src/cli/` | `apps/bcc-cli/src/` |
| `src/core/` | `packages/bcc-core/src/` |
| `src/main/services/` 中的共用服务 | `packages/bcc-core/src/services/` |
| `src/shared/` | `packages/bcc-core/src/shared/` |
| `skills/bcc/` | 保留，包含文档、references 和自包含 `bin/bcc.cjs` |

Electron 生命周期、IPC 和宿主适配仍在桌面应用层；媒体、供应商调用、存储、管线与导出归核心层。命令继续从仓库根目录执行。

## 保持的外部契约

- 桌面 `appId` 仍为 `com.xlbstoryboard.app`，`productName` 仍为 `XLB Storyboard`，原配置和用户数据路径继续使用，不因仓库改名搬迁数据。
- CLI 包名仍为 `@aixlb/bcc`，命令仍为 `bcc`，现有参数和项目数据格式继续兼容。
- Agent skill 名称仍为 `bcc`，通过 `npx skills add aixlb/bcc --skill bcc` 安装。随源码提交 `skills/bcc/bin/bcc.cjs`，无需安装 npm CLI。
- 共用核心不依赖 Electron / React 运行时，桌面版与 CLI 继续调用相同业务管线。
- DSH 插件有自己的发布版本和宿主适配，不因主仓库迁移而并入桌面 / CLI 的构建。

## 发布方式变化

原来由私有 `v2script` 向 skill 仓库和桌面发布仓库同步产物；现在直接在公开 `bcc` 开发和发布。`publish:skill` 仅保留本地构建兼容入口，`publish:app` 指向当前 `aixlb/bcc`。日常 CI 由本仓库 push / PR 触发，手动平台构建不再依赖跨仓库 token。

完整检查命令为 `npm run check`，包含类型检查、单元测试、桌面版、CLI 与 skill 构建。0.4.0 是该目录布局的首版，新的源码、CLI 与 skill 版本统一为 0.4.0。

`docs/包拆拆-*.md` 及旧 CHANGELOG 条目保留当时版本的设计、审查和路径描述，作为历史资料。当前目录、开发命令和发布方式以根 README、AGENTS.md 及 [RELEASE.md](RELEASE.md) 为准。
