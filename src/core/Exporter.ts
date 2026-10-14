/**
 * Exporter — 字幕导出引擎
 * ==================================
 * 负责将 SubtitleItem[] 序列化为各种格式。
 * Store 专注状态管理，Exporter 专注格式逻辑。
 *
 * 设计原则：
 * - 纯函数，无副作用
 * - 每个格式独立函数，可单独测试
 * - 错误格式输入 → 返回空字符串（容错）
 */

import { type SubtitleItem } from '@/types/subtitle'
import { type ExportFormat } from '@/types/subtitle'
import { _decomposeWithRemainder, formatTimeLrc } from '@/utils/time'

// ─── 模块级常量（避免每调用重建）───────────────────────────────
// ASS escape sequences — MUST process backslash FIRST to avoid double-escaping
// Order: \\ → {, } → , → \n
const _ASS_ESCAPE_REGEXPS: Array<[RegExp, string]> = [
  [/\\/g, '\\\\'],  // backslash first — must be before other escapes
  [/\}/g, '\\}'],   // closing brace before opening (visual grouping)
  [/\{/g, '\\{'],  // opening brace
  [/,/g, '\\,'],   // comma
  [/\n/g, '\\N'],   // newline last — depends on \ not being double-escaped yet
]

// Shared timestamp helpers — now imported from utils/time
import { _pad2 } from '@/utils/time'

