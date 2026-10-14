/**
 * @file SubtitleExporter.ts
 * @description 导出适配器：把工作区的 `OCRItem`（毫秒 / 0~100 置信度）
 * 映射为领域格式模型 `SubtitleItem`（秒 / 0~1 置信度），并复用 `core/Exporter` 的格式引擎。
 *
 * 重构说明：此前该文件与 `core/Exporter.ts` 各自维护一套格式实现（且前端只支持 4 种格式，
 * 后端支持 9 种）。现在格式逻辑唯一收敛在 `core/Exporter`，本文件只负责模型转换与浏览器下载降级。
 */

import { getExporter } from '@/core/Exporter'
import type { OCRItem } from '@/services/ocr/IOCREngine'
import type { ExportFormat, SubtitleItem } from '@/types/subtitle'
import type { ROI } from '@/types/video'

export type { ExportFormat }

const FORMAT_MIME: Record<string, string> = {
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
  vtt_styled: 'text/vtt;charset=utf-8',
  ass: 'text/plain;charset=utf-8',
  ssa: 'text/plain;charset=utf-8',
  sbv: 'text/plain;charset=utf-8',
  lrc: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  jsonl: 'application/x-ndjson;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
}

/** 无 ROI 信息时使用的默认选区（底部字幕带） */
const DEFAULT_ROI: ROI = {
  id: 'bottom',
  name: '底部字幕',
  type: 'bottom',
  x: 0,
  y: 85,
  width: 100,
  height: 15,
  unit: 'percent',
  enabled: true,
}

/** 把归一化 ROI 转为 percent 单位的 ROI 描述 */
function toROI(roi: OCRItem['roi']): ROI {
  if (!roi) return { ...DEFAULT_ROI }
  return {
    ...DEFAULT_ROI,
    type: 'custom',
    x: Number((roi.x * 100).toFixed(2)),
    y: Number((roi.y * 100).toFixed(2)),
    width: Number((roi.width * 100).toFixed(2)),
    height: Number((roi.height * 100).toFixed(2)),
  }
}

export class SubtitleExporter {
  /** 领域模型转换：毫秒 → 秒，0~100 → 0~1 */
  public static toSubtitleItems(items: readonly OCRItem[]): SubtitleItem[] {
    return items.map((item, position) => {
      const startSeconds = item.startTime / 1000
      const endSeconds = (item.endTime > item.startTime ? item.endTime : item.startTime + 2000) / 1000
      return {
        id: item.id,
        index: position + 1,
        startTime: Number(startSeconds.toFixed(3)),
        endTime: Number(endSeconds.toFixed(3)),
        startFrame: Math.round(startSeconds * 25),
        endFrame: Math.round(endSeconds * 25),
        text: item.text,
        confidence: Number((item.confidence / 100).toFixed(4)),
        roi: toROI(item.roi),
        thumbnailUrls: [],
        edited: false,
      }
    })
  }

  /** 序列化为目标格式文本（支持全部导出格式） */
  public static exportToString(items: readonly OCRItem[], format: ExportFormat): string {
    return getExporter().export(this.toSubtitleItems(items), format).content
  }

  /** 该格式对应的 MIME 类型 */
  public static mimeTypeFor(format: ExportFormat): string {
    return FORMAT_MIME[format] ?? FORMAT_MIME.txt
  }

  /** 浏览器环境下的下载降级路径 */
  public static downloadFile(
    content: string,
    filename: string,
    mimeType: string = FORMAT_MIME.txt,
  ): void {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}
