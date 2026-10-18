# 包拆拆 / XLB Storyboard 用户手册

> 适用版本：0.4.0（保留原有桌面交互与数据位置）
> 完整在线手册：包拆拆用户手册（飞书）— https://nepelfbn8c.feishu.cn/wiki/HV1twBUy6il5CVkcNxscJbFGnAd

「包拆拆」是一款把视频拆成**剧本**与**分镜**的桌面工具（Electron）。本手册随每次版本合并更新，记录当前版本的使用方式。

公开仓库现为 [aixlb/bcc](https://github.com/aixlb/bcc)，桌面安装包在本仓库 Releases，CLI 仍为 npm `@aixlb/bcc`。Agent skill 通过 `npx skills add aixlb/bcc --skill bcc` 安装；DSH 插件在独立 [dsh-bcc](https://github.com/aixlb/dsh-bcc) 维护。迁移不改变原桌面应用名称和用户数据位置。

## 1. 准备

1. 打开「设置」，填入所用模型的 API Key（剧本 / 分镜可分别选用不同 provider：Gemini / Kimi / MiniMax-M3 / 自定义 OpenAI 兼容供应商）。
2. 没有 Key 时对应的「拆剧本 / 拆分镜」按钮会被禁用。

## 2. 拆剧本

1. 新建项目并选择视频。
2. 点「拆剧本」，等待生成；生成的剧本可在剧本编辑器内查看、编辑。
3. 剧本按 `[HH:MM:SS]` 场景头部带时间码，可与视频同步预览。

## 3. 拆分镜

1. 在项目内点「拆分镜」。流程为：检测镜头切点 → 先落「截图 + 时间」占位 → AI 后台异步补全景别 / 角度 / 运镜 / 七段式提示词描述 / 台词 / 音效。
2. 等 AI 全部识别完成后，可在「帧差异值」曲线上点击切点查询并定位；在空白处右键新增切点，在已有切点上右键精确调整或删除。首帧切点不能移动或删除，人工切点没有 0.4 秒间隔限制。
3. 人工切点会在重新切割或切换切割方式后保留。移动切点时，右侧分镜若已人工编辑会保留内容；未编辑的分镜会自动重识别，显式点「重新识别」则允许覆盖。

## 4. 导出

项目顶部操作栏提供三种导出（按项目是否有剧本 / 分镜显示）：

| 按钮 | 产物 | 说明 |
|---|---|---|
| 导出剧本 | `.docx` | Word 剧本 |
| 导出分镜表 | `.xlsx` | Excel 分镜表（含关键帧图片） |
| 导出网页 | `.html` | 剧本 + 分镜合一的**可交互单文件网页** |

### 4.1 导出网页（HTML）

生成**单个自包含、离线可用**的 HTML，关键帧已内嵌，可直接发给他人或归档。用浏览器打开后：

| 操作 | 说明 |
|---|---|
| 顶部「剧本 / 分镜」标签 | 切换两个视图 |
| 左侧时码脊 | 点场次跳转，滚动时高亮当前场景 |
| 顶部搜索框 | 实时过滤场景 / 镜头 / 台词 |
| 分镜「卡片 / 表格」切换 | 表格适合通览，卡片适合逐镜看图 |
| 点关键帧 | 放大灯箱，`←/→` 翻页、`Esc` 关闭 |
| 「剧本纸 / 放映厅」 | 浅色 / 深色主题切换（会记忆） |
| 「打印」 | 调系统打印，可存为 PDF |

> 只拆了剧本时，导出会按每个场景的时间码从源视频抓取关键帧嵌入剧本视图，因此剧本页也有截图。

## 5. 导入

支持把已有剧本（`.md`）或分镜目录导入为项目，便于二次编辑与导出。

## 6. 命令行（CLI · bcc）

除桌面界面外，0.2.0 起提供命令行工具 `bcc`（纯命令行，不弹窗），与桌面端**共用同一份配置与项目库**，适合批处理 / 脚本 / 远程服务器。

构建：`npm run build:cli`（产物 `out/cli/index.mjs`，可全局安装为 `bcc`）；开发期也可直接 `node out/cli/index.mjs ...`。

```bash
# 设置（API Key / 模型 / 代理）——密钥显示会自动脱敏
bcc config set gemini.api_key sk-xxxx
bcc config list
bcc config test                      # 测试当前 provider 连接

# 拆剧本（默认导出 Word；可一次出多种）
bcc script ./访谈.mp4 --out 剧本.docx
bcc script ./访谈.mp4 --format docx,md,html

# 拆分镜（默认导出 Excel）
bcc storyboard ./访谈.mp4 --out 分镜.xlsx --format xlsx,html

# 风格研究（多视频 → 风格指南 Markdown）
bcc research a.mp4 b.mp4 --out 风格指南.md
bcc research --input-dir ./clips --out 风格指南.md
```

- **输入**：可直接给视频文件路径，也可给已存在项目的 `projectId`。
- **输出**：`--out` 按扩展名决定格式；`--format a,b` 一次导出多种。剧本支持 docx/md/txt/html，分镜支持 xlsx/html，研究支持 md/txt。
- **数据位置**：默认与桌面版共用；可用 `--data-dir <目录>` 或环境变量 `BCC_DATA_DIR` 指定。
- **代理**：命令行不做系统代理自动探测，请用 `bcc config set gemini.proxy http://127.0.0.1:7890` 或设置 `HTTPS_PROXY` 环境变量。
- 进度信息打印在 stderr，最终产物路径打印在 stdout（方便脚本捕获）。`bcc --help` 查看完整用法。
