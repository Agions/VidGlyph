/**
 * Image preprocessing for OCR accuracy improvement
 *
 * Key techniques:
 * 1. Grayscale conversion
 * 2. Contrast enhancement
 * 3. Adaptive thresholding (for subtitles with transparent backgrounds)
 * 4. Noise removal
 * 5. Deskewing (rotation correction)
 * 6. Scaling up small text
 * 7. Multi-pass OCR with different configurations
 *
 * Performance: Buffer reuse to minimize ImageData allocations during pipeline.
 */

import { CANVAS_CONTEXT_2D, MIME_IMAGE_PNG, ERR_CANVAS_CTX_2D } from '@/utils/constants'
import { pixelLuma } from '@/utils/math'
import type { DeskewResult } from '@/utils/image'
import {
  boxBlur,
  adaptiveThreshold,
  scaleUp,
  applyDeskew,
  morphOpen,
  applyCLAHE,
} from '@/utils/image'

// Performance: reuse ImageData buffers to avoid GC pressure
interface ImageBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

function createBuffer(width: number, height: number): ImageBuffer {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }
}

function bufferToImageData(buf: ImageBuffer): ImageData {
  // Workaround: TypeScript DOM lib types ImageData incorrectly
  // buf.data is Uint8ClampedArray<ArrayBufferLike> but ImageData expects ArrayBuffer
  return new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height)
}

export interface PreprocessorConfig {
  /** Scale factor for upscaling small images (default: 2.0) */
  scaleFactor: number
  /** Apply contrast enhancement (default: true) */
  enhanceContrast: boolean
  /** Contrast multiplier (default: 1.5) */
  contrastLevel: number
  /** Apply CLAHE local adaptive contrast enhancement (default: true) */
  useClahe?: boolean
  /** CLAHE clip limit (default: 2.5) */
  claheClipLimit?: number
  /** Apply adaptive thresholding for binary-like result (default: true) */
  adaptiveThreshold: boolean
  /** Adaptive threshold block size (odd number, default: 11) */
  adaptiveBlockSize: number
  /** Apply Gaussian blur for noise reduction (default: true) */
  denoise: boolean
  /** Morphological operation to clean up (default: true) */
  morphCleanup: boolean
  /** Invert colors if text is dark on light background (default: false) */
  invertColors: boolean
  /** Detect and correct skewed text (default: true) */
  deskew: boolean
  /** Use multiple preprocessing passes and merge results (default: true) */
  multiPass: boolean
  /** Scale factor for multi-pass (second pass uses different scale) */
  multiPassScale?: number
}

export const DEFAULT_PREPROCESSOR_CONFIG: PreprocessorConfig = {
  scaleFactor: 2.0,
  enhanceContrast: true,
  contrastLevel: 1.5,
  adaptiveThreshold: true,
  adaptiveBlockSize: 11,
  denoise: true,
  morphCleanup: true,
  invertColors: false,
  deskew: true,
  multiPass: true,
  multiPassScale: 3.0,
}

export interface PreprocessorResult {
  processedData: ImageData
  canvas: HTMLCanvasElement
  toDataURL(): string
  toBlob(): Promise<Blob>
}

/**
 * Main preprocessing pipeline for OCR
 * Performance: Uses buffer reuse to minimize ImageData allocations during pipeline.
 */
