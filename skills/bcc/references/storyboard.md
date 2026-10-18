# 拆分镜详细规范（执行「拆分镜」任务前必读）

> 加载时机：用户要求「分镜 / 分镜表 / storyboard / 逐镜头」时，先完整读本文件再开始。
> 本规范优先于大师方法论；方法论只作分析深度参考。

## 管线（与原版包拆拆一致）

**切镜（多方案）→ 视频转关键帧 → 逐镜看关键帧分析 → 组装 xlsx/html。**

### 第 1 步：切镜 + 视频转关键帧

```bash
node "$BCC" shots <视频> --frames-dir <工作目录>/frames
```

stdout JSON：`{"video","durationSec","method","framesDir","shots":[{"index","startSec","endSec","thumbT","score","kind","frame"}]}`。
`frame` 是该镜关键帧绝对路径（smart 已避开转场白/黑帧）。

**切镜方案（与原版一致）**：

- `smart`（默认，推荐）：硬切/白黑场/擦除锋面/叠化 四检测器混合 + 长镜头覆盖补帧。
  - `--hard-min`（默认 5.5）：硬切最低帧差，**调低更敏感**；
  - `--hard-ratio`（默认 8）：× 局部中位数倍率，排除运镜误报；
  - `--min-gap`（默认 0.3 秒）：切点最小间隔，动画/快切调 0.1~0.15。
- `scene`：经典帧差阈值法，`--threshold`（默认 0.3）。

**切镜效果检查**：切太碎（一个动作拆成好几镜）→ 调大 `--min-gap` / 调高 `--hard-min`；切太粗（明显转场没切开）→ 反向调。调整后重跑 shots 即可。

### 第 2 步：取分镜大师方法论（可选但推荐）

```bash
node "$BCC" master shanzhiyin --kind storyboard > master-method.md
```

### 第 3 步：逐镜分析（核心）

**每镜必看其关键帧**（`frame`），按顺序逐镜识别，写 `分镜.json`：

- **完整性**：shots 输出多少镜，JSON 里就必须有多少条；`number` 从 1 连续到 N；`startSec`/`endSec` 沿用 shots 输出。
- **有原生视频能力（如 K3）时**：另按每镜 `startSec~endSec` 时间段看原视频，核对运镜方式与动作连续性（关键帧是单帧，运镜靠视频段判断最准）；台词/音效也可从视频段听出。
- 字段填写规范：

| 字段 | 填写规范 |
|------|----------|
| `shotType` | 只允许：特写 / 近景 / 中景 / 全景 / 大全景 / 远景（人物占画面比例判断） |
| `angle` | 平视 / 俯视 / 仰视 / 顶拍 / 低角度 等 |
| `cameraMove` | 固定 / 推 / 拉 / 摇 / 移 / 跟 / 手持 / 升降 等（看视频段判断，单帧无法确定时选最可能） |
| `description` | **固定七行**，每行一个维度，逐行写具体内容，禁止"无""常规"敷衍：<br>①画面主体：谁/什么在画面中心<br>②人物动作与表情<br>③环境与背景<br>④光线与色彩<br>⑤构图与景深<br>⑥道具细节<br>⑦风格与氛围 |
| `dialogue` | 该镜内出现的台词原文；没有则空字符串 |
| `sound` | 音效/音乐/环境声；没有则空字符串 |
| `frame` | 沿用 shots 输出的该镜关键帧路径（缺了且给 `--video` 时 CLI 会自动补） |

### 第 4 步：组装

```bash
node "$BCC" export storyboard --from 分镜.json --out 分镜.xlsx --format xlsx,html --video <视频>
```

xlsx 列：镜号/景别/角度/运镜/关键帧(嵌图)/时长/提示词描述/台词/音效。html 是带缩略图的可视化分镜表。

## 分镜 JSON schema

数组，或 `{"shots":[...],"durationSec":123.4}` 包一层：

```json
[
  {
    "number": 1,
    "shotType": "近景",
    "angle": "平视",
    "cameraMove": "固定",
    "description": "画面主体：…\n人物动作与表情：…\n环境与背景：…\n光线与色彩：…\n构图与景深：…\n道具细节：…\n风格与氛围：…",
    "dialogue": "台词",
    "sound": "音效/音乐",
    "startSec": 0,
    "endSec": 8.53,
    "frame": "C:\\...\\frame_00000100.jpg"
  }
]
```

## 自查清单（交付前逐条核对）

- [ ] 镜数 = shots 输出的镜数，编号连续无缺；
- [ ] 每镜七个字段都填了（允许空字符串的只有 dialogue/sound/frame）；
- [ ] shotType 用词在六个档位内；
- [ ] description 是七行、每行有具体内容；
- [ ] 运镜类字段与视频实际一致（看视频段核对过）。
