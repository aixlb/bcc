/**
 * 导出「剧本 + 分镜」为单个自包含、可交互的 HTML 文件。
 *
 * 设计取向（frontend-design + taste-skill）：
 *   把这份产物读作「给创作者复盘 AI 拆解结果的放映厅式阅读器」——
 *   暗色剪辑台基调，签名元素是「带齿孔的胶片时码脊」+ 全等宽时码体系，
 *   单一琥珀安全灯强调色全程锁定，提供「剧本纸」浅色切换，遵守 prefers-reduced-motion。
 *
 * 实现要点：
 *   - 关键帧以 base64 data URI 内嵌，保证单文件离线可携带。
 *   - 数据序列化为 JSON 注入，页面用原生 JS 渲染（无外部依赖，离线可用）。
 *   - 内嵌的客户端 JS 刻意不使用模板字符串/反引号/`${`，以免与外层 TS 模板冲突。
 */
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ScriptScene, StoryboardShot } from '@shared/types'
import { isStructuredStoryboardDescription } from '@shared/defaults.js'

export interface HtmlExportInput {
  /** 项目显示名 */
  projectName: string
  /** 源视频文件名（可空） */
  videoName: string
  /** 视频总时长（秒，0 表示未知） */
  durationSec: number
  /** 视频技术参数（已格式化为展示字符串；无视频时为 undefined） */
  videoMeta?: {
    resolution: string
    fps: string
    bitrate: string
    size: string
    codec: string
  }
  /** 解析后的剧本场景（可空数组表示无剧本） */
  scenes: ScriptScene[]
  /** 分镜镜头（可空数组表示无分镜） */
  shots: StoryboardShot[]
  /** 与 shots 对齐的关键帧绝对路径 */
  framePaths: string[]
  /** 与 scenes 对齐的「剧本场景关键帧」绝对路径（按场景时间码抓帧；缺省/越界为无） */
  sceneFramePaths?: string[]
  /** 生成时间戳（ms），由调用方传入以保证可复现 */
  generatedAt: number
}

type ScriptLine =
  | { t: 'action'; s: string }
  | { t: 'present'; s: string }
  | { t: 'cue'; s: string }
  | { t: 'dialogue'; c: string; tag: string; s: string }
  | { t: 'text'; s: string }

interface SceneData {
  number: string
  heading: string
  startSec: number
  timecode: string
  lines: ScriptLine[]
  /** 该场景的关键帧 data URI（按时间码抓帧），无则为 null */
  frame: string | null
}

interface ShotData {
  number: number
  shotType: string
  angle: string
  cameraMove: string
  description: string
  descriptionLegacy: boolean
  dialogue: string
  sound: string
  startSec: number
  timeRange: string
  /** 起始时间码 HH:MM:SS（表格内竖排展示用） */
  tcStart: string
  /** 结束时间码 HH:MM:SS */
  tcEnd: string
  frame: string | null
}

function formatHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(ss)}`
}

/** 解析一条场景正文为带语义的行 token（沿用 docx 导出的行约定） */
function parseSceneLines(body: string): ScriptLine[] {
  // body 第一行是场景头部，正文从第二行开始
  const raw = body.split('\n').slice(1)
  const lines: ScriptLine[] = []
  for (const line of raw) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('△')) {
      lines.push({ t: 'action', s: trimmed.replace(/^△\s*/, '') })
    } else if (trimmed.startsWith('人物：') || trimmed.startsWith('人物:')) {
      lines.push({ t: 'present', s: trimmed.replace(/^人物[：:]\s*/, '') })
    } else if (trimmed.startsWith('【字幕') || trimmed.startsWith('【闪回')) {
      lines.push({ t: 'cue', s: trimmed })
    } else {
      const m = trimmed.match(/^([^：:]{1,12}?)([vV][oO]|[oO][sS])?[：:](.*)$/)
      if (m && m[3] !== undefined) {
        lines.push({
          t: 'dialogue',
          c: m[1].trim(),
          tag: (m[2] || '').toUpperCase(),
          s: m[3].trim(),
        })
      } else {
        lines.push({ t: 'text', s: trimmed })
      }
    }
  }
  return lines
}

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'image/jpeg'
  }
}

async function frameToDataUri(framePath: string): Promise<string | null> {
  try {
    if (!framePath || !existsSync(framePath)) return null
    const buf = await fs.readFile(framePath)
    const ext = path.extname(framePath).slice(1)
    return `data:${mimeFor(ext)};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 生成完整的自包含 HTML 字符串 */
export async function generateProjectHtml(input: HtmlExportInput): Promise<string> {
  // 剧本场景关键帧（按场景时间码抓帧）并发转 base64
  const sceneFrames = await Promise.all(
    input.scenes.map((_, i) => frameToDataUri((input.sceneFramePaths || [])[i] || ''))
  )

  const scenes: SceneData[] = input.scenes.map((sc, i) => ({
    number: sc.number || '',
    heading: sc.heading || '',
    startSec: sc.startSec || 0,
    timecode: formatHMS(sc.startSec || 0),
    lines: parseSceneLines(sc.body || ''),
    frame: sceneFrames[i],
  }))

  // 分镜关键帧并发转 base64
  const frames = await Promise.all(input.shots.map((_, i) => frameToDataUri(input.framePaths[i])))

  const shots: ShotData[] = input.shots.map((shot, i) => {
    const nextSec =
      i < input.shots.length - 1 ? input.shots[i + 1].startSec : input.durationSec || shot.endSec
    return {
      number: shot.number,
      shotType: shot.shotType || '',
      angle: shot.angle || '',
      cameraMove: shot.cameraMove || '',
      description: shot.description || '',
      descriptionLegacy: !!shot.description && !isStructuredStoryboardDescription(shot.description),
      dialogue: shot.dialogue || '',
      sound: shot.sound || '',
      startSec: shot.startSec || 0,
      timeRange: `${formatHMS(shot.startSec || 0)} - ${formatHMS(nextSec || shot.startSec || 0)}`,
      tcStart: formatHMS(shot.startSec || 0),
      tcEnd: formatHMS(nextSec || shot.startSec || 0),
      frame: frames[i],
    }
  })

  const vm = input.videoMeta
  const data = {
    meta: {
      projectName: input.projectName || '未命名项目',
      videoName: input.videoName || '',
      durationSec: input.durationSec || 0,
      duration: input.durationSec ? formatHMS(input.durationSec) : '',
      resolution: vm?.resolution || '',
      fps: vm?.fps || '',
      bitrate: vm?.bitrate || '',
      size: vm?.size || '',
      codec: vm?.codec || '',
      generatedAt: input.generatedAt,
      sceneCount: scenes.length,
      shotCount: shots.length,
    },
    scenes,
    shots,
  }

  // 防止数据中的 </script> / < 提前终止脚本块
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ' ')
  const safeTitle = escapeHtml(data.meta.projectName)

  return buildDocument(safeTitle, json)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 页脚链接：包拆拆用户手册 */
