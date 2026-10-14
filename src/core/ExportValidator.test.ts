import { describe, expect, it } from 'vitest'
import {
  MAX_SUBTITLE_DURATION_MS,
  filterExportable,
  formatExportSummary,
  validateSubtitleTimeline,
} from './ExportValidator'
import type { OCRItem } from '@/services/ocr/IOCREngine'

function item(overrides: Partial<OCRItem> = {}): OCRItem {
  return { id: 'a', startTime: 0, endTime: 1000, text: '字幕', confidence: 95, ...overrides }
}

describe('validateSubtitleTimeline', () => {
  it('空列表判定为不可导出', () => {
    const summary = validateSubtitleTimeline([])
    expect(summary.ok).toBe(false)
    expect(summary.issues[0].code).toBe('empty-timeline')
  })

  it('健康时间轴判定为可导出且无问题', () => {
    const summary = validateSubtitleTimeline([
      item({ id: '1', startTime: 0, endTime: 1000 }),
      item({ id: '2', startTime: 1200, endTime: 2200 }),
    ])
    expect(summary.ok).toBe(true)
    expect(summary.issues).toEqual([])
    expect(summary.stats.exportable).toBe(2)
    expect(summary.stats.durationMs).toBe(2000)
  })

  it('空文本与非法区间计为 error 并从可导出条目中剔除', () => {
    const summary = validateSubtitleTimeline([
      item({ id: '1', text: '   ' }),
      item({ id: '2', startTime: 500, endTime: 500 }),
      item({ id: '3', startTime: 1000, endTime: 2000 }),
    ])

    expect(summary.ok).toBe(false)
    expect(summary.stats.emptyText).toBe(1)
    expect(summary.stats.invalidRange).toBe(1)
    expect(summary.stats.exportable).toBe(1)
  })

  it('重叠、乱序、超长与低置信度记为 warning', () => {
    const summary = validateSubtitleTimeline([
      item({ id: '1', startTime: 0, endTime: 5000, confidence: 30 }),
      item({ id: '2', startTime: 4000, endTime: 6000 }),
      item({ id: '3', startTime: 3000, endTime: 3200 }),
      item({ id: '4', startTime: 7000, endTime: 7000 + MAX_SUBTITLE_DURATION_MS + 1000 }),
    ])

    expect(summary.ok).toBe(true)
    const codes = summary.issues.map((issue) => issue.code)
    expect(codes).toContain('overlap')
    expect(codes).toContain('out-of-order')
    expect(codes).toContain('long-duration')
    expect(codes).toContain('low-confidence')
    expect(summary.issues.every((issue) => issue.level === 'warning')).toBe(true)
  })

  it('formatExportSummary 输出可读摘要', () => {
    const summary = validateSubtitleTimeline([
      item({ id: '1', text: '' }),
      item({ id: '2', startTime: 1000, endTime: 2000 }),
    ])
    const text = formatExportSummary(summary)
    expect(text).toContain('1/2 条可导出')
    expect(text).toContain('1 条空文本')
  })
})

describe('filterExportable', () => {
  it('过滤空文本与非法区间且保持顺序', () => {
    const items = [
      item({ id: '1', text: '' }),
      item({ id: '2', startTime: 0, endTime: 1000 }),
      item({ id: '3', startTime: 1000, endTime: 1000 }),
      item({ id: '4', startTime: 2000, endTime: 3000, text: '保留' }),
    ]

    expect(filterExportable(items).map((entry) => entry.id)).toEqual(['2', '4'])
  })
})
