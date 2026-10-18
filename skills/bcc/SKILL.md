---
name: bcc
description: 包拆拆 skill —— 把视频拆成剧本(docx/md/html)、分镜表(xlsx/html)或风格指南(md)，与原版包拆拆功能一致。当用户提供视频文件并要求「拆剧本/生成分镜/分镜表/storyboard/风格研究/风格指南」，或提到 bcc / 包拆拆 / XLB Storyboard 时使用。自包含：CLI 已随 skill 分发且不调用任何外部模型 API，分析由你（Agent）用自己的模型完成——剧本要求模型支持原生视频输入（如 Kimi K3），分镜走切镜+关键帧管线。渐进式披露：详细规范在 references/ 下按需加载。
---

# bcc — 包拆拆（给 Agent 的自包含 skill）

本 skill 自带纯 Node CLI（`bin/bcc.cjs`，位于本 skill 目录内）：视频探测、切镜（smart/scene 多方案）、抽关键帧、成品组装（docx/xlsx/html）。**分析由你自己完成**：CLI 只做视频处理与组装，不调用任何外部模型 API。

安装：`npx skills add aixlb/bcc --skill bcc`。源码、桌面版和 npm CLI 都在同一个 MIT 仓库：https://github.com/aixlb/bcc 。DSH 用户使用独立插件：https://github.com/aixlb/dsh-bcc 。

## 渐进式披露：先读规范，再动手

**本文件只讲「是什么、怎么调 CLI」。开工前必须先读任务对应的详细规范（与本文件同目录），并严格按其执行**——那里有质量铁律与完整工作流，是产出的合格线：

| 用户要什么 | 先读 | 后执行 |
|-----------|------|--------|
| 剧本 / 台词 / 对白 | `references/script.md` | 直接看原视频 → 写剧本 md → `export script` |
| 分镜 / storyboard / 逐镜头 | `references/storyboard.md` | `shots --frames-dir` → 逐镜看关键帧 → `export storyboard` |
| 多条视频要风格 / 调性 / 指南 | `references/research.md` | 看原视频 → 直接写风格指南 md |

不相关的规范文件**不要读**，避免指令噪音。

## 前置

1. Node.js 20+（`node --version` 确认）。
2. 首次处理视频会自动下载 ffmpeg/ffprobe 到本机缓存（仅一次；进度在 stderr）。网络受限：`--ffmpeg-path`/`--ffprobe-path` 或 `HTTPS_PROXY`。
3. 模型要求：拆剧本需**原生视频输入**（如 Kimi K3）；拆分镜需**看图**。不满足就明确告知用户「当前模型无法使用此技能」，不要假装完成。

## CLI 位置与调用

CLI = SKILL.md 同级目录下的 `bin/bcc.cjs`：

```bash
BCC="/abs/path/to/skill/bin/bcc.cjs"        # bash
node "$BCC" probe ./a.mp4
```
```powershell
$BCC = "C:\abs\path\to\skill\bin\bcc.cjs"   # PowerShell
node $BCC probe .\a.mp4
```

## 机器契约（铁律）

- **stdout 只出机器结果**：`probe`/`shots`/`master --list` 出 JSON；`export` 出产物绝对路径（每行一个）；`master <id>` 出方法论文本。
- **stderr 是进度/诊断**，解析结果时忽略；**退出码** 0 成功 / 1 失败（失败信息形如 `失败: ...` / `错误: ...`）。用退出码判断成败，不解析 stderr 文案。

## 快速参考（细节以 references/*.md 为准）

```bash
node "$BCC" probe <视频>                                   # 时长/分辨率 → JSON
node "$BCC" shots <视频> --no-frames                       # 镜头时间轴（拆剧本校准用）
node "$BCC" shots <视频> --frames-dir <dir>                # 切镜+关键帧（拆分镜用）
node "$BCC" master shanzhiyin --kind script|storyboard     # 大师方法论
node "$BCC" export script --from 剧本.md --out 剧本.docx --format docx,md,html --video <视频>
node "$BCC" export storyboard --from 分镜.json --out 分镜.xlsx --format xlsx,html --video <视频>
```

## 决策提示

- 单个视频要「剧本/台词」→ script 规范；要「分镜表/storyboard」→ storyboard 规范；多条视频要「风格」→ research 规范。
- 报「下载 ffmpeg 失败」→ 设 `HTTPS_PROXY` 或传 `--ffmpeg-path`/`--ffprobe-path`。
- 报「找不到视频文件」→ 传存在的绝对路径。

完整参数表、JSON 字段、环境变量与故障排查见 **reference.md**。
