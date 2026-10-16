/**
 * Subtitle Types — VidGlyph
 * ==========================
 * 核心数据类型定义。
 * 格式化逻辑已迁移至 src/core/Exporter.ts。
 */

import type { ROI } from './video'

/**
 * Minimal subtitle shape used in post-processing pipelines.
 * Avoids coupling to the full SubtitleItem type.
 */
export interface SubtitleLite {
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
  text: string
  confidence: number
}

export interface SubtitleItem {
  id: string
  index: number
  startTime: number      // seconds
  endTime: number        // seconds
  startFrame: number
  endFrame: number
  text: string
  confidence: number     // 0-1
  language?: string
  translatedText?: string // bilingual translation
  roi: ROI
  thumbnailUrls: string[]
  edited: boolean         // has been manually edited
}

export type EditableField = 'text' | 'startTime' | 'endTime'
export type EditableValue = string | number

export interface SubtitleEdit {
  id: string
  field: EditableField
  oldValue: EditableValue
  newValue: EditableValue
}

/**
 * Supported export formats.
 * @see src/core/Exporter
 */
export type ExportFormat = 'srt' | 'vtt' | 'vtt_styled' | 'ass' | 'ssa' | 'json' | 'jsonl' | 'txt' | 'lrc' | 'sbv' | 'csv'

export interface ExportFormats {
  srt: boolean
  vtt: boolean
  vtt_styled: boolean
  ass: boolean
  ssa: boolean
  json: boolean
  jsonl: boolean
  txt: boolean
  lrc: boolean
  sbv: boolean
  csv: boolean
}
