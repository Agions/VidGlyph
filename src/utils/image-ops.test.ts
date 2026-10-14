import { describe, it, expect } from 'vitest'
import { toGrayscale, enhanceContrast, boxBlur } from '@/utils/image'
import { clamp } from '@/utils/math'
import { makeFrame, makeGradient } from '@/test-utils/frames'

function pixel(frame: ImageData, x: number, y: number): [number, number, number] {
  const i = (y * frame.width + x) * 4
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2]]
}

function avgPixel(frame: ImageData, x: number, y: number, w: number, h: number): number {
  let sum = 0, count = 0
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = ((y + dy) * frame.width + (x + dx)) * 4
      sum += (frame.data[i] * 299 + frame.data[i + 1] * 587 + frame.data[i + 2] * 114) / 1000
      count++
    }
  }
  return sum / count
}

describe('clamp', () => {
  const pixelClamp = (v: number) => clamp(v, 0, 255)

  it('returns value unchanged when in [0, 255]', () => {
    expect(pixelClamp(128)).toBe(128)
    expect(pixelClamp(0)).toBe(0)
    expect(pixelClamp(255)).toBe(255)
  })

  it('clamps values below 0 to 0', () => {
    expect(pixelClamp(-10)).toBe(0)
    expect(pixelClamp(-255)).toBe(0)
  })

  it('clamps values above 255 to 255', () => {
    expect(pixelClamp(300)).toBe(255)
    expect(pixelClamp(256)).toBe(255)
  })
})

describe('toGrayscale', () => {
  it('converts red pixel to grayscale using luminosity weights', () => {
    // R=255, G=0, B=0 → gray = 255*0.299 + 0*0.587 + 0*0.114 = 76.245
    const frame = makeFrame(1, 1, 255, 0, 0)
    const result = toGrayscale(frame)
    const [r, g, b] = pixel(result, 0, 0)
    expect(r).toBe(76)
    expect(g).toBe(76)
    expect(b).toBe(76)
  })

  it('converts green pixel to grayscale (G*0.587)', () => {
    const frame = makeFrame(1, 1, 0, 255, 0)
    const result = toGrayscale(frame)
    const [r, g, b] = pixel(result, 0, 0)
    expect(r).toBe(150) // 255*0.587 ≈ 150
    expect(g).toBe(150)
    expect(b).toBe(150)
  })

  it('converts blue pixel to grayscale (B*0.114)', () => {
    const frame = makeFrame(1, 1, 0, 0, 255)
    const result = toGrayscale(frame)
    const [r, g, b] = pixel(result, 0, 0)
    expect(r).toBe(29) // 255*0.114 ≈ 29
    expect(g).toBe(29)
    expect(b).toBe(29)
  })

  it('converts white pixel to 255', () => {
    const frame = makeFrame(1, 1, 255, 255, 255)
    const result = toGrayscale(frame)
    const [r] = pixel(result, 0, 0)
    expect(r).toBe(255)
  })

  it('converts black pixel to 0', () => {
    const frame = makeFrame(1, 1, 0, 0, 0)
    const result = toGrayscale(frame)
    const [r] = pixel(result, 0, 0)
    expect(r).toBe(0)
  })

  it('preserves alpha channel', () => {
    const frame = makeFrame(1, 1, 128, 128, 128)
    frame.data[3] = 200 // set alpha
    const result = toGrayscale(frame)
    expect(result.data[3]).toBe(200)
  })

  it('output has same dimensions as input', () => {
    const frame = makeFrame(10, 20, 100, 100, 100)
    const result = toGrayscale(frame)
    expect(result.width).toBe(10)
    expect(result.height).toBe(20)
  })
})

describe('enhanceContrast', () => {
  it('identity transform at level=0.5 (factor=1)', () => {
    const frame = makeFrame(3, 1, 128, 128, 128)
    const result = enhanceContrast(frame, 0.5)
    const [r] = pixel(result, 0, 0)
    expect(r).toBe(128)
  })

  it('increases contrast for level>0.5', () => {
    // Gray frame (128) with higher contrast → pixels move away from 128
    const frame = makeFrame(1, 1, 200, 200, 200)
    const result = enhanceContrast(frame, 0.8)
    const [r] = pixel(result, 0, 0)
    expect(r).toBeGreaterThan(200) // brighter
  })

  it('decreases contrast for level<0.5', () => {
    const frame = makeFrame(1, 1, 200, 200, 200)
    const result = enhanceContrast(frame, 0.2)
    const [r] = pixel(result, 0, 0)
    expect(r).toBeLessThan(200) // closer to 128
  })

  it('clamps output to [0, 255]', () => {
    const frame = makeFrame(1, 1, 255, 255, 255)
    const result = enhanceContrast(frame, 0.9)
    const [r] = pixel(result, 0, 0)
    expect(r).toBeLessThanOrEqual(255)
    expect(r).toBeGreaterThanOrEqual(0)
  })

  it('preserves alpha channel', () => {
    const frame = makeFrame(1, 1, 128, 128, 128)
    frame.data[3] = 200
    const result = enhanceContrast(frame, 0.5)
    expect(result.data[3]).toBe(200)
  })
})

describe('boxBlur', () => {
  it('produces same output for uniform input (no change)', () => {
    const frame = makeFrame(5, 5, 100, 100, 100)
    const result = boxBlur(frame, 1)
    const [r] = pixel(result, 2, 2)
    expect(r).toBe(100)
  })

  it('blurs a single bright pixel in a dark background', () => {
    const frame = makeFrame(5, 5, 0, 0, 0)
    // Set center pixel to white
    const i = (2 * 5 + 2) * 4
    frame.data[i] = 255; frame.data[i + 1] = 255; frame.data[i + 2] = 255
    const result = boxBlur(frame, 1)
    // Center should be somewhat bright (average of 3x3 neighborhood)
    const centerVal = avgPixel(result, 2, 2, 1, 1)
    expect(centerVal).toBeGreaterThan(0)
    expect(centerVal).toBeLessThan(255)
  })

  it('blur radius=0 returns near-original (1x1 kernel)', () => {
    const frame = makeGradient(5, 5)
    const result = boxBlur(frame, 0)
    const [r] = pixel(result, 2, 2)
    // radius=0 → kernel size=1 → should be very close to original
    const [orig] = pixel(frame, 2, 2)
    expect(r).toBe(orig)
  })

  it('output has same dimensions as input', () => {
    const frame = makeFrame(10, 10, 50, 50, 50)
    const result = boxBlur(frame, 2)
    expect(result.width).toBe(10)
    expect(result.height).toBe(10)
  })

  it('handles edge pixels without out-of-bounds access', () => {
    // Frame with distinct corner values
    const frame = makeFrame(3, 3, 0, 0, 0)
    frame.data[0] = 255; frame.data[1] = 255; frame.data[2] = 255 // top-left white
    // Should not throw
    expect(() => boxBlur(frame, 1)).not.toThrow()
  })
})