const MANUAL_LABEL = '包拆拆用户手册'
/** 用户手册地址；为空则只显示文字不带链接 */
const MANUAL_URL = 'https://nepelfbn8c.feishu.cn/wiki/HV1twBUy6il5CVkcNxscJbFGnAd?from=from_copylink'

function creditHtml(): string {
  const label = escapeHtml(MANUAL_LABEL)
  if (MANUAL_URL) {
    return `<a class="credit-link" href="${escapeHtml(MANUAL_URL)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`
  }
  return `<span class="credit-link">${label}</span>`
}

function buildDocument(title: string, json: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="screening">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · 剧本分镜</title>
<style>${STYLES}</style>
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<div id="progress" class="progress" aria-hidden="true"></div>

<header class="topbar">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <span class="brand-name" id="brandName"></span>
  </div>
  <nav class="tabs" id="tabs" role="tablist"></nav>
  <div class="tools">
    <div class="search">
      <input id="search" type="search" placeholder="搜索场景 / 镜头 / 台词" aria-label="搜索" autocomplete="off" />
    </div>
    <button class="icon-btn" id="themeBtn" type="button" title="切换 放映厅 / 剧本纸" aria-label="切换主题"></button>
    <button class="icon-btn" id="printBtn" type="button" title="打印 / 导出 PDF" aria-label="打印">打印</button>
  </div>
</header>

<main id="app"></main>

<div class="lightbox" id="lightbox" aria-hidden="true">
  <button class="lb-close" id="lbClose" type="button" aria-label="关闭">关闭</button>
  <button class="lb-nav lb-prev" id="lbPrev" type="button" aria-label="上一镜">‹</button>
  <figure class="lb-figure">
    <img id="lbImg" alt="" />
    <figcaption id="lbCap"></figcaption>
  </figure>
  <button class="lb-nav lb-next" id="lbNext" type="button" aria-label="下一镜">›</button>
</div>

<footer class="foot">
  <span id="footMeta"></span>
  <span class="credit">${creditHtml()}</span>
</footer>

<script id="payload" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`
}

/* ----------------------------- 样式 ----------------------------- */
const STYLES = `
:root{
  --bg:#0e0d0b; --bg-2:#16140e; --surface:#1b1813; --surface-2:#221e16;
  --line:rgba(236,231,220,.10); --line-strong:rgba(236,231,220,.18);
  --text:#ece7dc; --text-dim:#a39a87; --text-faint:#6f6757;
  --accent:#e0a53f; --accent-ink:#0e0d0b; --accent-soft:rgba(224,165,63,.14);
  --perf:rgba(236,231,220,.07);
  --radius:14px; --radius-sm:9px;
  --maxw:1320px;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --sans:"Helvetica Neue","PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color-scheme:dark;
}
html[data-theme="paper"]{
  --bg:#f4f2ec; --bg-2:#efece3; --surface:#ffffff; --surface-2:#f7f5ef;
  --line:rgba(27,26,23,.12); --line-strong:rgba(27,26,23,.22);
  --text:#1c1a16; --text-dim:#5f594d; --text-faint:#8f897b;
  --accent:#b97e1e; --accent-ink:#fff; --accent-soft:rgba(185,126,30,.12);
  --perf:rgba(27,26,23,.06);
  color-scheme:light;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--text); font-family:var(--sans);
  font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased;
  letter-spacing:.005em; min-height:100vh;
}
::selection{background:var(--accent-soft); color:var(--text)}
button{font-family:inherit; color:inherit; cursor:pointer}
a{color:inherit}

/* 胶片颗粒：固定层，不参与滚动重绘 */
.grain{
  position:fixed; inset:0; z-index:60; pointer-events:none; opacity:.035;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode:overlay;
}
html[data-theme="paper"] .grain{opacity:.02; mix-blend-mode:multiply}

.progress{position:fixed; top:0; left:0; height:2px; width:0; background:var(--accent); z-index:70; transition:width .12s linear}

/* 顶栏 */
.topbar{
  position:sticky; top:0; z-index:50; display:flex; align-items:center; gap:18px;
  height:60px; padding:0 22px; background:color-mix(in srgb,var(--bg) 86%, transparent);
  backdrop-filter:saturate(140%) blur(12px); border-bottom:1px solid var(--line);
}
.brand{display:flex; align-items:center; gap:11px; min-width:0; flex:0 1 auto}
.brand-mark{width:13px; height:13px; border-radius:3px; background:var(--accent);
  box-shadow:0 0 0 3px var(--accent-soft); flex:0 0 auto}
