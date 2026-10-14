/**
 * @file AutoRoiDetector.ts
 * @description 硬字幕候选选区自动定位（纯算法，无 DOM 依赖）。
 *
 * 原理：字幕带在画面中表现为「成行的高频边缘 + 有限的垂直高度」。
 * 因此对画面下半部分逐行统计水平边缘密度，取最密集的连续行带，
 * 再在带内统计列方向边缘范围得到左右边界，输出归一化 ROI (0~1)。
 *
 * 该模块是桌面端原生 ROI 检测（Rust `auto_detect_roi`）不可用时的兜底路径。
 */

export interface NormalizedBand {
  x: number
  y: number
  width: number
  height: number
}

export interface AutoRoiOptions {
  /** 从画面高度的该比例处开始向下搜索（默认 0.45） */
  searchTopRatio: number
  /** 字幕带最小高度占画面比例（默认 0.03） */
  minBandRatio: number
  /** 行边缘密度阈值（默认 0.06） */
  edgeThreshold: number
  /** 单像素灰度差超过该值计为一次边缘（默认 24） */
  edgeDelta: number
  /** 上下内边距占字幕带高度比例（默认 0.35） */
  paddingRatio: number
  /** 行采样步长，用于加速（默认 1） */
  rowStep: number
}

export const DEFAULT_AUTO_ROI_OPTIONS: Readonly<AutoRoiOptions> = Object.freeze({
  searchTopRatio: 0.45,
  minBandRatio: 0.03,
  edgeThreshold: 0.06,
  edgeDelta: 24,
  paddingRatio: 0.35,
  rowStep: 1,
})

export interface AutoRoiDetection {
  roi: NormalizedBand
  /** 置信度 0~1，可用于提示用户是否需要手工微调 */
  confidence: number
  /** 命中的行数（像素） */
  bandHeightPx: number
}

interface ImageLike {
  data: Uint8ClampedArray
  width: number
  height: number
}

function luma(data: Uint8ClampedArray, index: number): number {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
}

/** 逐行水平边缘密度（归一化到 0~1） */
function rowEdgeDensity(image: ImageLike, rowStep: number, edgeDelta: number): Float32Array {
  const { data, width, height } = image
  const rows = new Float32Array(height)
  if (width < 2) return rows

  for (let y = 0; y < height; y += rowStep) {
    let edges = 0
    let previous = luma(data, y * width * 4)
    for (let x = 1; x < width; x++) {
      const current = luma(data, (y * width + x) * 4)
      if (Math.abs(current - previous) > edgeDelta) edges++
      previous = current
    }
    rows[y] = edges / (width - 1)
  }

  // 采样步长 > 1 时用邻近行的值补齐，避免密度曲线出现空洞
  if (rowStep > 1) {
    for (let y = 0; y < height; y++) {
      if (rows[y] === 0) rows[y] = rows[y - (y % rowStep)] ?? 0
    }
  }
  return rows
}

/** 3 行滑动平均，抑制单行噪声 */
function smooth(rows: Float32Array, window = 3): Float32Array {
  const result = new Float32Array(rows.length)
  const half = Math.floor(window / 2)
  for (let y = 0; y < rows.length; y++) {
    let sum = 0
    let count = 0
    for (let k = -half; k <= half; k++) {
      const index = y + k
      if (index < 0 || index >= rows.length) continue
      sum += rows[index]
      count++
    }
    result[y] = count > 0 ? sum / count : 0
  }
  return result
}

/**
 * 在画面下半部分定位最可能的字幕带。
 * @returns 命中时返回归一化 ROI 与置信度；未发现明显文本行时返回 null
 */
export function detectSubtitleBand(
  image: ImageLike,
  options: Partial<AutoRoiOptions> = {},
): AutoRoiDetection | null {
  const config: AutoRoiOptions = { ...DEFAULT_AUTO_ROI_OPTIONS, ...options }
  const { data, width, height } = image

  if (!data || width < 8 || height < 8) return null
  if (data.length < width * height * 4) return null

  const density = smooth(rowEdgeDensity(image, config.rowStep, config.edgeDelta))
  const startRow = Math.floor(height * Math.max(0, Math.min(0.9, config.searchTopRatio)))
  const minBandPx = Math.max(3, Math.floor(height * config.minBandRatio))

  // 允许 1 行空隙，避免字幕笔画间隙把带切碎
  const runs: Array<{ start: number; end: number; score: number }> = []
  let current: { start: number; end: number; score: number } | null = null
  let gap = 0

  for (let y = startRow; y < height; y++) {
    const active = density[y] >= config.edgeThreshold
    if (active) {
      if (!current) current = { start: y, end: y, score: 0 }
      current.end = y
      current.score += density[y]
      gap = 0
    } else if (current) {
      gap++
      if (gap > 1) {
        runs.push(current)
        current = null
        gap = 0
      }
    }
  }
  if (current) runs.push(current)

  const best = runs
    .filter((run) => run.end - run.start + 1 >= minBandPx)
    .sort((a, b) => b.score - a.score)[0]

  if (!best) return null

  const bandHeightPx = best.end - best.start + 1
  const padding = Math.round(bandHeightPx * config.paddingRatio)

  // 带内列方向边缘范围 → 左右边界
  let left = width - 1
  let right = 0
  const columnThreshold = config.edgeThreshold * 0.5
  for (let x = 1; x < width; x++) {
    let edges = 0
    for (let y = best.start; y <= best.end; y++) {
      const current = luma(data, (y * width + x) * 4)
      const previous = luma(data, (y * width + x - 1) * 4)
      if (Math.abs(current - previous) > config.edgeDelta) edges++
    }
    if (edges / bandHeightPx >= columnThreshold) {
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (left >= right) {
    left = 0
    right = width - 1
  }

  // 左右各留 4% 余量，避免切掉行首行尾笔画
  const marginX = Math.round(width * 0.04)
  const x0 = Math.max(0, left - marginX)
  const x1 = Math.min(width, right + marginX)

  const top = Math.max(0, best.start - padding)
  const bottom = Math.min(height, best.end + padding)

  const bandDensity = best.score / bandHeightPx
  const confidence = Math.max(
    0,
    Math.min(1, bandDensity / (config.edgeThreshold * 3)),
  )

  const round = (value: number) => Number(value.toFixed(4))

  return {
    roi: {
      x: round(x0 / width),
      y: round(top / height),
      width: round((x1 - x0) / width),
      height: round((bottom - top) / height),
    },
    confidence: round(confidence),
    bandHeightPx,
  }
}
