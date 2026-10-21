/**
 * Pure image processing primitives for OCR preprocessing.
 * No DOM/browser dependencies — all functions accept and return ImageData.
 *
 * 优化：旋转/矫正 → image-deskew.ts，形态学 → image-morph.ts
 * 本文件聚焦于：ROI处理、核心像素操作、缩放。
 * 通过 re-export 保持所有 API 向后兼容。
 */

import { clamp, pixelLuma } from '@/utils/math'
import { forEachNeighbor, getSquareKernel } from './image-kernel'

// ─── Re-exports for backward compatibility ───────────────────────
// 优化：子模块独立后，通过 re-export 保持现有 import 路径不变
export { detectSkewAngle, rotateImage, applyDeskew } from './image-deskew'
export type { DeskewResult } from './image-deskew'
export { morphologicalErode, morphologicalDilate, morphOpen } from './image-morph'

// ─── Types ────────────────────────────────────────────────────────

export interface NormalizedROI {
  x0: number
  y0: number
  rw: number
  rh: number
  xEnd: number
  yEnd: number
}

/**
 * Converts percentage-based ROI [0–100] to absolute pixel coordinates
 * with boundary clamping. Used by both the OCR extractor and scene detector.
 */
export function normalizeROI(
  roi: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  minSize = 0,
): NormalizedROI {
  const x0 = clamp(Math.floor((roi.x / 100) * width), 0, width)
  const y0 = clamp(Math.floor((roi.y / 100) * height), 0, height)
  const rw = clamp(Math.floor((roi.width / 100) * width), minSize, width - x0)
  const rh = clamp(Math.floor((roi.height / 100) * height), minSize, height - y0)
  return {
    x0,
    y0,
    rw,
    rh,
    xEnd: x0 + rw,
    yEnd: y0 + rh,
  }
}

// ─── Kernel caches ────────────────────────────────────────────────
// 优化：内核遍历逻辑已提取到 image-kernel.ts，此处保留缓存实例
const _boxBlurKernelCache = new Map<number, [number, number][]>()
const _adaptiveBlockKernelCache = new Map<number, [number, number][]>()

// ─── Core pixel operations ────────────────────────────────────────

/** RGBA 转灰度图 */
export function toGrayscale(imageData: ImageData): ImageData {
  const { data, width, height } = imageData
  const grayscale = new ImageData(width, height)

  for (let i = 0; i < data.length; i += 4) {
    const gray = pixelLuma(data, i)
    grayscale.data[i] = gray
    grayscale.data[i + 1] = gray
    grayscale.data[i + 2] = gray
    grayscale.data[i + 3] = data[i + 3]
  }

  return grayscale
}

// 对比度增强 LUT 缓存（预计算避免逐像素数学运算）
const _contrastLUTCache = new Map<number, Uint8Array>()

function getContrastLUT(level: number): Uint8Array {
  if (_contrastLUTCache.has(level)) {
    return _contrastLUTCache.get(level)!
  }
  const factor = 0.5 + (level * (259 * 255)) / (255 * 259)
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.max(0, Math.min(255, Math.round(factor * (i - 128) + 128)))
  }
  _contrastLUTCache.set(level, lut)
  return lut
}

/** 使用预计算 LUT 增强对比度 */
export function enhanceContrast(imageData: ImageData, level: number): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)
  const lut = getContrastLUT(level)
  
  for (let i = 0; i < data.length; i += 4) {
    result.data[i] = lut[data[i]]
    result.data[i + 1] = lut[data[i + 1]]
    result.data[i + 2] = lut[data[i + 2]]
    result.data[i + 3] = data[i + 3]
  }

  return result
}

/** 均值模糊（降噪） */
export function boxBlur(imageData: ImageData, radius: number = 1): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)
  const kernel = getSquareKernel(radius, _boxBlurKernelCache)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0

      forEachNeighbor(x, y, width, height, kernel, (_nx, _ny, idx) => {
        r += data[idx]
        g += data[idx + 1]
        b += data[idx + 2]
        a += data[idx + 3]
        count++
      })

      const idx = (y * width + x) * 4
      result.data[idx] = r / count
      result.data[idx + 1] = g / count
      result.data[idx + 2] = b / count
      result.data[idx + 3] = a / count
    }
  }

  return result
}

