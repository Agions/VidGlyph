/**
 * 字幕查找工具 — 提取自 VideoPreview.vue 的 currentSubtitle 计算属性
 * 提供 O(log n) 二分查找，适用于按 startTime 排序的字幕列表。
 */

import type { SubtitleItem } from '@/types/subtitle'

/**
 * 在已排序的字幕列表中查找当前时间点对应的字幕。
 * 利用 startTime 有序性进行二分查找，时间复杂度 O(log n)。
 *
 * @param subtitles 按 startTime 升序排列的字幕数组
 * @param currentTime 当前播放时间（秒）
 * @param startIdx 起始搜索索引（用于增量搜索优化，默认 0）
 * @returns 匹配的字幕项，未找到返回 null
 */
export function findSubtitleAtTime(
  subtitles: SubtitleItem[],
  currentTime: number,
  startIdx = 0,
): SubtitleItem | null {
  if (subtitles.length === 0) return null

  let lo = startIdx
  let hi = subtitles.length - 1
  let result: SubtitleItem | null = null

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const sub = subtitles[mid]
    if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
      result = sub
      break
    } else if (currentTime < sub.startTime) {
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  return result
}

/** 低置信度阈值（0~100），与导出校验保持一致 */
export const LOW_CONFIDENCE_LIMIT = 60

export type ConfidenceFilter = 'all' | 'low' | 'high'

export interface SubtitleFilterRequest {
  /** 关键词（大小写不敏感，支持空白分隔的多关键词 AND 匹配） */
  keyword?: string
  /** 置信度筛选档位 */
  confidence?: ConfidenceFilter
  /** 是否只保留被人工编辑过的条目（无该字段时忽略） */
  onlyEdited?: boolean
}

/**
 * 按关键词与置信度筛选字幕条目（纯函数，泛型以兼容 OCRItem / SubtitleItem）。
 */
export function filterSubtitleItems<T extends { text: string; confidence: number; edited?: boolean }>(
  items: readonly T[],
  request: SubtitleFilterRequest = {},
): T[] {
  const keywords = (request.keyword ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)

  const confidence = request.confidence ?? 'all'

  return items.filter((item) => {
    if (keywords.length > 0) {
      const haystack = item.text.toLowerCase()
      if (!keywords.every((token) => haystack.includes(token))) return false
    }

    const score = normalizeConfidence(item.confidence)
    if (confidence === 'low' && score >= LOW_CONFIDENCE_LIMIT) return false
    if (confidence === 'high' && score < 90) return false

    if (request.onlyEdited && item.edited !== true) return false

    return true
  })
}

/** 兼容 0~1 与 0~100 两种置信度量纲 */
export function normalizeConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  return confidence <= 1 ? confidence * 100 : confidence
}
