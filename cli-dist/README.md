# bcc — 包拆拆命令行

把视频转成**剧本**(docx/md/html)、**分镜表**(xlsx/html)或**风格指南**(md)的纯 Node 命令行。两种用法：配 API Key 全自动跑，或作为 Agent skill 的无模型工具链（`npx skills add aixlb/bcc`）。

## 安装

```bash
npm i -g @aixlb/bcc      # 需 Node 20+；命令名为 bcc
```

> 若你的 npm 用的是国内镜像、提示找不到包，直连官方源安装：
> `npm i -g @aixlb/bcc --registry https://registry.npmjs.org/`

首次处理视频时，bcc 会按平台自动下载 ffmpeg/ffprobe 到本机缓存（仅一次，进度在 stderr）。
网络受限时可 `--ffmpeg-path` / `--ffprobe-path` 指定已有二进制，或设 `HTTPS_PROXY`。

## 用法（API 模式：配 Key 全自动）

```bash
bcc config set gemini.api_key sk-xxxx   # 配置 API Key（申请: https://aistudio.google.com/apikey）
bcc config test                         # 测试连接
bcc script ./a.mp4 --out 剧本.docx       # 拆剧本（--format docx,md,html）
bcc storyboard ./a.mp4 --out 分镜.xlsx   # 拆分镜（--format xlsx,html）
bcc research a.mp4 b.mp4 --out 风格指南.md  # 风格研究（或 --input-dir ./clips）
bcc --help
```

## Agent 模式（分析由 Agent 自己的模型完成）

Agent 模式的以下命令不调用模型 API，只做视频处理与成品组装；内容分析由 Agent 用自己的模型完成（拆剧本需要相应视频输入能力）：

```bash
bcc probe <video>                             # 视频技术参数 → stdout JSON
bcc shots <video> --no-frames                 # 镜头时间轴 → stdout JSON
bcc shots <video> --frames-dir ./frames       # 切镜 + 逐镜关键帧 → stdout JSON
bcc master --list                             # 列出方法论
bcc master <id>                               # 输出指定方法论文本
bcc export script --from 剧本.md --out 剧本.docx --video a.mp4
bcc export storyboard --from 分镜.json --out 分镜.xlsx --video a.mp4
```

完整工作流、质量规范与 JSON 契约见主仓库的 [skills/bcc](https://github.com/aixlb/bcc/tree/main/skills/bcc)。使用 `npx skills add aixlb/bcc --skill bcc` 安装 skill；自包含运行时随主仓库提交，无需另装 npm CLI。DSH 插件在独立 [dsh-bcc 仓库](https://github.com/aixlb/dsh-bcc) 维护。

## 对接约定（脚本/Agent）

- 管线与导出命令的 stdout 输出产物**绝对路径**（每行一个）；`probe` / `shots` 输出 JSON，`master` 输出方法论文本或清单。
- stderr 是进度与诊断，退出码 0 成功 / 1 失败；`--quiet` 可减少进度输出。
- 数据根用 `--data-dir <dir>` 或 `BCC_DATA_DIR` 指定。

## 源码与许可

[aixlb/bcc](https://github.com/aixlb/bcc) 同时包含桌面版、CLI、共用核心和 Agent skill，采用 [MIT 协议](https://github.com/aixlb/bcc/blob/main/LICENSE)。