function _getAdaptiveKernel(blockSize: number): [number, number][] {
  return getSquareKernel(Math.floor(blockSize / 2), _adaptiveBlockKernelCache)
}

/** 自适应阈值二值化（处理半透明字幕背景） */
export function adaptiveThreshold(imageData: ImageData, blockSize: number = 11, C: number = 2): ImageData {
  const { width, height } = imageData
  const result = new ImageData(width, height)

  const blurred = boxBlur(imageData, Math.floor(blockSize / 3))
  const blurredData = blurred.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const pixel = blurredData[idx]

      let sum = 0, count = 0
      forEachNeighbor(x, y, width, height, _getAdaptiveKernel(blockSize), (_nx, _ny, idx) => {
        sum += blurredData[idx]
        count++
      })

      const localMean = sum / count
      const threshold = localMean - C
      const value = pixel > threshold ? 255 : 0

      result.data[idx] = value
      result.data[idx + 1] = value
      result.data[idx + 2] = value
      result.data[idx + 3] = 255
    }
  }

  return result
}

/** 反色 */
export function invertColors(imageData: ImageData): ImageData {
  const { data, width, height } = imageData
  const result = new ImageData(width, height)

  for (let i = 0; i < data.length; i += 4) {
    result.data[i] = 255 - data[i]
    result.data[i + 1] = 255 - data[i + 1]
    result.data[i + 2] = 255 - data[i + 2]
    result.data[i + 3] = data[i + 3]
  }

  return result
}

// ─── Scaling ──────────────────────────────────────────────────────

/**
 * 双线性插值放大。
 * 整数倍（2x/3x/4x）使用快速路径，其他使用通用双线性插值。
 */
export function scaleUp(imageData: ImageData, factor: number): ImageData {
  const { data, width, height } = imageData
  const newWidth = Math.round(width * factor)
  const newHeight = Math.round(height * factor)
  const result = new ImageData(newWidth, newHeight)

  // 快速路径：整数倍放大
  if (Number.isInteger(factor) && factor >= 2 && factor <= 4) {
    const f = factor as number
    for (let y = 0; y < newHeight; y++) {
      const srcY = Math.floor(y / f)
      const srcY1 = Math.min(srcY + 1, height - 1)
      const rowOffset = y * newWidth
      const srcRowOffset = srcY * width
      const srcRowOffset1 = srcY1 * width
      
      for (let x = 0; x < newWidth; x++) {
        const srcX = Math.floor(x / f)
        const srcX1 = Math.min(srcX + 1, width - 1)
        const dstIdx = (rowOffset + x) * 4
        
        for (let c = 0; c < 4; c++) {
          const v00 = data[(srcRowOffset + srcX) * 4 + c]
          const v10 = data[(srcRowOffset + srcX1) * 4 + c]
          const v01 = data[(srcRowOffset1 + srcX) * 4 + c]
          const v11 = data[(srcRowOffset1 + srcX1) * 4 + c]
          result.data[dstIdx + c] = Math.round((v00 + v10 + v01 + v11) / 4)
        }
      }
    }
    return result
  }

  // 通用双线性插值
  for (let y = 0; y < newHeight; y++) {
    const srcY = y / factor
    const y0 = Math.floor(srcY)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = srcY - y0
    const rowOffset = y * newWidth
    const srcY0Offset = y0 * width
    const srcY1Offset = y1 * width

    for (let x = 0; x < newWidth; x++) {
      const srcX = x / factor
      const x0 = Math.floor(srcX)
      const x1 = Math.min(x0 + 1, width - 1)
      const fx = srcX - x0
      const idx = (rowOffset + x) * 4

      const i00 = srcY0Offset + x0
      const i10 = srcY0Offset + x1
      const i01 = srcY1Offset + x0
      const i11 = srcY1Offset + x1

      for (let c = 0; c < 4; c++) {
        const v00 = data[i00 * 4 + c]
        const v10 = data[i10 * 4 + c]
        const v01 = data[i01 * 4 + c]
        const v11 = data[i11 * 4 + c]
        const v0 = v00 + (v10 - v00) * fx
        const v1 = v01 + (v11 - v01) * fx
        const v = v0 + (v1 - v0) * fy
        result.data[idx + c] = c === 3 ? 255 : Math.round(v)
      }
    }
  }

  return result
}