.brand-name{font-weight:680; letter-spacing:-.01em; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; max-width:30vw}
.tabs{display:flex; gap:4px; margin:0 auto; flex:0 0 auto}
.tab{
  appearance:none; background:transparent; border:1px solid transparent; border-radius:999px;
  padding:7px 16px; font-size:13.5px; font-weight:600; color:var(--text-dim);
  letter-spacing:.02em; transition:color .18s, background .18s, border-color .18s;
}
.tab:hover{color:var(--text)}
.tab[aria-selected="true"]{color:var(--accent-ink); background:var(--accent); border-color:var(--accent)}
html[data-theme="paper"] .tab[aria-selected="true"]{color:#fff}
.tab .tab-n{font-family:var(--mono); font-size:11px; opacity:.6; margin-left:7px}
.tab[aria-selected="true"] .tab-n{opacity:.85}
.tools{display:flex; align-items:center; gap:8px; flex:0 1 auto}
.search input{
  width:200px; max-width:30vw; height:36px; padding:0 13px; border-radius:999px;
  background:var(--surface); border:1px solid var(--line); color:var(--text);
  font-size:13px; outline:none; transition:border-color .18s, width .2s;
}
.search input:focus{border-color:var(--accent); width:240px}
.search input::placeholder{color:var(--text-faint)}
.icon-btn{
  height:36px; padding:0 13px; border-radius:999px; background:var(--surface);
  border:1px solid var(--line); color:var(--text-dim); font-size:13px; font-weight:600;
  display:inline-flex; align-items:center; transition:color .18s, border-color .18s, transform .1s;
}
.icon-btn:hover{color:var(--text); border-color:var(--line-strong)}
.icon-btn:active{transform:translateY(1px)}

main{max-width:var(--maxw); margin:0 auto; padding:0 22px}

/* 片头 slate（标题卡） */
.slate{
  margin:46px 0 18px; padding:34px 34px 30px; border:1px solid var(--line);
  border-radius:var(--radius); background:
    linear-gradient(180deg,var(--surface-2),var(--surface));
  position:relative; overflow:hidden;
}
.slate::before{
  /* 片头打板斜纹 */
  content:""; position:absolute; top:0; right:0; width:42%; height:9px;
  background:repeating-linear-gradient(115deg,var(--text) 0 26px,var(--bg) 26px 52px);
  opacity:.10;
}
.slate-kicker{font-family:var(--mono); font-size:11.5px; letter-spacing:.28em;
  text-transform:uppercase; color:var(--accent); margin:0 0 14px}
.slate-title{font-size:clamp(28px,4.6vw,52px); line-height:1.04; font-weight:760;
  letter-spacing:-.025em; margin:0 0 8px; max-width:22ch; overflow-wrap:anywhere; word-break:break-word}
.slate-sub{color:var(--text-dim); font-size:14px; margin:0; display:flex; align-items:center; gap:9px; flex-wrap:wrap}
.slate-sub .vn{font-family:var(--mono); color:var(--text)}
.slate-sub .sub-tag{font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--text-faint); border:1px solid var(--line); border-radius:5px; padding:2px 7px}
.stats{display:flex; flex-wrap:wrap; gap:0; margin-top:26px; border-top:1px solid var(--line); padding-top:22px}
.stat{padding:0 28px 0 0; margin-right:28px; border-right:1px solid var(--line)}
.stat:last-child{border-right:0; margin-right:0; padding-right:0}
.stat .v{font-family:var(--mono); font-size:24px; font-weight:600; letter-spacing:-.01em; display:block}
.stat .k{font-size:11.5px; color:var(--text-faint); letter-spacing:.16em; text-transform:uppercase; margin-top:5px}

.view{display:none}
.view.active{display:block}
.view-pad{padding:26px 0 90px}

/* ---- 剧本视图：左时码脊 + 右正文 ---- */
.script-grid{display:grid; grid-template-columns:236px 1fr; gap:40px; align-items:start}
.spine{position:sticky; top:78px; align-self:start; max-height:calc(100vh - 100px);
  overflow:auto; padding-right:6px; scrollbar-width:thin}
.spine-h{font-size:11.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--text-faint);
  margin:0 0 12px; padding-left:30px}
.spine-list{list-style:none; margin:0; padding:0; position:relative}
/* 胶片齿孔脊 */
.spine-list::before{
  content:""; position:absolute; left:9px; top:2px; bottom:2px; width:13px;
  background-image:radial-gradient(var(--perf) 38%, transparent 41%);
  background-size:13px 17px; background-position:center top; opacity:.9;
}
.spine-item{position:relative; padding:7px 8px 7px 30px; border-radius:8px; cursor:pointer;
  transition:background .16s; display:block; width:100%; text-align:left; background:transparent; border:0}
