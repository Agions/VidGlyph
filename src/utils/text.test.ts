import { describe, it, expect } from 'vitest'
import {
  isCJKText,
  hasCJKChars,
  normalizeCJKPunct,
  langToScript,
  FULLWIDTH_PUNCT_MAP,
  calculateLevenshteinSimilarity,
  areSubtitlesMergeable,
} from './text'

describe('isCJKText', () => {
  it('returns false for empty string', () => {
    expect(isCJKText('')).toBe(false)
  })

  it('returns true for pure Chinese text', () => {
    expect(isCJKText('你好世界')).toBe(true)
  })

  it('returns true for pure Japanese text', () => {
    expect(isCJKText('こんにちは')).toBe(true)
  })

  it('returns true for pure Korean text', () => {
    expect(isCJKText('안녕하세요')).toBe(true)
  })

  it('returns false for pure ASCII text', () => {
    expect(isCJKText('Hello World')).toBe(false)
  })

  it('returns false for text that is mostly Latin with few CJK chars', () => {
    expect(isCJKText('Hello 你好 World')).toBe(false)
  })

  it('returns true when CJK exceeds 50%', () => {
    // 4 CJK out of 6 total = 66% > 50%
    expect(isCJKText('你好你好AB')).toBe(true)
  })

  it('returns false when CJK is exactly 50%', () => {
    // "你好AB" = 4 chars, 2 CJK = 50%, not > 50%
    expect(isCJKText('你好AB')).toBe(false)
  })

  it('handles mixed full-width and half-width', () => {
    expect(isCJKText('テスト')).toBe(true)
  })
})

describe('hasCJKChars', () => {
  it('returns false for empty string', () => {
    expect(hasCJKChars('')).toBe(false)
  })

  it('returns true for Chinese characters', () => {
    expect(hasCJKChars('中')).toBe(true)
  })

  it('returns true for Japanese hiragana', () => {
    expect(hasCJKChars('あ')).toBe(true)
  })

  it('returns true for Japanese katakana', () => {
    expect(hasCJKChars('ア')).toBe(true)
  })

  it('returns true for Korean hangul', () => {
    expect(hasCJKChars('가')).toBe(true)
  })

  it('returns false for pure ASCII', () => {
    expect(hasCJKChars('hello')).toBe(false)
  })

  it('returns true even if only one CJK char among Latin', () => {
    expect(hasCJKChars('Hello 你')).toBe(true)
  })
})

describe('normalizeCJKPunct', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeCJKPunct('')).toBe('')
  })

  it('replaces Chinese comma', () => {
    expect(normalizeCJKPunct('你好，世界')).toBe('你好,世界')
  })

  it('replaces Chinese period', () => {
    expect(normalizeCJKPunct('结束。')).toBe('结束.')
  })

  it('replaces multiple punctuation marks', () => {
    expect(normalizeCJKPunct('问？答！')).toBe('问?答!')
  })

  it('replaces parentheses', () => {
    expect(normalizeCJKPunct('（注释）')).toBe('(注释)')
  })

  it('replaces square brackets', () => {
    expect(normalizeCJKPunct('【标题】')).toBe('[标题]')
  })

  it('replaces Japanese quotation marks', () => {
    expect(normalizeCJKPunct('「引用」')).toBe('"引用"')
  })

  it('replaces Japanese corner brackets', () => {
    expect(normalizeCJKPunct('『強調』')).toBe("'強調'")
  })

  it('replaces ideographic comma (、)', () => {
    expect(normalizeCJKPunct('猫、狗、鱼')).toBe('猫,狗,鱼')
  })

  it('replaces semicolon and colon', () => {
    expect(normalizeCJKPunct('甲；乙：丙')).toBe('甲;乙:丙')
  })

  it('preserves Latin punctuation that is not in the map', () => {
    expect(normalizeCJKPunct('abc-123')).toBe('abc-123')
  })

  it('handles a string with all mapped punctuation types', () => {
    const input = '，。！？：；（）【】「」『』、'
    // Build expected from the actual map to avoid quoting issues
    const expected = Object.values(FULLWIDTH_PUNCT_MAP).join('')
    expect(normalizeCJKPunct(input)).toBe(expected)
  })
})

