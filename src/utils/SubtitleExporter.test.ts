import { describe, expect, it } from 'vitest'
import { SubtitleExporter } from './SubtitleExporter'
import type { OCRItem } from '@/services/ocr/IOCREngine'

function makeItem(overrides: Partial<OCRItem> = {}): OCRItem {
  return {
    id: 'item-1',
    startTime: 1000,
    endTime: 3000,
    text: 'Hello VidGlyph',
    confidence: 92,
    ...overrides,
  }
}

describe('SubtitleExporter 适配器', () => {
  it('把毫秒与 0~100 置信度转换为领域模型（秒 / 0~1）', () => {
    const [item] = SubtitleExporter.toSubtitleItems([makeItem()])

    expect(item).toMatchObject({
      id: 'item-1',
      index: 1,
      startTime: 1,
      endTime: 3,
      text: 'Hello VidGlyph',
    })
    expect(item.confidence).toBeCloseTo(0.92, 4)
  })

  it('结束时间缺失时按开始时间 + 2 秒兜底，避免产出零长度字幕', () => {
    const [item] = SubtitleExporter.toSubtitleItems([makeItem({ endTime: 1000 })])
    expect(item.endTime).toBe(3)
  })

  it('导出 SRT 保持序号与毫秒时间轴', () => {
    const srt = SubtitleExporter.exportToString([makeItem()], 'srt')

    expect(srt).toContain('1\n00:00:01,000 --> 00:00:03,000')
    expect(srt).toContain('Hello VidGlyph')
  })

  it('导出 VTT 带 WEBVTT 头，时间轴使用点号毫秒', () => {
    const vtt = SubtitleExporter.exportToString([makeItem()], 'vtt')

    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.000')
  })

  it('导出 TXT 仅保留文本行', () => {
    const txt = SubtitleExporter.exportToString(
      [makeItem(), makeItem({ id: 'item-2', text: 'Video Subtitle Extraction' })],
      'txt',
    )

    expect(txt).toBe('Hello VidGlyph\nVideo Subtitle Extraction')
  })

  it('支持单前端时代不具备的专业格式（统一由领域导出引擎提供）', () => {
    const ass = SubtitleExporter.exportToString([makeItem()], 'ass')
    const lrc = SubtitleExporter.exportToString([makeItem()], 'lrc')

    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('Dialogue:')
    expect(lrc).toContain('[00:01.00]Hello VidGlyph')
  })

  it('为每种格式给出正确的 MIME 类型', () => {
    expect(SubtitleExporter.mimeTypeFor('srt')).toContain('x-subrip')
    expect(SubtitleExporter.mimeTypeFor('json')).toContain('application/json')
    expect(SubtitleExporter.mimeTypeFor('csv')).toContain('text/csv')
  })
})