.spine-item:hover{background:var(--surface)}
.spine-item .si-num{font-family:var(--mono); font-size:11px; color:var(--text-faint)}
.spine-item .si-name{font-size:13px; color:var(--text-dim); display:block; margin-top:2px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.spine-item .si-dot{position:absolute; left:11px; top:11px; width:9px; height:9px; border-radius:50%;
  background:var(--bg); border:2px solid var(--text-faint); transition:border-color .16s, background .16s}
.spine-item.cur .si-name{color:var(--text)}
.spine-item.cur .si-num{color:var(--accent)}
.spine-item.cur .si-dot{background:var(--accent); border-color:var(--accent)}

.script-body{max-width:none}
.scene{padding:0 0 40px; scroll-margin-top:78px}
.slug{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; padding-bottom:12px;
  border-bottom:1px solid var(--line); margin-bottom:18px}
.slug .sn{font-family:var(--mono); font-size:13px; font-weight:600; color:var(--accent);
  background:var(--accent-soft); padding:3px 9px; border-radius:6px}
.slug .sh{font-size:20px; font-weight:680; letter-spacing:-.01em; text-transform:uppercase}
.slug .tc{font-family:var(--mono); font-size:12.5px; color:var(--text-faint); margin-left:auto}
.scene-thumb{margin:0 0 18px; border-radius:10px; overflow:hidden; border:1px solid var(--line);
  background:var(--bg-2); cursor:zoom-in; max-width:520px; aspect-ratio:16/9}
.scene-thumb img{width:100%; height:100%; object-fit:cover; display:block;
  transition:transform .35s cubic-bezier(.16,1,.3,1)}
.scene-thumb:hover img{transform:scale(1.03)}
.ln{margin:0 0 11px}
.ln.action{color:var(--text-dim); font-style:italic; max-width:64ch}
.ln.present{font-size:13px; color:var(--text-faint); font-family:var(--mono); letter-spacing:.02em}
.ln.cue{color:var(--accent); font-weight:600; letter-spacing:.04em}
.ln.text{max-width:64ch}
.ln.dia{display:grid; grid-template-columns:9em 1fr; gap:14px; max-width:60ch; margin:0 auto 13px 0}
.ln.dia .who{font-weight:700; text-align:right; color:var(--accent); letter-spacing:.02em}
.ln.dia .who .tag{font-family:var(--mono); font-size:10px; color:var(--text-faint); display:block; font-weight:500}
.ln.dia .said{color:var(--text)}

/* ---- 分镜视图：胶片网格 ---- */
.sb-bar{display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:20px;
  color:var(--text-faint); font-family:var(--mono); font-size:12px; letter-spacing:.04em; flex-wrap:wrap}
.sb-toggle{display:inline-flex; padding:3px; gap:3px; background:var(--surface); border:1px solid var(--line);
  border-radius:999px}
.sb-toggle button{appearance:none; background:transparent; border:0; border-radius:999px; padding:5px 14px;
  font-family:var(--sans); font-size:12.5px; font-weight:600; color:var(--text-dim); letter-spacing:.02em;
  transition:color .16s, background .16s}
.sb-toggle button:hover{color:var(--text)}
.sb-toggle button[aria-pressed="true"]{color:var(--accent-ink); background:var(--accent)}
html[data-theme="paper"] .sb-toggle button[aria-pressed="true"]{color:#fff}
.sb-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px}
.sb-grid[hidden],.sb-table-wrap[hidden]{display:none}

/* ---- 分镜视图：表格 ---- */
/* 注意：不要给 wrap 加 overflow:hidden，否则会成为 sticky 的定位根，使表头 top:60px 在容器内下移压住首行 */
.sb-table-wrap{border:1px solid var(--line); border-radius:var(--radius)}
/* table-layout:fixed + colgroup 固定列宽：把大头给「提示词描述」，避免自动布局把描述压到几十像素、
   而把音效撑到几百像素（导致每行高达两千多像素、整页超长）。 */
.sb-table{width:100%; border-collapse:collapse; table-layout:fixed; font-size:13.5px}
.sb-table th,.sb-table td{text-align:left; padding:11px 13px; border-bottom:1px solid var(--line);
  vertical-align:top; overflow-wrap:anywhere; word-break:break-word}
.sb-table thead th{position:sticky; top:60px; z-index:5; background:var(--surface-2); color:var(--text-dim);
  font-family:var(--mono); font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; font-weight:600;
  white-space:nowrap}
.sb-table thead th:first-child{border-top-left-radius:var(--radius)}
.sb-table thead th:last-child{border-top-right-radius:var(--radius)}
.sb-table tbody tr:last-child td:first-child{border-bottom-left-radius:var(--radius)}
.sb-table tbody tr:last-child td:last-child{border-bottom-right-radius:var(--radius)}
.sb-table tbody tr:hover{background:var(--surface)}
.sb-table tbody tr:last-child td{border-bottom:0}
.sb-table .c-num{font-family:var(--mono); color:var(--accent); font-weight:600; white-space:nowrap}
.sb-table .c-tc{font-family:var(--mono); color:var(--text-dim); font-size:11.5px; text-align:center; padding-left:6px; padding-right:6px}
.sb-table .c-tc span{display:block; line-height:1.45; white-space:nowrap}
.sb-table .c-tc .d{color:var(--text-faint)}
.sb-table .c-meta{font-family:var(--mono); color:var(--text-dim)}
.sb-table .c-dia{color:var(--text)}
.sb-table .c-prompt{white-space:pre-line; font-family:var(--mono); font-size:12px; line-height:1.55}
.sb-table .t-thumb{width:128px}
.sb-table .t-thumb img{width:128px; aspect-ratio:16/9; object-fit:cover; border-radius:6px; display:block;
  cursor:zoom-in; border:1px solid var(--line)}
.sb-table .t-thumb .noimg{width:128px; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center;
  border-radius:6px; background:var(--bg-2); color:var(--text-faint); font-family:var(--mono); font-size:10px}
.shot{border:1px solid var(--line); border-radius:var(--radius); background:var(--surface);
  overflow:hidden; display:flex; flex-direction:column; transition:transform .2s, border-color .2s}
.shot:hover{border-color:var(--line-strong)}
.shot-frame{position:relative; aspect-ratio:16/9; background:var(--bg-2); overflow:hidden; cursor:zoom-in}
.shot-frame img{width:100%; height:100%; object-fit:cover; display:block;
  transition:transform .35s cubic-bezier(.16,1,.3,1)}
.shot-frame:hover img{transform:scale(1.045)}
.shot-frame.empty{display:flex; align-items:center; justify-content:center; cursor:default;
  color:var(--text-faint); font-family:var(--mono); font-size:12px; letter-spacing:.1em}
.shot-badge{position:absolute; left:10px; top:10px; font-family:var(--mono); font-size:12px;
  font-weight:600; color:var(--text); background:color-mix(in srgb,var(--bg) 72%, transparent);
  border:1px solid var(--line-strong); padding:3px 8px; border-radius:6px; backdrop-filter:blur(4px)}
.shot-tc{position:absolute; right:10px; bottom:10px; font-family:var(--mono); font-size:11px;
  color:var(--text); background:color-mix(in srgb,var(--bg) 72%, transparent);
  padding:3px 7px; border-radius:5px; backdrop-filter:blur(4px)}
.shot-body{padding:14px 15px 16px; display:flex; flex-direction:column; gap:10px; flex:1}
.chips{display:flex; flex-wrap:wrap; gap:6px}
.chip{font-family:var(--mono); font-size:11px; color:var(--text-dim); border:1px solid var(--line);
  border-radius:5px; padding:2px 7px; letter-spacing:.02em}
.chip b{color:var(--text-faint); font-weight:500; margin-right:4px}
.prompt-wrap{border:1px solid var(--line); border-radius:8px; background:var(--bg-2); padding:9px 10px}
.prompt-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;
  color:var(--text-faint); font-family:var(--mono); font-size:10px; letter-spacing:.08em}
