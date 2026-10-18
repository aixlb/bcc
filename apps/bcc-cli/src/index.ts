#!/usr/bin/env node
/**
 * bcc —— 包拆拆 命令行入口（纯 Node，不拉起 Electron）。
 *
 *   bcc config     <list|get|set|path|test> ...     API / 模型 / 代理设置
 *   bcc script     <video|projectId> --out a.docx   拆剧本
 *   bcc storyboard <video|projectId> --out b.xlsx   拆分镜
 *   bcc research   <video...> --out style.md         风格研究
 *
 * 公共：--data-dir <dir> / --format a,b / --quiet / --verbose
 * 进度走 stderr，产物路径走 stdout。数据根默认与已安装 GUI 共用（详见 context.ts）。
 */
import { runConfig } from './commands/config.js'
import { runScriptCommand } from './commands/script.js'
import { runStoryboardCommand } from './commands/storyboard.js'
import { runResearchCommand } from './commands/research.js'
import { runProbeCommand, runShotsCommand, runMasterCommand, runExportCommand } from './commands/agent.js'
import { UsageError } from './output.js'

// CLI 契约：stdout 只放产物路径；service 层零散的 console.log/info（如 "[fetch] 直连"）一律改道 stderr
console.log = console.error
console.info = console.error

declare const __APP_VERSION__: string
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'

const HELP = `包拆拆 CLI (bcc) v${VERSION}

用法:
  bcc <命令> [参数]

命令:
  config <list|get|set|path|test>   API / 模型 / 代理设置
      bcc config list
      bcc config get gemini.api_key
      bcc config set gemini.api_key sk-xxxx
      bcc config test [provider]
  script <video|projectId>          拆剧本（默认导出 docx）
      bcc script ./a.mp4 --out 剧本.docx
      bcc script ./a.mp4 --format docx,md,html
      bcc script ./a.mp4 --master shanzhiyin   剧本大师（default=默认；也认中文名）
  storyboard <video|projectId>      拆分镜（默认导出 xlsx）
      bcc storyboard ./a.mp4 --out 分镜.xlsx --format xlsx,html
      切割: --cut-method smart|scene（默认读配置；smart=四检测器混合，更准）
            smart: --hard-min 5.5 --hard-ratio 8 --min-gap 0.3 · scene: --threshold 0.3
      分析: --master shanzhiyin（分镜大师，可与剧本大师不同；缺省读配置 storyboard_master）
  research <video...>               风格研究（默认导出 md）
      bcc research a.mp4 b.mp4 --out 风格指南.md
      bcc research --input-dir ./clips --out 风格指南.md
      bcc research --project <id> --out 风格指南.md

Agent 模式（CLI 不调用外部模型 API，分析由 harness 的 Agent 用自己的模型完成）:
  probe <video>                      视频技术参数 → stdout JSON
  shots <video> [--no-frames|--frames-dir dir]   切镜（默认不抽帧；--frames-dir 时逐镜抽关键帧）→ stdout JSON
      --cut-method smart|scene（默认读配置）· --max-shots N
      smart: --hard-min 5.5 --hard-ratio 8 --min-gap 0.3 · scene: --threshold 0.3
  master --list | <大师id>           输出大师方法论（--kind script|storyboard，供 Agent 参考）
  export script --from <剧本.md>     把 Agent 写的剧本 md 组装成 docx/md/txt/html
      bcc export script --from 剧本.md --out 剧本.docx --video a.mp4
  export storyboard --from <分镜.json>  把 Agent 写的分镜 json 组装成 xlsx/html（--video 自动嵌关键帧）
      bcc export storyboard --from 分镜.json --out 分镜.xlsx --video a.mp4

公共参数:
  --out, -o <file>     输出路径（按扩展名推断格式）
  --format, -f a,b     批量导出多种格式
  --data-dir <dir>     指定数据根（默认: BCC_DATA_DIR > cwd > 平台 userData）
  --quiet, -q          静默进度
  --verbose            打印数据根等诊断
  --ffmpeg-path <path> 显式指定 ffmpeg 二进制（缺省自动解析/下载）
  --ffprobe-path <path> 显式指定 ffprobe 二进制
  --help, -h           显示帮助
  --version, -v        显示版本
`

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP)
    return
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(VERSION + '\n')
    return
  }

  switch (command) {
    case 'config':
      return runConfig(rest)
    case 'script':
      return runScriptCommand(rest)
    case 'storyboard':
      return runStoryboardCommand(rest)
    case 'research':
      return runResearchCommand(rest)
    case 'probe':
      return runProbeCommand(rest)
    case 'shots':
      return runShotsCommand(rest)
    case 'master':
      return runMasterCommand(rest)
    case 'export':
      return runExportCommand(rest)
    default:
      throw new UsageError(`未知命令: ${command}\n\n${HELP}`)
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof UsageError) {
    process.stderr.write(`错误: ${err.message}\n`)
  } else {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`失败: ${msg}\n`)
  }
  process.exitCode = 1
})