/**
 * 局部自适应直方图均衡化（CLAHE: Contrast Limited Adaptive Histogram Equalization）
 * 显著提升视频字幕文本与复杂发光/暗部背景的边缘对比度，抑制背景噪声放大。
 * @param imageData 灰度或彩色图像数据
 * @param clipLimit 对比度截断上限（默认 2.5）
 * @param gridSize 网格切分尺寸（默认 8×8）
 */
export function applyCLAHE(
  imageData: ImageData,
  clipLimit: number = 2.5,
  gridSize: number = 8,
): ImageData {
  const { width, height, data } = imageData
  const result = new ImageData(width, height)
  const numTilesX = Math.max(1, Math.min(width, gridSize))
  const numTilesY = Math.max(1, Math.min(height, gridSize))
  const tileW = width / numTilesX
  const tileH = height / numTilesY

  // 为每个分块计算限制对比度后的累积分布函数 (CDF)
  const cdfs: Float32Array[] = []

  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const startX = Math.floor(tx * tileW)
      const endX = Math.min(width, Math.floor((tx + 1) * tileW))
      const startY = Math.floor(ty * tileH)
      const endY = Math.min(height, Math.floor((ty + 1) * tileH))
      const tilePixelCount = Math.max(1, (endX - startX) * (endY - startY))

      const hist = new Uint32Array(256)
      for (let y = startY; y < endY; y++) {
        const rowOffset = y * width
        for (let x = startX; x < endX; x++) {
          const luma = Math.round(pixelLuma(data, (rowOffset + x) * 4))
          hist[luma]++
        }
      }

      // Clip histogram
      const clipThreshold = Math.max(1, Math.round((clipLimit * tilePixelCount) / 256))
      let excess = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clipThreshold) {
          excess += hist[i] - clipThreshold
          hist[i] = clipThreshold
        }
      }

      // Redistribute excess
      const bonus = Math.floor(excess / 256)
      let remainder = excess % 256
      for (let i = 0; i < 256; i++) {
        hist[i] += bonus
        if (remainder > 0) {
          hist[i]++
          remainder--
        }
      }

      // Compute CDF
      const cdf = new Float32Array(256)
      let cum = 0
      for (let i = 0; i < 256; i++) {
        cum += hist[i]
        cdf[i] = (cum / tilePixelCount) * 255
      }
      cdfs.push(cdf)
    }
  }

  // 双线性插值映射各个像素点
  for (let y = 0; y < height; y++) {
    const normY = (y / tileH) - 0.5
    const ty1 = Math.max(0, Math.min(numTilesY - 1, Math.floor(normY)))
    const ty2 = Math.min(numTilesY - 1, ty1 + 1)
    const dy = Math.max(0, Math.min(1, normY - ty1))
    const rowOffset = y * width

    for (let x = 0; x < width; x++) {
      const normX = (x / tileW) - 0.5
      const tx1 = Math.max(0, Math.min(numTilesX - 1, Math.floor(normX)))
      const tx2 = Math.min(numTilesX - 1, tx1 + 1)
      const dx = Math.max(0, Math.min(1, normX - tx1))

      const idx = (rowOffset + x) * 4
      const luma = Math.round(pixelLuma(data, idx))

      const val11 = cdfs[ty1 * numTilesX + tx1][luma]
      const val12 = cdfs[ty1 * numTilesX + tx2][luma]
      const val21 = cdfs[ty2 * numTilesX + tx1][luma]
      const val22 = cdfs[ty2 * numTilesX + tx2][luma]

      const top = val11 + (val12 - val11) * dx
      const bottom = val21 + (val22 - val21) * dx
      const outLuma = Math.round(top + (bottom - top) * dy)

      result.data[idx] = outLuma
      result.data[idx + 1] = outLuma
      result.data[idx + 2] = outLuma
      result.data[idx + 3] = data[idx + 3]
    }
  }

  return result
}