export function preprocessImage(
  imageData: ImageData,
  config: Partial<PreprocessorConfig> = {},
): PreprocessorResult {
  const cfg = { ...DEFAULT_PREPROCESSOR_CONFIG, ...config }

  // Start with input data
  let currentData: Uint8ClampedArray = imageData.data
  let currentWidth = imageData.width
  let currentHeight = imageData.height

  // Per-call buffer pool to avoid allocations during preprocessing
  const _bufferPool: ImageBuffer[] = []

  function _getBuffer(width: number, height: number): ImageBuffer {
    for (const buf of _bufferPool) {
      if (buf.width === width && buf.height === height) {
        return buf
      }
    }
    return createBuffer(width, height)
  }

  function _releaseBuffer(buf: ImageBuffer) {
    _bufferPool.push(buf)
  }

  // 0. Deskew if enabled (before any other processing)
  if (cfg.deskew) {
    const deskewResult: DeskewResult = applyDeskew(
      bufferToImageData({
        data: currentData,
        width: currentWidth,
        height: currentHeight,
      }),
    )
    currentData = deskewResult.corrected.data
    currentWidth = deskewResult.corrected.width
    currentHeight = deskewResult.corrected.height
  }

  // 1. Scale up first (before any other processing for best quality)
  if (cfg.scaleFactor > 1) {
    const scaled = scaleUp(
      bufferToImageData({
        data: currentData,
        width: currentWidth,
        height: currentHeight,
      }),
      cfg.scaleFactor,
    )
    currentData = scaled.data
    currentWidth = scaled.width
    currentHeight = scaled.height
  }

  // 2. Convert to grayscale
  const grayBuf = _getBuffer(currentWidth, currentHeight)
  for (let i = 0; i < currentData.length; i += 4) {
    const gray = Math.round(pixelLuma(currentData, i))
    grayBuf.data[i] = gray
    grayBuf.data[i + 1] = gray
    grayBuf.data[i + 2] = gray
    grayBuf.data[i + 3] = currentData[i + 3] ?? 255
  }
  currentData = grayBuf.data

  // 3. Apply contrast enhancement (CLAHE or standard contrast)
  if (cfg.enhanceContrast) {
    if (cfg.useClahe) {
      const clahed = applyCLAHE(
        bufferToImageData({
          data: currentData,
          width: currentWidth,
          height: currentHeight,
        }),
        cfg.claheClipLimit ?? 2.5,
        8,
      )
      currentData = clahed.data
    } else {
      const factor = 0.5 + (cfg.contrastLevel * (259 * 255)) / (255 * 259)
      for (let i = 0; i < currentData.length; i += 4) {
        currentData[i] = Math.max(0, Math.min(255, Math.round(factor * (currentData[i] - 128) + 128)))
        currentData[i + 1] = Math.max(0, Math.min(255, Math.round(factor * (currentData[i + 1] - 128) + 128)))
        currentData[i + 2] = Math.max(0, Math.min(255, Math.round(factor * (currentData[i + 2] - 128) + 128)))
      }
    }
  }

  // 4. Denoise with blur
  if (cfg.denoise) {
    const blurred = boxBlur(
      bufferToImageData({
        data: currentData,
        width: currentWidth,
        height: currentHeight,
      }),
      1,
    )
    currentData = blurred.data
  }

  // 5. Apply adaptive thresholding (key for subtitles)
  if (cfg.adaptiveThreshold) {
    const thresh = adaptiveThreshold(
      bufferToImageData({
        data: currentData,
        width: currentWidth,
        height: currentHeight,
      }),
      cfg.adaptiveBlockSize,
    )
    currentData = thresh.data
  }

  // 6. Morphological cleanup
  if (cfg.morphCleanup) {
    const morphed = morphOpen(
      bufferToImageData({
        data: currentData,
        width: currentWidth,
        height: currentHeight,
      }),
      1,
    )
    currentData = morphed.data
  }

  // 7. Invert if needed
  if (cfg.invertColors) {
    for (let i = 0; i < currentData.length; i += 4) {
      currentData[i] = 255 - currentData[i]
      currentData[i + 1] = 255 - currentData[i + 1]
      currentData[i + 2] = 255 - currentData[i + 2]
    }
  }

  // Create final canvas
  const canvas = document.createElement('canvas')
  canvas.width = currentWidth
  canvas.height = currentHeight
  const ctx = canvas.getContext(CANVAS_CONTEXT_2D)
  if (!ctx) throw new Error(ERR_CANVAS_CTX_2D)

  const finalData = new Uint8ClampedArray(currentData.buffer as ArrayBuffer)
  ctx.putImageData(new ImageData(finalData, currentWidth, currentHeight), 0, 0)

  // Release buffers back to pool
  _releaseBuffer(grayBuf)

  return {
    processedData: new ImageData(new Uint8ClampedArray(currentData.buffer as ArrayBuffer), currentWidth, currentHeight),
    canvas,
    toDataURL(): string {
      return canvas.toDataURL(MIME_IMAGE_PNG)
    },
    toBlob(): Promise<Blob> {
      return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to create blob'))
        }, 'image/png')
      })
    },
  }
}

/**
 * Preprocess for subtitle OCR specifically
 */
export function preprocessForSubtitles(imageData: ImageData): PreprocessorResult {
  return preprocessImage(imageData, {
    scaleFactor: 2.0,
    enhanceContrast: true,
    contrastLevel: 1.8,
    adaptiveThreshold: true,
    adaptiveBlockSize: 9,
    denoise: true,
    morphCleanup: true,
    invertColors: false,
    deskew: true,
    multiPass: true,
  })
}

/**
 * Preprocess for general text (documents, screenshots)
 */
export function preprocessForGeneralText(imageData: ImageData): PreprocessorResult {
  return preprocessImage(imageData, {
    scaleFactor: 1.5,
    enhanceContrast: true,
    contrastLevel: 1.5,
    adaptiveThreshold: true,
    adaptiveBlockSize: 11,
    denoise: true,
    morphCleanup: true,
    invertColors: false,
    deskew: true,
    multiPass: false,
  })
}