.prompt-copy{appearance:none; border:1px solid var(--line); border-radius:5px; background:var(--surface);
  color:var(--text-dim); padding:2px 7px; font-size:10px}
.prompt-copy:hover{border-color:var(--line-strong); color:var(--text)}
.shot-desc{margin:0; font-size:12px; line-height:1.55; color:var(--text); white-space:pre-line;
  font-family:var(--mono)}
.prompt-wrap.legacy .shot-desc{font-family:var(--sans); font-size:14px}
.shot-meta{display:flex; flex-direction:column; gap:6px; margin-top:auto; padding-top:10px;
  border-top:1px solid var(--line)}
.shot-meta .row{display:grid; grid-template-columns:3.4em 1fr; gap:8px; font-size:13px}
.shot-meta .row .lbl{color:var(--text-faint); font-size:11.5px; font-family:var(--mono);
  letter-spacing:.04em; padding-top:1px}
.shot-meta .row .val{color:var(--text-dim)}
.shot-meta .row.dia .val{color:var(--text)}

.empty-state{padding:80px 20px; text-align:center; color:var(--text-faint)}
.empty-state .es-t{font-size:16px; color:var(--text-dim); margin-bottom:6px}
.no-result{display:none; padding:60px 20px; text-align:center; color:var(--text-faint); font-size:14px}

