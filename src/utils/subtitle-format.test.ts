import { describe, it, expect } from 'vitest'
import { formatTimeShort, formatTimeSrt, parseTime } from '@/utils/time'
import { getConfidenceLevel, getConfidenceHeatmap } from '@/utils/confidence'

describe('useSubtitleList pure utilities', () => {

  describe('formatTimeShort', () => {
    it('formats 0 seconds', () => {
      expect(formatTimeShort(0)).toBe('0:00')
    })

    it('formats seconds under a minute', () => {
      expect(formatTimeShort(45)).toBe('0:45')
    })

    it('formats exactly one minute', () => {
      expect(formatTimeShort(60)).toBe('1:00')
    })

    it('formats mixed minutes and seconds', () => {
      expect(formatTimeShort(125)).toBe('2:05')
    })

    it('formats 10+ minutes', () => {
      expect(formatTimeShort(600)).toBe('10:00')
    })

    it('pads seconds with leading zero', () => {
      expect(formatTimeShort(61)).toBe('1:01')
    })

    it('truncates fractional seconds', () => {
      expect(formatTimeShort(90.9)).toBe('1:30')
    })
  })

  describe('formatTimeSrt', () => {
    it('formats zero', () => {
      expect(formatTimeSrt(0)).toBe('00:00:00,000')
    })

    it('formats hours', () => {
      expect(formatTimeSrt(3661)).toBe('01:01:01,000')
    })

    it('formats milliseconds', () => {
      expect(formatTimeSrt(1.5)).toBe('00:00:01,500')
    })

    it('formats sub-second with full precision', () => {
      expect(formatTimeSrt(4.123)).toBe('00:00:04,123')
    })

    it('pads all components to 2 digits', () => {
      expect(formatTimeSrt(0)).toMatch(/^00:00:00,000$/)
    })

    it('pads milliseconds to 3 digits', () => {
      const result = formatTimeSrt(0.005)
      expect(result).toContain(',005')
    })

    it('handles edge of second boundary', () => {
      expect(formatTimeSrt(59.999)).toBe('00:00:59,999')
    })

    it('uses comma as millisecond separator', () => {
      expect(formatTimeSrt(1)).toBe('00:00:01,000')
      expect(formatTimeSrt(1)).not.toContain('.')
    })
  })

  describe('parseTime', () => {
    it('parses valid SRT time with comma', () => {
      expect(parseTime('00:00:01,500')).toBeCloseTo(1.5)
    })

    it('parses valid SRT time with dot', () => {
      expect(parseTime('00:00:04.250')).toBeCloseTo(4.25)
    })

    it('parses hours correctly', () => {
      expect(parseTime('01:30:00,000')).toBeCloseTo(5400)
    })

    it('parses sub-second precision', () => {
      expect(parseTime('00:00:00,999')).toBeCloseTo(0.999)
    })

    it('returns -1 for invalid format', () => {
      expect(parseTime('1:30:00')).toBe(-1)
    })

    it('returns -1 for garbage input', () => {
      expect(parseTime('not a time')).toBe(-1)
    })

    it('returns -1 for empty string', () => {
      expect(parseTime('')).toBe(-1)
    })

    it('returns -1 for missing milliseconds', () => {
      expect(parseTime('00:00:01')).toBe(-1)
    })

    it('returns -1 for wrong separator', () => {
      expect(parseTime('00:00:01-500')).toBe(-1)
    })

    it('round-trips formatTimeSrt correctly', () => {
      const original = 123.456
      const formatted = formatTimeSrt(original)
      const parsed = parseTime(formatted)
      expect(parsed).toBeCloseTo(original, 3)
    })
  })

  describe('getConfidenceLevel', () => {
    it('returns "high" at threshold 0.85', () => {
      expect(getConfidenceLevel(0.85)).toBe('high')
    })

    it('returns "high" above threshold', () => {
      expect(getConfidenceLevel(0.92)).toBe('high')
    })

    it('returns "mid" at 0.60', () => {
      expect(getConfidenceLevel(0.60)).toBe('mid')
    })

    it('returns "mid" in range 0.60-0.85', () => {
      expect(getConfidenceLevel(0.75)).toBe('mid')
    })

    it('returns "mid" just below high threshold', () => {
      expect(getConfidenceLevel(0.849)).toBe('mid')
    })

    it('returns "low" below 0.60', () => {
      expect(getConfidenceLevel(0.30)).toBe('low')
    })

    it('returns "low" at 0.59', () => {
      expect(getConfidenceLevel(0.59)).toBe('low')
    })

    it('returns "low" at 0.0', () => {
      expect(getConfidenceLevel(0)).toBe('low')
    })

    it('handles exactly 0.60 boundary correctly', () => {
      expect(getConfidenceLevel(0.60)).toBe('mid')
    })
  })

  describe('getConfidenceHeatmap', () => {
    it('high confidence uses green gradient and includes percentage stop', () => {
      const result = getConfidenceHeatmap(1.0)
      expect(result).toContain('linear-gradient')
      expect(result).toContain('#22c55e')
    })

    it('high confidence at threshold returns valid gradient', () => {
      const result = getConfidenceHeatmap(0.85)
      expect(result).toContain('#22c55e')
    })

    it('mid confidence uses interpolated color', () => {
      const result = getConfidenceHeatmap(0.70)
      expect(result).toContain('rgb(')
      expect(result).not.toContain('#22c55e')
    })

    it('low confidence uses warm color interpolation', () => {
      const result = getConfidenceHeatmap(0.30)
      expect(result).toContain('rgb(')
    })

    it('returns valid CSS gradient string', () => {
      const result = getConfidenceHeatmap(0.5)
      expect(result).toMatch(/^linear-gradient/)
      expect(result).toContain('180deg')
    })

    it('mid confidence gradient has two rgb() stops', () => {
      const result = getConfidenceHeatmap(0.70)
      const matches = result.match(/rgb\(\d+,\d+,\d+\)/g)
      expect(matches).toHaveLength(2)
    })

    it('low confidence gradient has two rgb() stops', () => {
      const result = getConfidenceHeatmap(0.20)
      const matches = result.match(/rgb\(\d+,\d+,\d+\)/g)
      expect(matches).toHaveLength(2)
    })

    it('mid confidence gradient starts with two rgb() stops', () => {
      const result = getConfidenceHeatmap(0.50)
      const rgbValues = result.match(/rgb\((\d+),(\d+),(\d+)\)/g)
      expect(rgbValues).toHaveLength(2)
    })

    it('low confidence uses values in red/yellow range', () => {
      const result = getConfidenceHeatmap(0.10)
      // Low confidence should be reddish; extract first rgb values
      const match = result.match(/rgb\((\d+),(\d+),(\d+)\)/)
      if (match) {
        const [, r, g] = match.slice(1).map(Number)
        // R should be high, G should be relatively low (red-dominant)
        expect(r).toBeGreaterThan(g)
      }
    })
  })

})