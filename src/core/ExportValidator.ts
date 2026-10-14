/**
 * @file ExportValidator.ts
 * @description 导出前时间轴与文本质量校验（纯函数）。
 *
 * 目的：把「导出后才发现字幕有问题」变成「导出前给出可读摘要」，
 * 覆盖空文本、时间轴倒序 / 重叠、超长条目与低置信度条目。
 */

import type { OCRItem } from '@/services/ocr/IOCREngine'

export type ExportIssueLevel = 'error' | 'warning'

export type ExportIssueCode =
  | 'empty-text'
  | 'invalid-range'
  | 'out-of-order'
  | 'overlap'
  | 'long-duration'
  | 'low-confidence'
  | 'empty-timeline'

export interface ExportIssue {
  level: ExportIssueLevel
  code: ExportIssueCode
  message: string
  /** 关联字幕序号（从 1 开始），无关联时为 null */
  index: number | null
}

export interface ExportValidationStats {
  total: number
  /** 会被跳过的条目数（空文本或非法时间区间） */
  exportable: number
  emptyText: number
  invalidRange: number
  overlaps: number
  outOfOrder: number
  longDuration: number
  lowConfidence: number
  /** 有效字幕覆盖时长（毫秒） */
  durationMs: number
}

export interface ExportValidationSummary {
  /** 无 error 级问题时才允许直接导出 */
  ok: boolean
  issues: ExportIssue[]
  stats: ExportValidationStats
}

/** 单条字幕最长建议时长（毫秒），超过提示可能未正确切分 */
export const MAX_SUBTITLE_DURATION_MS = 20_000
/** 低置信度告警阈值（0~100） */
export const LOW_CONFIDENCE_THRESHOLD = 60

function isMeaningful(text: string | undefined): boolean {
  return typeof text === 'string' && text.trim().length > 0
}

/**
 * 校验字幕列表是否可安全导出。
 */
export function validateSubtitleTimeline(items: readonly OCRItem[]): ExportValidationSummary {
  const issues: ExportIssue[] = []
  const stats: ExportValidationStats = {
    total: items.length,
    exportable: 0,
    emptyText: 0,
    invalidRange: 0,
    overlaps: 0,
    outOfOrder: 0,
    longDuration: 0,
    lowConfidence: 0,
    durationMs: 0,
  }

  if (items.length === 0) {
    issues.push({
      level: 'error',
      code: 'empty-timeline',
      message: '当前没有可导出的字幕，请先完成提取',
      index: null,
    })
    return { ok: false, issues, stats }
  }

  let previous: OCRItem | null = null

  items.forEach((item, position) => {
    const index = position + 1
    const duration = item.endTime - item.startTime
    let exportable = true

    if (!isMeaningful(item.text)) {
      stats.emptyText += 1
      exportable = false
      issues.push({
        level: 'error',
        code: 'empty-text',
        message: `第 ${index} 条字幕文本为空，导出时将跳过`,
        index,
      })
    }

    if (duration <= 0) {
      stats.invalidRange += 1
      exportable = false
      issues.push({
        level: 'error',
        code: 'invalid-range',
        message: `第 ${index} 条字幕时间区间非法（结束不晚于开始）`,
        index,
      })
    } else if (duration > MAX_SUBTITLE_DURATION_MS) {
      stats.longDuration += 1
      issues.push({
        level: 'warning',
        code: 'long-duration',
        message: `第 ${index} 条字幕持续 ${(duration / 1000).toFixed(1)} 秒，可能未正确切分`,
        index,
      })
    }

    if (item.confidence > 0 && item.confidence < LOW_CONFIDENCE_THRESHOLD) {
      stats.lowConfidence += 1
      issues.push({
        level: 'warning',
        code: 'low-confidence',
        message: `第 ${index} 条字幕置信度偏低（${Math.round(item.confidence)}%）`,
        index,
      })
    }

    if (previous) {
      if (item.startTime < previous.startTime) {
        stats.outOfOrder += 1
        issues.push({
          level: 'warning',
          code: 'out-of-order',
          message: `第 ${index} 条字幕时间早于上一条，时间轴未按顺序排列`,
          index,
        })
      } else if (item.startTime < previous.endTime && duration > 0) {
        stats.overlaps += 1
        issues.push({
          level: 'warning',
          code: 'overlap',
          message: `第 ${index} 条字幕与上一条时间重叠`,
          index,
        })
      }
    }

    if (exportable && duration > 0) {
      stats.exportable += 1
      stats.durationMs += duration
    }

    previous = item
  })

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    issues,
    stats,
  }
}

/** 把校验结果渲染成通知栏可用的单行摘要 */
export function formatExportSummary(summary: ExportValidationSummary): string {
  const { stats } = summary
  if (stats.total === 0) return '没有可导出的字幕'

  const parts = [`${stats.exportable}/${stats.total} 条可导出`]
  if (stats.emptyText > 0) parts.push(`${stats.emptyText} 条空文本`)
  if (stats.invalidRange > 0) parts.push(`${stats.invalidRange} 条时间非法`)
  if (stats.overlaps > 0) parts.push(`${stats.overlaps} 处重叠`)
  if (stats.outOfOrder > 0) parts.push(`${stats.outOfOrder} 处乱序`)
  if (stats.longDuration > 0) parts.push(`${stats.longDuration} 条过长`)
  if (stats.lowConfidence > 0) parts.push(`${stats.lowConfidence} 条低置信度`)
  return parts.join('，')
}

/** 过滤掉不可导出的条目（空文本与非法区间），保持输入顺序 */
export function filterExportable(items: readonly OCRItem[]): OCRItem[] {
  return items.filter((item) => isMeaningful(item.text) && item.endTime > item.startTime)
}
