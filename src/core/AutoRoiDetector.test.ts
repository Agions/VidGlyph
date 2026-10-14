import { describe, expect, it } from 'vitest'
import { detectSubtitleBand } from './AutoRoiDetector'

interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

function solidFrame(width: number, height: number, value = 20): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  return { data, width, height }
}

/** 在指定行区间绘制「黑白交替」的高频文本行，模拟硬字幕 */
function drawTextBand(frame: Frame, top: number, bottom: number, step = 3) {
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < frame.width; x++) {
      const on = Math.floor(x / step) % 2 === 0
      const value = on ? 240 : 16
      const i = (y * frame.width + x) * 4
      frame.data[i] = value
      frame.data[i + 1] = value
      frame.data[i + 2] = value
    }
  }
}

describe('detectSubtitleBand', () => {
  it('在画面底部定位高频文本行', () => {
    const frame = solidFrame(320, 240)
    drawTextBand(frame, 190, 214)

    const result = detectSubtitleBand(frame)
    expect(result).not.toBeNull()

    const roi = result!.roi
    // 命中区间应覆盖文本行（允许内边距外扩）
    expect(roi.y).toBeLessThanOrEqual(190 / 240)
    expect(roi.y + roi.height).toBeGreaterThanOrEqual(214 / 240)
    expect(roi.x).toBe(0)
    expect(roi.width).toBeCloseTo(1, 2)
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('不会定位到画面上半部分的文本（搜索范围默认下半区）', () => {
    const frame = solidFrame(320, 240)
    drawTextBand(frame, 40, 60)

    expect(detectSubtitleBand(frame)).toBeNull()
  })

  it('纯色画面返回 null', () => {
    expect(detectSubtitleBand(solidFrame(320, 240))).toBeNull()
  })

  it('输入尺寸过小时返回 null 而不抛错', () => {
    expect(detectSubtitleBand({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toBeNull()
  })

  it('按掩码左右边界收窄 x/width（文本只占画面中段时）', () => {
    const frame = solidFrame(320, 240)
    for (let y = 200; y <= 220; y++) {
      for (let x = 80; x <= 240; x++) {
        const on = Math.floor(x / 3) % 2 === 0
        const value = on ? 240 : 16
        const i = (y * frame.width + x) * 4
        frame.data[i] = value
        frame.data[i + 1] = value
        frame.data[i + 2] = value
      }
    }

    const result = detectSubtitleBand(frame)
    expect(result).not.toBeNull()
    expect(result!.roi.x).toBeGreaterThanOrEqual(0)
    expect(result!.roi.x + result!.roi.width).toBeLessThanOrEqual(1)
    expect(result!.roi.width).toBeLessThan(1)
  })
})
