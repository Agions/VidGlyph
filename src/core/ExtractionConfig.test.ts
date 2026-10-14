import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTRACTION_OPTIONS,
  MAX_SAMPLE_INTERVAL,
  MIN_SAMPLE_INTERVAL,
  estimateFrameCount,
  mergeExtractionOptions,
  validateExtractionOptions,
} from './ExtractionConfig'

describe('validateExtractionOptions', () => {
  it('缺省输入等价于默认配置', () => {
    const result = validateExtractionOptions({}, 120)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.options).toEqual({ ...DEFAULT_EXTRACTION_OPTIONS })
  })

  it('拒绝非法与越界的采样间隔', () => {
    expect(validateExtractionOptions({ sampleInterval: 0 }).errors[0]).toContain('大于 0')
    expect(validateExtractionOptions({ sampleInterval: Number.NaN }).errors[0]).toContain('大于 0')
    expect(validateExtractionOptions({ sampleInterval: MIN_SAMPLE_INTERVAL / 2 }).errors[0]).toContain('最小支持')
    expect(validateExtractionOptions({ sampleInterval: MAX_SAMPLE_INTERVAL + 1 }).errors[0]).toContain('最大支持')
  })

  it('拒绝不支持的语言，避免运行期 OCR 初始化失败', () => {
    const result = validateExtractionOptions({ language: 'klingon' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('klingon')
  })

  it('要求结束时间晚于开始时间', () => {
    const result = validateExtractionOptions({ startTime: 30, endTime: 10 }, 100)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('结束时间必须晚于起始时间')
  })

  it('起始时间超出视频时长时报错', () => {
    const result = validateExtractionOptions({ startTime: 200 }, 100)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('起始时间需小于视频时长')
  })

  it('结束时间超出视频时长时收窄并给出提示', () => {
    const result = validateExtractionOptions({ endTime: 500 }, 100)
    expect(result.valid).toBe(true)
    expect(result.options.endTime).toBe(100)
    expect(result.warnings[0]).toContain('已收窄')
  })

  it('置信度阈值越界时钳制到 0~100', () => {
    const result = validateExtractionOptions({ minConfidence: 150 })
    expect(result.valid).toBe(false)
    expect(result.options.minConfidence).toBe(100)
  })

  it('时长未知时跳过范围越界检查，仅校验结构', () => {
    const result = validateExtractionOptions({ startTime: 5, endTime: 7 }, null)
    expect(result.valid).toBe(true)
  })

  it('拒绝超过单次任务上限的区间', () => {
    const result = validateExtractionOptions({ startTime: 0, endTime: 7 * 60 * 60 }, null)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('单次提取范围过长')
  })
})

describe('estimateFrameCount', () => {
  it('按区间与间隔估算帧数', () => {
    expect(estimateFrameCount({ startTime: 0, endTime: 10, sampleInterval: 1 }, 100)).toBe(10)
    expect(estimateFrameCount({ startTime: 0, endTime: null, sampleInterval: 2 }, 9)).toBe(5)
  })

  it('区间为空或时长非法时返回 0', () => {
    expect(estimateFrameCount({ startTime: 10, endTime: 5, sampleInterval: 1 }, 100)).toBe(0)
    expect(estimateFrameCount({ startTime: 0, endTime: null, sampleInterval: 1 }, 0)).toBe(0)
  })
})

describe('mergeExtractionOptions', () => {
  it('未提供的字段沿用基准值，显式 null 视为「到片尾」', () => {
    const base = { ...DEFAULT_EXTRACTION_OPTIONS, endTime: 30 }
    expect(mergeExtractionOptions(base, { sampleInterval: 2 }).endTime).toBe(30)
    expect(mergeExtractionOptions(base, { endTime: null }).endTime).toBeNull()
  })
})

describe('常量约束', () => {
  it('最小采样间隔小于最大采样间隔', () => {
    expect(MIN_SAMPLE_INTERVAL).toBeLessThan(MAX_SAMPLE_INTERVAL)
  })
})