/* 灯箱 */
.lightbox{position:fixed; inset:0; z-index:80; display:none; align-items:center; justify-content:center;
  background:color-mix(in srgb,#000 84%, transparent); backdrop-filter:blur(6px); padding:40px}
.lightbox.open{display:flex}
.lb-figure{margin:0; max-width:min(1100px,92vw); max-height:88vh; display:flex; flex-direction:column; gap:14px}
.lb-figure img{max-width:100%; max-height:78vh; object-fit:contain; border-radius:10px;
  border:1px solid var(--line-strong); background:#000}
.lb-figure figcaption{font-family:var(--mono); font-size:13px; color:#ece7dc; text-align:center}
.lb-close{position:absolute; top:20px; right:24px; height:38px; padding:0 16px; border-radius:999px;
  background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.2); color:#fff; font-size:13px; font-weight:600}
.lb-close:hover{background:rgba(255,255,255,.18)}
.lb-nav{position:absolute; top:50%; transform:translateY(-50%); width:52px; height:52px; border-radius:50%;
  background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.2); color:#fff; font-size:28px; line-height:1}
.lb-nav:hover{background:rgba(255,255,255,.18)}
.lb-prev{left:24px} .lb-next{right:24px}

.foot{max-width:var(--maxw); margin:30px auto 0; padding:24px 22px 50px; border-top:1px solid var(--line);
  color:var(--text-faint); font-size:12px; font-family:var(--mono); letter-spacing:.04em;
  display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap}
.credit{color:var(--text-dim)}
.credit-link{color:var(--accent); text-decoration:none; font-weight:600}
a.credit-link:hover{text-decoration:underline}

/* 响应式：移动端折叠为单列 */
@media (max-width:860px){
  .topbar{flex-wrap:wrap; height:auto; padding:10px 16px; gap:10px}
  .tabs{order:3; width:100%; margin:0; justify-content:center}
  .tools{margin-left:auto}
  .search input{width:140px}
  main{padding:0 16px}
  .script-grid{grid-template-columns:1fr; gap:0}
  .spine{display:none}
  .ln.dia{grid-template-columns:1fr; gap:2px}
  .ln.dia .who{text-align:left}
  .slate{padding:24px 20px}
}

/* 降低动效 */
@media (prefers-reduced-motion:reduce){
  *{animation-duration:.001ms !important; transition-duration:.001ms !important}
  .shot-frame:hover img{transform:none}
}

/* 打印：剧本纸排版 */
@media print{
  .topbar,.tools,.spine,.progress,.grain,.foot,.lightbox{display:none !important}
  body{background:#fff; color:#111}
  .slate{border:0; background:none; padding:0 0 16px}
  .script-grid{grid-template-columns:1fr}
  .view{display:block !important}
  .shot{break-inside:avoid; border-color:#ccc}
  .scene{break-inside:avoid-page}
}
`

/* ----------------------------- 客户端脚本 -----------------------------
 * 约束：不使用模板字符串 / 反引号 / `${`，全部用字符串拼接，
 * 以免与外层 TS 模板字符串冲突。
 */
const SCRIPT = `
(function(){
  "use strict";
  var DATA = JSON.parse(document.getElementById("payload").textContent);
  var M = DATA.meta, scenes = DATA.scenes || [], shots = DATA.shots || [];
  var hasScript = scenes.length > 0, hasStoryboard = shots.length > 0;

  function el(tag, cls, txt){ var e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }
  function esc(s){ return (s==null?"":String(s)); }

  /* 顶部信息 */
  document.getElementById("brandName").textContent = M.projectName;
  var footParts=[];
  if(M.duration) footParts.push("时长 "+M.duration);
  footParts.push(M.sceneCount+" 场");
  footParts.push(M.shotCount+" 镜");
  var d=new Date(M.generatedAt);
  function pad(n){return (n<10?"0":"")+n;}
  footParts.push("导出于 "+d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes()));
  document.getElementById("footMeta").textContent = footParts.join("   /   ");

  /* 标签页 */
  var TABS=[];
  if(hasScript) TABS.push({id:"script", label:"剧本", n:M.sceneCount});
  if(hasStoryboard) TABS.push({id:"storyboard", label:"分镜", n:M.shotCount});
  var tabsEl=document.getElementById("tabs");
  var current = TABS.length?TABS[0].id:null;
  TABS.forEach(function(t){
    var b=el("button","tab"); b.type="button"; b.setAttribute("role","tab");
    b.setAttribute("data-tab",t.id);
    b.innerHTML = esc(t.label)+'<span class="tab-n">'+t.n+'</span>';
    b.addEventListener("click",function(){ setTab(t.id); });
    tabsEl.appendChild(b);
  });

  /* 渲染 app */
  var app=document.getElementById("app");

  /* slate 标题卡：主体是源视频文件，项目名作为小标签 */
  var slate=el("section","slate");
  function stat(v,k){ return v?('<div class="stat"><span class="v">'+escHtml(v)+'</span><span class="k">'+k+'</span></div>'):''; }
  var stats =
    stat(M.resolution,'分辨率')+
    stat(M.fps,'帧率')+
    stat(M.bitrate,'码率')+
    stat(M.codec?String(M.codec).toUpperCase():'','编码')+
    stat(M.size,'体积')+
    stat(M.duration,'总时长')+
    (hasScript?stat(M.sceneCount,'场景'):'')+
    (hasStoryboard?stat(M.shotCount,'镜头'):'');
  var hero = M.videoName || M.projectName;
  var sub = M.videoName
    ? '<span class="vn">'+escHtml(M.projectName)+'</span><span class="sub-tag">项目</span>'
    : '<span class="vn">本地项目</span>';
  slate.innerHTML =
    '<p class="slate-kicker">SCREENPLAY / STORYBOARD</p>'+
    '<h1 class="slate-title">'+escHtml(hero)+'</h1>'+
    '<p class="slate-sub">'+sub+'</p>'+
    '<div class="stats">'+stats+'</div>';
  app.appendChild(slate);

  function escHtml(s){ var p=document.createElement("span"); p.textContent=(s==null?"":String(s)); return p.innerHTML; }

  /* 剧本视图 */
  var scriptView=null, spineItems=[], sceneEls=[], sceneFramed=[];
  if(hasScript){
    scriptView=el("section","view"); scriptView.id="view-script";
    var pad=el("div","view-pad");
    var grid=el("div","script-grid");

    var spine=el("aside","spine");
    spine.innerHTML='<p class="spine-h">场次时码</p>';
    var ul=el("ul","spine-list");
    var bodyWrap=el("div","script-body");

    scenes.forEach(function(sc,idx){
      var li=el("li");
      var btn=el("button","spine-item"); btn.type="button";
      btn.innerHTML='<span class="si-dot"></span><span class="si-num">'+escHtml(sc.number||("#"+(idx+1)))+
        '  '+escHtml(sc.timecode)+'</span><span class="si-name">'+escHtml(sc.heading)+'</span>';
      btn.addEventListener("click",function(){
        var t=document.getElementById("scene-"+idx);
        if(t) t.scrollIntoView({behavior:reduceMotion()?"auto":"smooth", block:"start"});
      });
      li.appendChild(btn); ul.appendChild(li); spineItems.push(btn);

      var sec=el("article","scene"); sec.id="scene-"+idx;
      sec.setAttribute("data-text", searchText(sc));
      var slug=el("div","slug");
      slug.innerHTML='<span class="sn">'+escHtml(sc.number||("场 "+(idx+1)))+'</span>'+
        '<span class="sh">'+escHtml(sc.heading)+'</span>'+
        '<span class="tc">'+escHtml(sc.timecode)+'</span>';
      sec.appendChild(slug);
      if(sc.frame){
        var sLabel = sc.number || ("场 "+(idx+1));
        var si=sceneFramed.length; sceneFramed.push({src:sc.frame, num:sLabel, tr:sc.timecode, desc:sc.heading});
        var th=el("div","scene-thumb"); th.setAttribute("data-si",si);
        th.innerHTML='<img loading="lazy" src="'+sc.frame+'" alt="'+escHtml(sLabel)+' 关键帧" />';
        sec.appendChild(th);
      }
      (sc.lines||[]).forEach(function(ln){ sec.appendChild(renderLine(ln)); });
      bodyWrap.appendChild(sec); sceneEls.push(sec);
    });

    /* 场景关键帧点击 → 灯箱 */
    bodyWrap.addEventListener("click",function(e){
      var th=e.target.closest(".scene-thumb[data-si]"); if(!th) return;
      openLightbox(sceneFramed, parseInt(th.getAttribute("data-si"),10));
    });

    spine.appendChild(ul);
    grid.appendChild(spine); grid.appendChild(bodyWrap);
    pad.appendChild(grid);
    var noRes1=el("div","no-result","没有匹配的场景"); noRes1.id="noRes-script";
    pad.appendChild(noRes1);
    scriptView.appendChild(pad);
    app.appendChild(scriptView);
  }

  function renderLine(ln){
    if(ln.t==="dialogue"){
      var d=el("div","ln dia");
      var who='<span class="who">'+escHtml(ln.c)+(ln.tag?'<span class="tag">'+escHtml(ln.tag)+'</span>':'')+'</span>';
      d.innerHTML=who+'<span class="said">'+escHtml(ln.s)+'</span>';
      return d;
    }
    if(ln.t==="action") return el("p","ln action",ln.s);
    if(ln.t==="present") return el("p","ln present","出场  "+ln.s);
    if(ln.t==="cue") return el("p","ln cue",ln.s);
    return el("p","ln text",ln.s);
  }
  function searchText(sc){
    var parts=[sc.number,sc.heading,sc.timecode];
    (sc.lines||[]).forEach(function(l){ parts.push(l.s); if(l.c)parts.push(l.c); });
    return parts.join(" ").toLowerCase();
  }

  /* 分镜视图：卡片 / 表格 两种形式 */
  var sbView=null, shotEls=[], rowEls=[], framedShots=[], sbMode="card";
  if(hasStoryboard){
    sbView=el("section","view"); sbView.id="view-storyboard";
    var pad2=el("div","view-pad");

    var bar=el("div","sb-bar");
    var barInfo=el("span"); barInfo.textContent = M.shotCount+" 个镜头" + (M.duration?("  /  全片 "+M.duration):"");
    var toggle=el("div","sb-toggle");
    var btnCard=el("button",null,"卡片"); btnCard.type="button"; btnCard.setAttribute("aria-pressed","true");
    var btnTable=el("button",null,"表格"); btnTable.type="button"; btnTable.setAttribute("aria-pressed","false");
    toggle.appendChild(btnCard); toggle.appendChild(btnTable);
    bar.appendChild(barInfo); bar.appendChild(toggle);
    pad2.appendChild(bar);

    var sg=el("div","sb-grid");

    var tableWrap=el("div","sb-table-wrap"); tableWrap.hidden=true;
    var table=el("table","sb-table");
    table.innerHTML=
      '<colgroup>'+
        '<col style="width:50px"><col style="width:138px"><col style="width:60px"><col style="width:60px">'+
        '<col style="width:66px"><col style="width:80px"><col style="width:460px"><col style="width:200px"><col style="width:120px">'+
      '</colgroup>'+
      '<thead><tr>'+
      '<th>镜号</th><th>关键帧</th><th>景别</th><th>角度</th><th>运镜</th><th>时码</th><th>提示词描述</th><th>台词</th><th>音效</th>'+
      '</tr></thead>';
    var tbody=el("tbody"); table.appendChild(tbody); tableWrap.appendChild(table);

    shots.forEach(function(sh,shotIndex){
      var num = ("000"+sh.number).slice(-3);
      var dtext=shotText(sh);
      var fIndex=-1;
      if(sh.frame){ fIndex=framedShots.length; framedShots.push({src:sh.frame, num:num, tr:sh.timeRange, desc:sh.description}); }

      /* 卡片 */
      var card=el("article","shot"); card.setAttribute("data-text", dtext);
      var frameHtml;
      if(sh.frame){
        frameHtml='<div class="shot-frame" data-fi="'+fIndex+'">'+
          '<img loading="lazy" src="'+sh.frame+'" alt="镜头 '+num+'" />'+
          '<span class="shot-badge">#'+num+'</span>'+
          '<span class="shot-tc">'+escHtml(sh.timeRange)+'</span></div>';
      }else{
        frameHtml='<div class="shot-frame empty"><span class="shot-badge">#'+num+'</span>无关键帧</div>';
      }
      var chips="";
      if(sh.shotType) chips+='<span class="chip"><b>景</b>'+escHtml(sh.shotType)+'</span>';
      if(sh.angle) chips+='<span class="chip"><b>角</b>'+escHtml(sh.angle)+'</span>';
      if(sh.cameraMove) chips+='<span class="chip"><b>运</b>'+escHtml(sh.cameraMove)+'</span>';
      var meta="";
      if(sh.dialogue) meta+='<div class="row dia"><span class="lbl">台词</span><span class="val">'+escHtml(sh.dialogue)+'</span></div>';
      if(sh.sound) meta+='<div class="row"><span class="lbl">音效</span><span class="val">'+escHtml(sh.sound)+'</span></div>';
      var promptHtml=sh.description
        ? '<div class="prompt-wrap'+(sh.descriptionLegacy?' legacy':'')+'">'+
            '<div class="prompt-head"><span>'+(sh.descriptionLegacy?'旧版画面描述':'提示词描述')+'</span>'+
              '<button class="prompt-copy" type="button" data-copy-shot="'+shotIndex+'">复制</button></div>'+
            '<p class="shot-desc">'+escHtml(sh.description)+'</p></div>'
        : '';
      card.innerHTML=frameHtml+
        '<div class="shot-body">'+
          (chips?'<div class="chips">'+chips+'</div>':'')+
          promptHtml+
          (meta?'<div class="shot-meta">'+meta+'</div>':'')+
        '</div>';
      sg.appendChild(card); shotEls.push(card);

      /* 表格行 */
      var tr=el("tr"); tr.setAttribute("data-text", dtext);
      var thumb = sh.frame
        ? '<div class="t-thumb"><img loading="lazy" data-fi="'+fIndex+'" src="'+sh.frame+'" alt="镜头 '+num+'" /></div>'
        : '<div class="t-thumb"><span class="noimg">无帧</span></div>';
      tr.innerHTML='<td class="c-num">#'+num+'</td>'+
        '<td class="t-thumb">'+thumb+'</td>'+
        '<td class="c-meta">'+escHtml(sh.shotType||"-")+'</td>'+
        '<td class="c-meta">'+escHtml(sh.angle||"-")+'</td>'+
        '<td class="c-meta">'+escHtml(sh.cameraMove||"-")+'</td>'+
        '<td class="c-tc"><span>'+escHtml(sh.tcStart)+'</span><span class="d">-</span><span>'+escHtml(sh.tcEnd)+'</span></td>'+
        '<td class="c-prompt">'+escHtml(sh.description||"")+'</td>'+
        '<td class="c-dia">'+escHtml(sh.dialogue||"")+'</td>'+
        '<td class="c-meta">'+escHtml(sh.sound||"")+'</td>';
      tbody.appendChild(tr); rowEls.push(tr);
    });

    pad2.appendChild(sg);
    pad2.appendChild(tableWrap);
    var noRes2=el("div","no-result","没有匹配的镜头"); noRes2.id="noRes-storyboard";
    pad2.appendChild(noRes2);
    sbView.appendChild(pad2);
    app.appendChild(sbView);

    /* 关键帧点击 → 灯箱（卡片与表格共用 framedShots） */
    function lbFromEl(t){ var fi=t.getAttribute("data-fi"); if(fi!=null) openLightbox(framedShots, parseInt(fi,10)); }
    sg.addEventListener("click",function(e){
      var copy=e.target.closest("[data-copy-shot]");
      if(copy){
        e.preventDefault(); e.stopPropagation();
        var sh=shots[parseInt(copy.getAttribute("data-copy-shot"),10)];
        if(sh) copyText(sh.description,copy);
        return;
      }
      var fr=e.target.closest(".shot-frame[data-fi]"); if(fr) lbFromEl(fr);
    });
    tableWrap.addEventListener("click",function(e){ var im=e.target.closest("img[data-fi]"); if(im) lbFromEl(im); });

    /* 卡片 / 表格切换 */
    function setSbMode(m){
      sbMode=m;
      btnCard.setAttribute("aria-pressed", m==="card"?"true":"false");
      btnTable.setAttribute("aria-pressed", m==="table"?"true":"false");
      sg.hidden = m!=="card";
      tableWrap.hidden = m!=="table";
      applySearch();
    }
    btnCard.addEventListener("click",function(){ setSbMode("card"); });
    btnTable.addEventListener("click",function(){ setSbMode("table"); });
  }
  function shotText(sh){
    return [("000"+sh.number).slice(-3),sh.shotType,sh.angle,sh.cameraMove,sh.description,sh.dialogue,sh.sound,sh.timeRange].join(" ").toLowerCase();
  }
  function copyText(text,button){
    function done(){
      var before=button.textContent; button.textContent="已复制";
      setTimeout(function(){button.textContent=before;},1200);
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){fallbackCopy(text);done();});
    }else{ fallbackCopy(text); done(); }
  }
  function fallbackCopy(text){
    var ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }

  /* 标签切换 */
  function setTab(id){
    current=id;
    Array.prototype.forEach.call(tabsEl.children,function(b){
      b.setAttribute("aria-selected", b.getAttribute("data-tab")===id?"true":"false");
    });
    if(scriptView) scriptView.classList.toggle("active", id==="script");
    if(sbView) sbView.classList.toggle("active", id==="storyboard");
    window.scrollTo({top:0});
    applySearch();
  }
  if(current) setTab(current);
  else app.appendChild(el("div","empty-state",""));

  /* 当前场景高亮（IntersectionObserver） */
  if(hasScript && "IntersectionObserver" in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(!en.isIntersecting) return;
        var i=sceneEls.indexOf(en.target);
        spineItems.forEach(function(s,k){ s.classList.toggle("cur", k===i); });
      });
    },{rootMargin:"-40% 0px -55% 0px"});
    sceneEls.forEach(function(s){ io.observe(s); });
  }

  /* 阅读进度条 */
  var pbar=document.getElementById("progress");
  function onScroll(){
    var h=document.documentElement;
    var max=h.scrollHeight-h.clientHeight;
    pbar.style.width=(max>0?(h.scrollTop/max*100):0)+"%";
  }
  document.addEventListener("scroll",onScroll,{passive:true}); onScroll();

  /* 搜索过滤 */
  var searchInput=document.getElementById("search");
  var q="";
  searchInput.addEventListener("input",function(){ q=this.value.trim().toLowerCase(); applySearch(); });
  function applySearch(){
    if(current==="script"){
      showNoRes("noRes-script", filterNodes(sceneEls));
    }else if(current==="storyboard"){
      var sCards=filterNodes(shotEls);
      var sRows=filterNodes(rowEls);
      showNoRes("noRes-storyboard", sbMode==="table" ? sRows : sCards);
    }
  }
  function filterNodes(nodes){
    var shown=0;
    nodes.forEach(function(n){
      var ok = !q || (n.getAttribute("data-text")||"").indexOf(q)>=0;
      n.style.display = ok?"":"none";
      if(ok) shown++;
    });
    return shown;
  }
  function showNoRes(id,shown){ var nr=document.getElementById(id); if(nr) nr.style.display = shown?"none":"block"; }

  /* 主题切换 */
  var themeBtn=document.getElementById("themeBtn");
  function reduceMotion(){ return window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function labelTheme(){
    var t=document.documentElement.getAttribute("data-theme");
    themeBtn.textContent = t==="paper"?"放映厅":"剧本纸";
  }
  try{ var saved=localStorage.getItem("v2s-theme"); if(saved) document.documentElement.setAttribute("data-theme",saved); }catch(e){}
  labelTheme();
  themeBtn.addEventListener("click",function(){
    var t=document.documentElement.getAttribute("data-theme")==="paper"?"screening":"paper";
    document.documentElement.setAttribute("data-theme",t);
    try{ localStorage.setItem("v2s-theme",t); }catch(e){}
    labelTheme();
  });

  /* 打印 */
  document.getElementById("printBtn").addEventListener("click",function(){ window.print(); });

  /* 灯箱（剧本场景帧与分镜关键帧共用，按传入列表导航） */
  var lb=document.getElementById("lightbox"), lbImg=document.getElementById("lbImg"),
      lbCap=document.getElementById("lbCap"), lbList=[], lbCur=0;
  function openLightbox(list,i){
    lbList=list||[]; lbCur=i; var f=lbList[i]; if(!f) return;
    lbImg.src=f.src; lbImg.alt=String(f.num||"");
    var cap=(f.num?("#"+f.num):"")+(f.tr?("   "+f.tr):"")+(f.desc?("   "+f.desc):"");
    lbCap.textContent=cap;
    lb.classList.add("open"); lb.setAttribute("aria-hidden","false");
  }
  function closeLightbox(){ lb.classList.remove("open"); lb.setAttribute("aria-hidden","true"); lbImg.src=""; }
  function step(d){ if(!lbList.length) return; lbCur=(lbCur+d+lbList.length)%lbList.length; openLightbox(lbList,lbCur); }
  document.getElementById("lbClose").addEventListener("click",closeLightbox);
  document.getElementById("lbPrev").addEventListener("click",function(){ step(-1); });
  document.getElementById("lbNext").addEventListener("click",function(){ step(1); });
  lb.addEventListener("click",function(e){ if(e.target===lb) closeLightbox(); });
  document.addEventListener("keydown",function(e){
    if(!lb.classList.contains("open")) return;
    if(e.key==="Escape") closeLightbox();
    else if(e.key==="ArrowLeft") step(-1);
    else if(e.key==="ArrowRight") step(1);
  });
})();
`
