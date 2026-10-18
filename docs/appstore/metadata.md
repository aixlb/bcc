# App Store Connect 上架资料（可直接复制粘贴）

应用：**包拆拆 / XLB Storyboard** ｜ 免费、无内购、无广告
Bundle ID：`com.xlbstoryboard.app` ｜ 主分类：视频（Video）｜ 次分类（可选）：效率（Productivity）
年龄分级：**4+** ｜ 版权：`© 2026 XLB Storyboard`

> 价格层级（Pricing）选 **Free**，销售范围（Availability）选 **所有国家/地区**。
> App 内不含内购（IAP），无需填写订阅/付费项。

---

## 一、中文（简体）—— 主语言 zh-Hans

**App 名称（≤30 字符）**
```
包拆拆 - 视频转剧本分镜
```

**副标题（≤30 字符）**
```
AI 把视频拆成剧本与分镜表
```

**宣传文本 Promotional Text（≤170 字符）**
```
导入一段视频，AI 自动拆出逐场剧本与带关键帧的分镜表，还能跨多条视频研究风格。自带 API Key，数据全程留在本机。
```

**描述 Description（≤4000 字符）**
```
包拆拆（XLB Storyboard）是一款面向创作者的视频拆解工具：导入一段视频，借助 AI 自动生成逐场剧本与带关键帧的分镜表，帮你快速读懂一条片子的结构与节奏。

主要功能
• 视频转剧本：自动识别画面与台词，输出分场次的文字剧本。
• 分镜表生成：基于镜头切换抽取关键帧，生成图文对照的分镜表。
• 风格研究：导入多条同类视频，提炼共同的镜头语言与风格要点，形成风格指南。
• 长视频处理：超长视频自动分段，本地用 ffmpeg 切片与压缩，省时省流量。
• 导出：剧本可导出 Word，分镜表可导出 Excel，方便交付与二次创作。

关于 AI 与你的密钥
• 应用本身不内置、不代付任何 AI 服务。你需要自备所选服务商（如 Google Gemini、Kimi 或自定义兼容接口）的 API Key。
• API Key 与所有项目数据只保存在你本机的应用沙盒目录中，开发者不收集、不上传。
• 仅在你发起分析时，应用会把相应的视频帧/片段发送到你所配置的 AI 服务商进行处理；是否使用、用哪家，完全由你决定。

适合谁
• 短视频/影视剪辑、编导、内容运营，需要快速拆解参考片、整理分镜与文案的人。

包拆拆完全免费，无内购、无广告。
```

**关键词 Keywords（≤100 字符，英文逗号分隔）**
```
视频,分镜,剧本,storyboard,分镜表,拉片,脚本,AI,视频分析,关键帧,短视频,剪辑
```

**What's New（本版本更新，首版可写）**
```
首个版本：视频转剧本、分镜表生成、风格研究、Word/Excel 导出。
```

---

## 二、English（en-US）

**App Name (≤30)**
```
XLB Storyboard - Video to Script
```

**Subtitle (≤30)**
```
AI script & storyboard from video
```

**Promotional Text (≤170)**
```
Import a video and let AI break it into a scene-by-scene script and a keyframe storyboard. Bring your own API key; your data stays on your Mac.
```

**Description (≤4000)**
```
XLB Storyboard turns a video into a structured script and a keyframe storyboard, so you can quickly understand how a clip is built.

Features
• Video to script: detects shots and dialogue, outputs a scene-by-scene written script.
• Storyboard: extracts keyframes at shot changes and builds an image-plus-text storyboard.
• Style research: feed multiple similar videos to distill a shared visual-style guide.
• Long videos: automatically segmented and compressed locally with ffmpeg.
• Export: scripts to Word, storyboards to Excel.

About AI and your key
• The app ships no built-in or paid AI service. You provide your own API key for a provider you choose (e.g. Google Gemini, Kimi, or a custom compatible endpoint).
• Your API key and all project data are stored only in the app's local sandbox container. The developer collects nothing.
• Only when you start an analysis does the app send the relevant video frames/segments to the AI provider you configured.

XLB Storyboard is completely free — no in-app purchases, no ads.
```

**Keywords (≤100)**
```
storyboard,video,script,screenplay,shot list,keyframe,AI,video analysis,editing,filmmaking
```

**What's New**
```
First release: video-to-script, storyboard generation, style research, Word/Excel export.
```

---

## 三、必填 URL（你需要提供可访问的网址）

仓库已内置一页同时覆盖「支持」与「隐私政策」的静态页：`docs/index.html`。若需要独立网页，可在 `aixlb/bcc` 的 Settings → Pages 选择 `Deploy from a branch`、`main` 分支和 `/docs`，部署后确认页面可访问，再将部署地址用于 App Store Connect。本次源码迁移不会自动开启 Pages。

| 字段 | 直接填 |
|------|------|
| **Support URL**（必填） | `https://github.com/aixlb/bcc/issues` |
| **Privacy Policy URL**（必填） | `https://github.com/aixlb/bcc/blob/main/docs/appstore/PRIVACY_POLICY.md`，或确认可访问后的独立政策页面 |
| Marketing URL（可选） | `https://github.com/aixlb/bcc` |

---

## 四、App 隐私（App Privacy 问卷）答案

依据本应用实际行为（开发者不收集任何数据；AI 调用由用户自带 Key 发起、数据不经开发者服务器）：

- **Do you or your third-party partners collect data from this app?** → **No, we do not collect data**（不收集）。
  - 理由：API Key 与项目数据仅存本机沙盒；无埋点、无分析 SDK；视频帧仅按用户操作直连用户自选的 AI 服务商，不经开发者。
- 如审核追问第三方 AI：在隐私政策中已说明“用户自备密钥、数据直连用户所选服务商、开发者不接触”。

## 五、出口合规（Export Compliance）

已在打包配置写入 `ITSAppUsesNonExemptEncryption = false`（仅使用 HTTPS 等豁免类加密），上架时该项无需再手动回答，不需提交加密文档。

## 六、截图（你需要补；我无法自动生成合规截图）

App Store 要求 macOS 截图，尺寸任选其一并保持一致：
- 1280×800、1440×900、2560×1600、2880×1800（16:10）。
建议：打开应用，截 3~5 张代表性界面（导入视频、剧本结果、分镜表、风格研究、导出）。
