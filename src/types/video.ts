/**
 * Video and OCR Types for SubLens
 *
 * ## Key Types
 *
 * - `VideoMetadata` - Video file information (dimensions, fps, duration)
 * - `ROI` - Region of Interest for subtitle detection
 * - `ExtractOptions` - Extraction configuration
 * - `OCRConfig` - OCR engine configuration
 *
 * ## ROI Coordinate System
 *
 * Coordinates can be in 'percent' (0-100) or 'pixel' units.
 * Percentages are relative to video dimensions.
 *
 * ## Confidence Levels
 *
 * Re-exported from `@/utils/confidence` for convenience.
 */

// Video Types

export interface VideoMetadata {
  path: string
  width: number
  height: number
  duration: number
  fps: number
  totalFrames: number
  codec: string
}

export interface Frame {
  index: number
  timestamp: number
  width: number
  height: number
  data?: Uint8Array
  thumbnailUrl?: string
}

// ROI preset display labels — deduplicated to avoid inline magic strings
const _ROI_BOTTOM = '底部字幕'
const _ROI_TOP    = '顶部字幕'
const _ROI_LEFT   = '左侧字幕'
const _ROI_RIGHT  = '右侧字幕'
const _ROI_CENTER = '中心字幕'

export const ROI_PRESETS: { id: string; name: string; icon: string; rect: ROI }[] = [
  { id: 'bottom', name: _ROI_BOTTOM, icon: '⬇️', rect: { id: 'bottom', name: _ROI_BOTTOM, type: 'bottom', x: 0, y: 85, width: 100, height: 15, unit: 'percent', enabled: true } },
  { id: 'top',    name: _ROI_TOP,    icon: '⬆️', rect: { id: 'top',    name: _ROI_TOP,    type: 'top',    x: 0, y: 0,  width: 100, height: 15, unit: 'percent', enabled: true } },
  { id: 'left',   name: _ROI_LEFT,   icon: '⬅️', rect: { id: 'left',   name: _ROI_LEFT,   type: 'left',   x: 0, y: 30, width: 40,  height: 40, unit: 'percent', enabled: true } },
  { id: 'right',  name: _ROI_RIGHT,  icon: '➡️', rect: { id: 'right',  name: _ROI_RIGHT,  type: 'right',  x: 60, y: 30, width: 40,  height: 40, unit: 'percent', enabled: true } },
  { id: 'center', name: _ROI_CENTER, icon: '⭕', rect: { id: 'center', name: _ROI_CENTER, type: 'center', x: 20, y: 40, width: 60,  height: 20, unit: 'percent', enabled: true } },
]

export interface ROI {
  id: string
  name: string
  type: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'custom'
  x: number
  y: number
  width: number
  height: number
  unit: 'percent' | 'pixel'
  enabled: boolean
}

export interface ExtractOptions {
  ocrEngine: OCREngine
  languages: string[]
  confidenceThreshold: number
  processingMode: ProcessingMode
  // Advanced OCR
  multiPass: boolean
  postProcess: boolean
  mergeSubtitles: boolean
  mergeThreshold: number   // similarity threshold 0-1
  // Frame processing
  sceneThreshold: number   // 0-1, chi-square threshold for scene detection
  frameInterval: number     // process every N frames
  // AI Correction
  aiCorrection: boolean
  aiEndpoint: string
  aiApiKey: string
  aiModel: string
}

export const PROCESSING_MODES = {
  fast: {
    name: '快速模式',
    description: '跳帧更多，速度快，可能遗漏少量字幕',
    icon: '🚀',
    frameInterval: 3,
    multiPass: false,
    sceneThreshold: 0.4,
    confidenceThreshold: 0.6,
  },
  standard: {
    name: '标准模式',
    description: '平衡速度与准确率（推荐）',
    icon: '⚖️',
    frameInterval: 2,
    multiPass: false,
    sceneThreshold: 0.3,
    confidenceThreshold: 0.5,
  },
  precise: {
    name: '精准模式',
    description: '逐帧检测，最准确，速度较慢',
    icon: '🎯',
    frameInterval: 1,
    multiPass: true,
    sceneThreshold: 0.2,
    confidenceThreshold: 0.4,
  },
} as const

export type ProcessingMode = keyof typeof PROCESSING_MODES

export type OCREngine = 'paddle' | 'easyocr' | 'tesseract'

export interface OCRConfig {
  engine: OCREngine
  language: string[]
  confidenceThreshold: number
}

// Re-export everything confidence-related from the canonical utils module.
// consumers: import { CONFIDENCE_HIGH, getConfidenceLevel, type ConfidenceLevel } from '@/utils/confidence'
export { CONFIDENCE_HIGH, CONFIDENCE_MID, getConfidenceLevel, type ConfidenceLevel } from '@/utils/confidence'
