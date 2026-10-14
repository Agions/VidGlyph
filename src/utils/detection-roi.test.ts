import { describe, it, expect } from 'vitest'
import { isRoiRegionLikelyEmpty } from '@/utils/detection'
import { makeFrame, makeGradient } from '@/test-utils/frames'

// ─── Frame factories (no DOM, pure typed arrays) ─────────────────────────────
function makeSplitFrame(width: number, height: number, leftPixel: number, rightPixel: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? leftPixel : rightPixel
      const i = (y * width + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return { data, width, height }
}

describe('isRoiRegionLikelyEmpty', () => {
  const roi = { x: 0, y: 80, width: 100, height: 20 } // bottom 20% of frame

  // ─── Solid backgrounds (zero variance) ─────────────────────────────────────
  it('returns true for all-black frame', () => {
    expect(isRoiRegionLikelyEmpty(makeFrame(320, 240, 0, 0, 0), roi)).toBe(true)
  })

  it('returns true for all-white frame', () => {
    expect(isRoiRegionLikelyEmpty(makeFrame(320, 240, 255, 255, 255), roi)).toBe(true)
  })

  it('returns true for uniform mid-gray frame', () => {
    expect(isRoiRegionLikelyEmpty(makeFrame(320, 240, 128, 128, 128), roi)).toBe(true)
  })

  // ─── High variance (text/subtitle present) ──────────────────────────────────
  it('returns false for horizontal gradient (variance ~5421 >> threshold 100)', () => {
    // Gradient 0→255 across width: variance = (255-0)²/12 ≈ 5419, well above 100
    const frame = makeGradient(320, 240)
    expect(isRoiRegionLikelyEmpty(frame, roi)).toBe(false)
  })

  it('returns false for vertical gradient', () => {
    // Generate vertical gradient (top=dark, bottom=bright)
    const data = new Uint8ClampedArray(320 * 240 * 4)
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        const v = Math.round((y / 240) * 255)
        const i = (y * 320 + x) * 4
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
      }
    }
    const frame = { data, width: 320, height: 240 }
    expect(isRoiRegionLikelyEmpty(frame, roi)).toBe(false)
  })

  // ─── Split frame: left vs right ─────────────────────────────────────────────
  it('returns true for uniform left half (black)', () => {
    const frame = makeSplitFrame(100, 100, 0, 0)
    const leftRoi = { x: 0, y: 0, width: 40, height: 100 }
    expect(isRoiRegionLikelyEmpty(frame, leftRoi)).toBe(true)
  })

  it('returns true for uniform right half (white)', () => {
    const frame = makeSplitFrame(100, 100, 255, 255)
    const rightRoi = { x: 60, y: 0, width: 40, height: 100 }
    expect(isRoiRegionLikelyEmpty(frame, rightRoi)).toBe(true)
  })

  it('returns false for split frame spanning both halves (mixed variance)', () => {
    // Black left (0-49), white right (50-99), sampled at step=2:
    // Even x values (0,2,4,...,98): 0-48 are black (even sum), 50-98 are white (even sum)
    // All sampled pixels sum to even → checkerboard pattern within single color → variance ~16252
    const frame = makeSplitFrame(100, 100, 0, 255)
    const crossRoi = { x: 20, y: 0, width: 60, height: 100 }
    expect(isRoiRegionLikelyEmpty(frame, crossRoi)).toBe(false)
  })

  // ─── Threshold parameter ────────────────────────────────────────────────────
  it('threshold parameter controls variance cutoff', () => {
    const frame = makeGradient(320, 240)
    // Default threshold=100: gradient returns false (variance >> 100)
    expect(isRoiRegionLikelyEmpty(frame, roi)).toBe(false)
    // threshold=10000: same gradient returns true (variance < 10000)
    expect(isRoiRegionLikelyEmpty(frame, roi, 10000)).toBe(true)
    // threshold=1: gradient returns false (variance >> 1)
    expect(isRoiRegionLikelyEmpty(frame, roi, 1)).toBe(false)
  })

  // ─── Edge cases ────────────────────────────────────────────────────────────
  it('returns false when ROI is entirely outside frame bounds', () => {
    const frame = makeFrame(320, 240, 0, 0, 0)
    const outsideRoi = { x: 200, y: 200, width: 200, height: 200 }
    expect(isRoiRegionLikelyEmpty(frame, outsideRoi)).toBe(false)
  })

  it('uniform single-pixel-width ROI has zero variance', () => {
    const frame = makeFrame(100, 100, 128, 128, 128)
    const narrowRoi = { x: 50, y: 50, width: 5, height: 5 }
    // All pixels are 128 → variance=0 → likely empty
    expect(isRoiRegionLikelyEmpty(frame, narrowRoi)).toBe(true)
  })
})