function pad2(n: number): string {
  return _pad2(n)
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

// ─── ASS/SSA shared event formatting ────────────────────────────
function formatAssEvents(
  subs: SubtitleItem[],
  tsFmt: (s: number) => string,
  prefix = '0',
): string {
  return subs.map(sub => {
    let text = sub.text
    for (const [pattern, replacement] of _ASS_ESCAPE_REGEXPS) {
      text = text.replace(pattern, replacement)
    }
    return `Dialogue: ${prefix},${tsFmt(sub.startTime)},${tsFmt(sub.endTime)},Default,,0,0,0,,${text}`
  }).join('\n')
}

// ─── 通用时间戳格式化工厂 ─────────────────────────────────────────
// tsSRT / tsVTT / tsSBV / tsASS / tsSSA 五个函数主体完全相同，
// 仅组件间分隔符和小数精度不同。统一为 tsFormat() 消除重复。
//
// tsFormat(subdivs, fracDiv, fracPad)
//   subdivs: [hSep, mSep, sSep]  — 组件间分隔符
//   fracDiv: 除数（1000=ms, 100=cs, 30=frames）
//   fracPad: 小数位数填充函数（pad2 或 pad3）
//
// Examples:
//   tsSRT  = tsFormat(':', 1000, pad3) → "00:01:23,456"
//   tsVTT  = tsFormat(':', 1000, pad3) → "00:01:23.456"  (VTT uses '.')
//   tsSBV  = tsFormat(':', 1000, pad3) → "00:01:23,456"
//   tsASS  = tsFormat(':', 100,  pad2) → "0:01:23.45"
//   tsSSA  = tsFormat(':', 30,   pad2) → "0:01:23:12"    (frames@30fps)

function tsFormat(
  hSep: string,
  mSep: string,
  sSep: string,
  fracDiv: number,
  fracPad: (n: number) => string,
): (seconds: number) => string {
  return (seconds: number) => {
    const { hrs: h, mins: m, secs: s, remainder } = _decomposeWithRemainder(seconds)
    return `${pad2(h)}${hSep}${pad2(m)}${mSep}${pad2(s)}${sSep}${fracPad(Math.floor(remainder * fracDiv))}`
  }
}

const tsSRT = tsFormat(':', ':', ',', 1000, pad3)  // HH:MM:SS,mmm
const tsVTT = tsFormat(':', ':', '.', 1000, pad3)   // HH:MM:SS.mmm
const tsSBV = tsFormat(':', ':', ',', 1000, pad3)   // HH:MM:SS,mmm
const tsASS = tsFormat(':', ':', '.', 100, pad2)    // H:MM:SS.cc
const tsSSA = tsFormat(':', ':', ':', 30, pad2)     // H:MM:SS:ff (30fps frames)

// ─── 格式化函数 ─────────────────────────────────────────────────────
function formatSRT(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''
  return subs.map((sub, i) =>
    `${i + 1}
${tsSRT(sub.startTime)} --> ${tsSRT(sub.endTime)}
${sub.text}`
  ).join('\n\n')
}

function formatVTT(subs: SubtitleItem[]): string {
  if (!subs?.length) return 'WEBVTT\n\n'
  const content = subs.map((sub, i) =>
    `${i + 1}
${tsVTT(sub.startTime)} --> ${tsVTT(sub.endTime)}
${sub.text}`
  ).join('\n\n')
  return `WEBVTT

${content}`
}

function formatASS(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''

  const header = `[Script Info]
Title: sublens Export
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  return `${header}
${formatAssEvents(subs, tsASS)}`
}

function formatSSA(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''

  const header = `[Script Info]
Title: sublens Export
ScriptType:v4.00+
Collisions:Normal
PlayDepth:0

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,20,16777215,65535,255,0,-1,0,1,2,2,2,10,10,10,0,1

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  return `${header}
${formatAssEvents(subs, tsSSA, 'Marked=0')}`
}

function formatJSON(subs: SubtitleItem[]): string {
  if (!subs?.length) return JSON.stringify({ subtitles: [], generatedAt: new Date().toISOString() })
  return JSON.stringify({
    version: '3.0',
    generatedAt: new Date().toISOString(),
    tool: 'sublens',
    subtitles: subs.map(sub => ({
      index: sub.index,
      startTime: sub.startTime,
      endTime: sub.endTime,
      startFrame: sub.startFrame,
      endFrame: sub.endFrame,
      text: sub.text,
      confidence: sub.confidence,
      language: sub.language,
      roi: sub.roi,
    }))
  }, null, 2)
}

function formatTXT(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''
  return subs.map(sub => sub.text).join('\n')
}

function formatLRC(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''

  const header = `[ti:sublens Export]
[ar:sublens]
[al:Subtitle Export]
[by:sublens v3.0]
[offset:0]
[re:sublens]

`
  const content = subs.map(sub => {
    return `${formatTimeLrc(sub.startTime)}${sub.text}`
  }).join('\n\n')

  return `${header}${content}`
}

function formatSBV(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''
  return subs.map(sub =>
    `${tsSBV(sub.startTime)},${tsSBV(sub.endTime)}
${sub.text}`
  ).join('\n\n')
}

const CSV_HEADER = 'Index,StartTime,EndTime,StartFrame,EndFrame,Text,Confidence\n'

function formatCSV(subs: SubtitleItem[]): string {
  if (!subs?.length) return CSV_HEADER
  const rows = subs.map(sub => {
    const escaped = `"${sub.text.replace(/"/g, '""')}"`
    return `${sub.index},${sub.startTime.toFixed(3)},${sub.endTime.toFixed(3)},${sub.startFrame},${sub.endFrame},${escaped},${sub.confidence.toFixed(3)}`
  }).join('\n')
  return CSV_HEADER + rows
}

// ─── WebVTT with Styles ──────────────────────────────────────────
export interface VTTStyle {
  background?: string
  color?: string
  fontSize?: string
  fontFamily?: string
}

export function exportVTTWithStyle(subs: SubtitleItem[], style: VTTStyle = {}): string {
  const {
    background = 'rgba(0,0,0,0.8)',
    color = 'white',
    fontSize = '1.2em',
    fontFamily = 'sans-serif',
  } = style

  if (!subs?.length) {
    return `WEBVTT

STYLE
::cue {
  background: ${background};
  color: ${color};
  font-size: ${fontSize};
  font-family: ${fontFamily};
  line-height: 1.4;
}

`
  }

  const header = `WEBVTT

STYLE
::cue {
  background: ${background};
  color: ${color};
  font-size: ${fontSize};
  font-family: ${fontFamily};
  line-height: 1.4;
}
`

  const body = subs.map(sub => {
    const start = tsVTT(sub.startTime)
    const end = tsVTT(sub.endTime)
    return `${start} --> ${end}\n${sub.text}`
  }).join('\n\n')

  return header + body + '\n'
}

// ─── JSONL (Line-delimited JSON) ──────────────────────────────────
export function exportJSONL(subs: SubtitleItem[]): string {
  if (!subs?.length) return ''
  return subs.map(sub => JSON.stringify({
    start: Math.round(sub.startTime * 1000) / 1000,
    end: Math.round(sub.endTime * 1000) / 1000,
    text: sub.text,
    confidence: Math.round(sub.confidence * 100) / 100,
  })).join('\n') + '\n'
}

// ─── Exporter 主类 ─────────────────────────────────────────────────
export interface ExportResult {
  format: ExportFormat
  content: string
  filename: string
}

export class Exporter {
  private readonly FORMATTERS: Record<ExportFormat, (subs: SubtitleItem[]) => string> = {
    srt: formatSRT,
    vtt: formatVTT,
    vtt_styled: (subs) => exportVTTWithStyle(subs),
    ass: formatASS,
    ssa: formatSSA,
    json: formatJSON,
    jsonl: exportJSONL,
    txt: formatTXT,
    lrc: formatLRC,
    sbv: formatSBV,
    csv: formatCSV,
  }

  /**
   * 导出单格式
   */
  export(subs: SubtitleItem[], format: ExportFormat): ExportResult {
    const formatter = this.FORMATTERS[format] ?? formatTXT
    return {
      format,
      content: formatter(subs),
      filename: `subtitles.${format}`,
    }
  }

  /**
   * 批量导出多个格式
   */
  exportBatch(subs: SubtitleItem[], formats: ExportFormat[]): ExportResult[] {
    return formats.map(f => this.export(subs, f))
  }

  /**
   * 导出全部已启用的格式（传入格式开关对象）
   */
  exportAll(
    subs: SubtitleItem[],
    enabledFormats: Partial<Record<ExportFormat, boolean>>
  ): ExportResult[] {
    return (Object.keys(enabledFormats) as ExportFormat[])
      .filter(f => enabledFormats[f])
      .map(f => this.export(subs, f))
  }

  /** 获取所有支持的格式列表 */
  getSupportedFormats(): ExportFormat[] {
    return Object.keys(this.FORMATTERS) as ExportFormat[]
  }
}

// ─── 全局单例（避免重复实例化开销）─────────────────────────────────
let _instance: Exporter | null = null

export function getExporter(): Exporter {
  if (!_instance) _instance = new Exporter()
  return _instance
}