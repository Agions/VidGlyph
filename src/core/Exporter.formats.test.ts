import { describe, it, expect } from 'vitest'
import { Exporter } from '@/core/Exporter'
import type { SubtitleItem } from '@/types/subtitle'
import type { ROI } from '@/types/video'

// Test helper
function makeROI(): ROI {
  return {
    id: 'bottom',
    name: 'Bottom',
    type: 'bottom',
    x: 0,
    y: 85,
    width: 100,
    height: 15,
    unit: 'percent',
    enabled: true,
  }
}

function createSub(overrides: Partial<SubtitleItem> = {}): SubtitleItem {
  return {
    id: 'test-1',
    index: 1,
    startTime: 1.5,
    endTime: 4.0,
    startFrame: 45,
    endFrame: 120,
    text: 'Hello, World!',
    confidence: 0.92,
    language: 'en',
    roi: makeROI(),
    thumbnailUrls: [],
    edited: false,
    ...overrides,
  }
}

const exporter = new Exporter()

describe('SubtitleExporter', () => {
  describe('SRT', () => {
    it('basic formatting', () => {
      const result = exporter.export([createSub()], 'srt').content
      expect(result).toContain('1')
      expect(result).toContain('00:00:01,500 --> 00:00:04,000')
      expect(result).toContain('Hello, World!')
    })

    it('multiple subtitles with index', () => {
      const result = exporter.export([
        createSub({ index: 1, startTime: 0, endTime: 2, text: 'First' }),
        createSub({ index: 2, startTime: 2, endTime: 4, text: 'Second' }),
      ], 'srt').content
      expect(result).toContain('1\n00:00:00,000 --> 00:00:02,000\nFirst')
      expect(result).toContain('2\n00:00:02,000 --> 00:00:04,000\nSecond')
    })

    it('milliseconds', () => {
      const result = exporter.export([createSub({ startTime: 1.5, endTime: 5.25 })], 'srt').content
      expect(result).toContain('00:00:01,500 --> 00:00:05,250')
    })
  })

  describe('VTT', () => {
    it('includes WEBVTT header', () => {
      const result = exporter.export([createSub()], 'vtt').content
      expect(result.startsWith('WEBVTT')).toBe(true)
    })

    it('dot separator for ms', () => {
      const result = exporter.export([createSub({ startTime: 1.5, endTime: 4 })], 'vtt').content
      expect(result).toContain('00:00:01.500 --> 00:00:04.000')
    })
  })

  describe('ASS', () => {
    it('includes script info', () => {
      const result = exporter.export([createSub()], 'ass').content
      expect(result).toContain('[Script Info]')
      expect(result).toContain('[V4+ Styles]')
      expect(result).toContain('[Events]')
    })

    it('escapes commas', () => {
      const result = exporter.export([createSub({ text: 'Hello, World' })], 'ass').content
      expect(result).toContain('Hello\\, World')
    })

    it('converts newlines to \\N', () => {
      const result = exporter.export([createSub({ text: 'Line 1\nLine 2' })], 'ass').content
      expect(result).toContain('Line 1\\NLine 2')
    })
  })

  describe('CSV', () => {
    it('header row', () => {
      const result = exporter.export([createSub()], 'csv').content
      expect(result.startsWith('Index,StartTime,EndTime,StartFrame,EndFrame,Text,Confidence')).toBe(true)
    })

    it('escapes quotes', () => {
      const result = exporter.export([createSub({ text: 'He said "hi"' })], 'csv').content
      expect(result).toContain('"He said ""hi"""')
    })
  })

  describe('LRC', () => {
    it('LRC metadata header', () => {
      const result = exporter.export([createSub()], 'lrc').content
      expect(result.toLowerCase()).toContain('export')
    })

    it('timestamp format mm:ss.xx', () => {
      const result = exporter.export([createSub({ startTime: 65.5 })], 'lrc').content
      expect(result).toContain('[01:05.50]')
    })
  })

  describe('SBV', () => {
    it('comma-separated timestamp', () => {
      const result = exporter.export([createSub({ startTime: 1.5, endTime: 4 })], 'sbv').content
      expect(result).toContain('00:01,500')
    })
  })

  describe('JSON', () => {
    it('includes metadata', () => {
      const result = exporter.export([createSub()], 'json').content
      const parsed = JSON.parse(result)
      expect(parsed.version).toBe('3.0')
      expect(parsed.tool.toLowerCase()).toContain('sublens')
    })
  })

  describe('TXT', () => {
    it('plain text only', () => {
      const result = exporter.export([createSub({ text: 'Hello' })], 'txt').content
      expect(result).toBe('Hello')
    })
  })

  describe('empty subtitle list', () => {
    it('SRT returns empty string', () => {
      const result = exporter.export([], 'srt').content
      expect(result).toBe('')
    })

    it('JSON returns valid empty object', () => {
      const result = exporter.export([], 'json').content
      const parsed = JSON.parse(result)
      expect(parsed.subtitles).toEqual([])
    })
  })

  describe('edge cases', () => {
    it('empty text', () => {
      const result = exporter.export([createSub({ text: '' })], 'srt').content
      expect(result).toBeDefined()
    })

    it('very long text', () => {
      const longText = 'A'.repeat(1000)
      const result = exporter.export([createSub({ text: longText })], 'srt').content
      expect(result).toContain(longText)
    })

    it('special characters not escaped in SRT', () => {
      const result = exporter.export([createSub({ text: '<script>alert("xss")</script>' })], 'srt').content
      expect(result).toContain('<script>')
    })
  })
})