describe('langToScript', () => {
  it('returns chinese for zh', () => {
    expect(langToScript('zh')).toBe('chinese')
  })

  it('returns chinese for chi', () => {
    expect(langToScript('chi')).toBe('chinese')
  })

  it('returns chinese for ch', () => {
    expect(langToScript('ch')).toBe('chinese')
  })

  it('returns chinese for zho', () => {
    expect(langToScript('zho')).toBe('chinese')
  })

  it('returns japanese for ja', () => {
    expect(langToScript('ja')).toBe('japanese')
  })

  it('returns japanese for jpn', () => {
    expect(langToScript('jpn')).toBe('japanese')
  })

  it('returns japanese for jap', () => {
    expect(langToScript('jap')).toBe('japanese')
  })

  it('returns korean for ko', () => {
    expect(langToScript('ko')).toBe('korean')
  })

  it('returns korean for kor', () => {
    expect(langToScript('kor')).toBe('korean')
  })

  it('returns korean for korean', () => {
    expect(langToScript('korean')).toBe('korean')
  })

  it('returns latin for en', () => {
    expect(langToScript('en')).toBe('latin')
  })

  it('returns latin for eng', () => {
    expect(langToScript('eng')).toBe('latin')
  })

  it('returns latin for latin', () => {
    expect(langToScript('latin')).toBe('latin')
  })

  it('returns other for unknown language code', () => {
    expect(langToScript('fr')).toBe('other')
  })

  it('returns other for empty string', () => {
    expect(langToScript('')).toBe('other')
  })

  it('returns other for random string', () => {
    expect(langToScript('xyz')).toBe('other')
  })
})

describe('FULLWIDTH_PUNCT_MAP', () => {
  it('contains expected number of mappings', () => {
    expect(Object.keys(FULLWIDTH_PUNCT_MAP).length).toBe(15)
  })

  it('maps comma correctly', () => {
    expect(FULLWIDTH_PUNCT_MAP['，']).toBe(',')
  })

  it('maps period correctly', () => {
    expect(FULLWIDTH_PUNCT_MAP['。']).toBe('.')
  })
})

describe('calculateLevenshteinSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(calculateLevenshteinSimilarity('今天天气很好', '今天天气很好')).toBe(1.0)
    expect(calculateLevenshteinSimilarity('Hello world', 'Hello world')).toBe(1.0)
  })

  it('returns 0.0 when one string is empty', () => {
    expect(calculateLevenshteinSimilarity('', 'abc')).toBe(0.0)
    expect(calculateLevenshteinSimilarity('def', '')).toBe(0.0)
  })

  it('handles partial substring inclusion with high similarity', () => {
    // 逐字/包含字幕
    const sim = calculateLevenshteinSimilarity('欢迎来到这个世界', '欢迎来到这个世界！')
    expect(sim).toBeGreaterThanOrEqual(0.85)
  })

  it('returns higher similarity for minor typos', () => {
    const sim = calculateLevenshteinSimilarity('人工智能改变生活', '人工知能改变生活')
    expect(sim).toBeGreaterThanOrEqual(0.8)
  })
})

describe('areSubtitlesMergeable', () => {
  it('returns true for same text within gap', () => {
    expect(areSubtitlesMergeable('你好世界', '你好世界', 1000, 1500, 2000)).toBe(true)
  })

  it('returns false when time gap exceeds threshold', () => {
    expect(areSubtitlesMergeable('你好世界', '你好世界', 1000, 4000, 2000)).toBe(false)
  })

  it('returns false for completely different text', () => {
    expect(areSubtitlesMergeable('第一句话在这里', '完全不同的一段话', 1000, 1500, 2000)).toBe(false)
  })

  it('returns false for reverse timestamps', () => {
    expect(areSubtitlesMergeable('你好', '你好', 5000, 2000, 2000)).toBe(false)
  })
})

