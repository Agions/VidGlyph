import { describe, expect, it } from 'vitest'
import { filterSubtitleItems, normalizeConfidence } from './subtitleSearch'

const items = [
  { id: '1', text: '今天天气真好', confidence: 95 },
  { id: '2', text: '明天天气不错', confidence: 40 },
  { id: '3', text: 'Hello VidGlyph World', confidence: 88 },
]

describe('filterSubtitleItems', () => {
  it('无筛选条件时返回全部条目', () => {
    expect(filterSubtitleItems(items)).toHaveLength(3)
  })

  it('关键词大小写不敏感', () => {
    expect(filterSubtitleItems(items, { keyword: 'vidglyph' }).map((i) => i.id)).toEqual(['3'])
    expect(filterSubtitleItems(items, { keyword: 'VIDGLYPH' }).map((i) => i.id)).toEqual(['3'])
  })

  it('空格分隔的多关键词按 AND 匹配', () => {
    expect(filterSubtitleItems(items, { keyword: '天气 不错' }).map((i) => i.id)).toEqual(['2'])
    expect(filterSubtitleItems(items, { keyword: '天气 不存在' })).toEqual([])
  })

  it('按置信度档位筛选（低 <60 / 高 ≥90）', () => {
    expect(filterSubtitleItems(items, { confidence: 'low' }).map((i) => i.id)).toEqual(['2'])
    expect(filterSubtitleItems(items, { confidence: 'high' }).map((i) => i.id)).toEqual(['1'])
  })

  it('兼容 0~1 置信度量纲', () => {
    const normalized = [{ id: 'x', text: '文本', confidence: 0.5 }]
    expect(filterSubtitleItems(normalized, { confidence: 'low' }).map((i) => i.id)).toEqual(['x'])
    expect(filterSubtitleItems(normalized, { confidence: 'high' })).toEqual([])
  })

  it('关键词 + 置信度为组合条件', () => {
    expect(filterSubtitleItems(items, { keyword: '天气', confidence: 'high' }).map((i) => i.id)).toEqual(['1'])
  })

  it('onlyEdited 只保留人工编辑过的条目', () => {
    const withEdited = [
      { id: '1', text: 'a', confidence: 90, edited: true },
      { id: '2', text: 'b', confidence: 90 },
    ]
    expect(filterSubtitleItems(withEdited, { onlyEdited: true }).map((i) => i.id)).toEqual(['1'])
  })
})

describe('normalizeConfidence', () => {
  it('把 0~1 置信度放大到百分制', () => {
    expect(normalizeConfidence(0.87)).toBeCloseTo(87)
  })

  it('百分制保持不变', () => {
    expect(normalizeConfidence(87)).toBe(87)
  })

  it('非法数值返回 0', () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0)
  })
})
