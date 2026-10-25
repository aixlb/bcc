# 模型配置与维护

模型与官方 ID 核对日期：2026-10-25。已有配置继续使用保存的模型，本次不自动改选。

| 模型 | API 模型 ID | 包拆拆输入方式 |
|---|---|---|
| [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon) | `gemini-4-argon` | 剧本使用视频；分镜与风格研究使用图片 |
| [DeepSeek V4.1 Flash 1017](https://api-docs.deepseek.com/) | `deepseek-flash` | 剧本采样关键帧；分镜与风格研究使用图片 |
| [Kimi K3.1 Pro](https://platform.kimi.com/docs/models) | `kimi-k3.1-pro` | 剧本上传视频；分镜与风格研究使用图片 |

`deepseek-flash` 是官方滚动别名，当前服务 1017 版本，不能用它锁定未来仍是这个快照。旧名 `deepseek-v4-flash-vision-exp` 已转向当前模型，不再作为新配置推荐。

## 桌面版与 CLI

桌面版在「设置 → API 配置」的 Gemini / Kimi 模型下拉选择新模型，也可直接输入完整模型 ID。DeepSeek 使用「自定义供应商 → 添加 DeepSeek」模板，填入 Key 后保存，再到「功能配置」选作剧本、分镜或风格指南合成的供应商。

DeepSeek 的拆剧本输入选「关键帧图片」。当前每段视频最多采样 24 张图，无音频，不能据此恢复画外对白；需要字幕或另行提供台词。

CLI 可直接改模型，不依赖下拉清单：

```bash
bcc config set gemini.model gemini-4-argon
bcc config set kimi.model kimi-k3.1-pro
bcc config path
```

DeepSeek 在 `config.yaml` 中配置如下（与其他配置合并，填入自己的 Key）：

```yaml
custom_providers:
  - id: deepseek
    name: DeepSeek V4.1 Flash 1017
    api_key: ""
    base_url: https://api.deepseek.com/v1
    model: deepseek-flash
    script_input: frames
script_provider: deepseek
storyboard_provider: deepseek
research:
  synthesis_provider: deepseek
```

自定义供应商的 `script_input` 只控制拆剧本的输入：`frames` 为关键帧图片，`video` 为内联视频。旧配置未填时继续按 `video` 处理。分镜与风格合成原本就使用图片。

## 后续新增模型改哪里

使用者无需重新发版：把 [models.example.json](../models.example.json) 复制为 `models.json`，放在 `bcc config path` 显示的 `config.yaml` 旁边。修改后重新打开设置页，会按模型 ID 新增预设或覆盖显示名称与说明，保留内置项。这个文件只管下拉显示，实际调用取决于保存的模型配置。

仓库维护者统一编辑 [model-catalog.json](../packages/bcc-core/src/shared/model-catalog.json)：

| 字段 | 用途 |
|---|---|
| `presets` | 各内置供应商的模型 ID、显示名和说明 |
| `defaults` | 新配置和缺失值的默认模型；不覆盖已有配置 |
| `providerTemplates` | OpenAI 兼容供应商的地址、模型、剧本输入方式；不含 Key |
| `openaiRequestRules` | 按模型 ID 匹配的请求参数，剧本、分镜与风格合成共用；按顺序取第一条匹配 |

修改内置目录后正常构建和发布即可，核心、CLI 和桌面界面从同一个目录读取。新增供应商模板也只需改此 JSON，随后会出现在设置页。

同协议下新增模型通常只改配置；若厂商改变文件上传协议、鉴权或请求格式，仍需改适配代码。目录中的规则仅用于已支持的 OpenAI 兼容请求，不能把不同协议自动转换。

## DSH 插件

DSH 插件在 [aixlb/dsh-bcc](https://github.com/aixlb/dsh-bcc) 维护。它使用 DSH 当前会话的模型与凭据，在 DSH 的模型设置里添加或选择上述模型，并确认输入能力含 `image`。插件用关键帧分析，不依赖模型名中包含 `vision`；以后 DSH 已支持的新图片模型无需再修改插件。
