import { describe, it, expect, beforeEach } from 'vitest'
import { Exporter } from './Exporter'
import type { SubtitleItem } from '@/types/subtitle'
import type { ROI } from '@/types/video'

function makeROI(): ROI {
  return { id: 'roi-0', name: 'Default', type: 'custom', x: 0, y: 0, width: 100, height: 100, unit: 'percent', enabled: true }
}

function sub(
  startTime: number,
  endTime: number,
  text: string,
  index = 0,
  confidence = 1,
): SubtitleItem {
  return {
    id: `sub-${index}`,
    index,
    startTime,
    endTime,
    startFrame: Math.floor(startTime * 25),
    endFrame: Math.floor(endTime * 25),
    text,
    confidence,
    roi: makeROI(),
    thumbnailUrls: [],
    edited: false,
  }
}

describe('Exporter', () => {
  let exporter: Exporter

  beforeEach(() => {
    exporter = new Exporter()
  })

  // ─── formatSRT ─────────────────────────────────────────────────
  describe('formatSRT (via export)', () => {
    it('empty array returns empty string', () => {
      const result = exporter.export([], 'srt')
      expect(result.content).toBe('')
    })

    it('normal subtitles have correct 1-based index numbering', () => {
      const subs = [
        sub(0, 1, 'Hello world', 0),
        sub(1, 2, 'Second line', 1),
        sub(2, 3, 'Third line', 2),
      ]
      const result = exporter.export(subs, 'srt')
      // First subtitle starts at position 0, so index '1' at content start
      // SRT: "1\n00:00:00,000 --> 00:00:01,000\nHello world\n\n2\n..."
      expect(result.content).toContain('1\n00:00:00,000 --> 00:00:01,000')
      expect(result.content).toContain('\n2\n00:00:01,000 --> 00:00:02,000')
      expect(result.content).toContain('\n3\n00:00:02,000 --> 00:00:03,000')
    })

    it('SRT uses comma as millisecond separator (not period)', () => {
      // endTime=0.5 → 00:00:00,500 (500ms)
      const subs = [sub(0, 0.5, 'Test', 0)]
      const result = exporter.export(subs, 'srt')
      // SRT uses comma: "00:00:00,500" not "00:00:00.500"
      expect(result.content).toContain(',500')
      expect(result.content).not.toContain('.500')
    })
  })

  // ─── formatVTT ─────────────────────────────────────────────────
  describe('formatVTT (via export)', () => {
    it('empty array returns WEBVTT header only', () => {
      const result = exporter.export([], 'vtt')
      expect(result.content).toBe('WEBVTT\n\n')
    })

    it('non-empty has WEBVTT header at start', () => {
      const subs = [sub(0, 1, 'Hello', 0)]
      const result = exporter.export(subs, 'vtt')
      expect(result.content.startsWith('WEBVTT\n\n')).toBe(true)
    })

    it('VTT uses period as millisecond separator (not comma)', () => {
      // endTime=1.5 → 00:00:01.500, so we check for '.500' after the arrow
      const subs = [sub(0.0, 1.5, 'Test', 0)]
      const result = exporter.export(subs, 'vtt')
      // VTT uses period: "00:00:01.500" not "00:00:01,500"
      expect(result.content).toContain('.500')
      expect(result.content).not.toContain(',500')
    })
  })

  // ─── formatASS ─────────────────────────────────────────────────
  describe('formatASS (via export)', () => {
    it('has [Script Info] section in header', () => {
      const subs = [sub(0, 1, 'Hello', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('[Script Info]')
    })

    it('has [V4+ Styles] section in header', () => {
      const subs = [sub(0, 1, 'Hello', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('[V4+ Styles]')
    })

    it('escapes backslash in text', () => {
      const subs = [sub(0, 1, 'Hello\\World', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('Hello\\\\World')
    })

    it('escapes comma in text', () => {
      const subs = [sub(0, 1, 'Hello,World', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('Hello\\,World')
    })

    it('escapes newline in text (\\N)', () => {
      const subs = [sub(0, 1, 'Hello\nWorld', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('Hello\\NWorld')
    })

    it('escapes curly braces in text', () => {
      const subs = [sub(0, 1, 'Hello{World}', 0)]
      const result = exporter.export(subs, 'ass')
      expect(result.content).toContain('Hello\\{World\\}')
    })
  })

  // ─── formatJSON ────────────────────────────────────────────────
  describe('formatJSON (via export)', () => {
    it('empty array returns valid JSON with generatedAt', () => {
      const result = exporter.export([], 'json')
      const parsed = JSON.parse(result.content)
      expect(parsed).toHaveProperty('subtitles')
      expect(Array.isArray(parsed.subtitles)).toBe(true)
      expect(parsed.subtitles).toHaveLength(0)
      expect(parsed).toHaveProperty('generatedAt')
      expect(typeof parsed.generatedAt).toBe('string')
    })

    it('non-empty includes all subtitle fields', () => {
      const subs = [sub(0.0, 1.5, 'Hello', 0, 0.95)]
      const result = exporter.export(subs, 'json')
      const parsed = JSON.parse(result.content)
      expect(parsed.subtitles[0].text).toBe('Hello')
      expect(parsed.subtitles[0].startTime).toBe(0.0)
      expect(parsed.subtitles[0].endTime).toBe(1.5)
      expect(parsed.subtitles[0].confidence).toBe(0.95)
      expect(parsed.tool.toLowerCase()).toContain('sublens')
    })
  })

  // ─── formatTXT ─────────────────────────────────────────────────
  describe('formatTXT (via export)', () => {
    it('empty array returns empty string', () => {
      const result = exporter.export([], 'txt')
      expect(result.content).toBe('')
    })

    it('extracts text only, no timestamps', () => {
      const subs = [
        sub(0, 1, 'First line', 0),
        sub(1, 2, 'Second line', 1),
      ]
      const result = exporter.export(subs, 'txt')
      expect(result.content).toContain('First line')
      expect(result.content).toContain('Second line')
      expect(result.content).not.toContain('-->')
      expect(result.content).not.toContain('0.000')
    })

    it('joins lines with newlines', () => {
      const subs = [
        sub(0, 1, 'Line A', 0),
        sub(1, 2, 'Line B', 1),
      ]
      const result = exporter.export(subs, 'txt')
      expect(result.content).toBe('Line A\nLine B')
    })
  })
})
