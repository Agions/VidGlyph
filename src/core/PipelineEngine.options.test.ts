import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineEngine } from './PipelineEngine'
import type { ExtractionStatePort, OCREngineResolver } from './ExtractionUseCase'
import type { IOCREngineProvider, OCRConfig, OCRItem } from '@/services/ocr/IOCREngine'
import type { ExtractionOptions } from './ExtractionConfig'

class CanvasMock {
  width = 0
  height = 0
  drawImage = vi.fn()
  getContext() {
    return this
  }
}

function createVideo(duration = 100) {
  return {
    duration,
    paused: true,
    currentTime: 33,
    videoWidth: 1920,
    videoHeight: 1080,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    addEventListener: vi.fn((_e: string, l: EventListener) => l(new Event('seeked'))),
    removeEventListener: vi.fn(),
  } as unknown as HTMLVideoElement
}

function createState(config: OCRConfig, extractionOptions?: Partial<ExtractionOptions>) {
  const added: OCRItem[][] = []
  const progress: number[] = []
  const state: ExtractionStatePort = {
    getConfig: () => config,
    ...(extractionOptions ? { getExtractionOptions: () => extractionOptions } : {}),
    setExtracting: () => undefined,
    setProgress: (value) => progress.push(value),
    addSubtitles: (items) => added.push(items),
  }
  return { state, added, progress }
}

function createResolver(recognizeFrame: IOCREngineProvider['recognizeFrame']) {
  const engine: IOCREngineProvider = {
    engineName: 'Test OCR',
    mode: 'local',
    initialize: vi.fn(async () => undefined),
    recognizeFrame,
    destroy: vi.fn(async () => undefined),
  }
  return { resolver: { getEngine: vi.fn(async () => engine) } as OCREngineResolver }
}

const ROI = { x: 0, y: 0.7, width: 1, height: 0.3 }
const LOCAL = { mode: 'local' as const, language: 'chi_sim+eng' }

describe('PipelineEngine 参数化提取', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLCanvasElement', CanvasMock)
    vi.stubGlobal('document', { createElement: vi.fn(() => new CanvasMock()) })
  })

  it('按自定义区间与采样间隔抽帧并记录运行汇总', async () => {
    const { state, progress } = createState(LOCAL)
    const calls: unknown[] = []
    const { resolver } = createResolver(
      vi.fn(async (frame: unknown) => {
        calls.push(frame)
        return []
      }) as unknown as IOCREngineProvider['recognizeFrame'],
    )
    const pipeline = new PipelineEngine(state, resolver)

    const result = await pipeline.startExtraction(createVideo(100), ROI, {
      startTime: 10,
      endTime: 14,
      sampleInterval: 2,
    })

    expect(result).toBe('completed')
    expect(calls).toHaveLength(2)
    expect(progress).toEqual([0, 50, 100])
    expect(pipeline.getLastRunSummary()).toMatchObject({
      range: [10, 14],
      sampleInterval: 2,
      framesSkipped: 2,
    })
  })

  it('未显式传参时从状态端口读取配置', async () => {
    const { state, progress } = createState(LOCAL, { startTime: 0, endTime: 2, sampleInterval: 1 })
    const { resolver } = createResolver(vi.fn(async () => []))
    const pipeline = new PipelineEngine(state, resolver)

    await pipeline.startExtraction(createVideo(60), ROI)

    expect(progress).toEqual([0, 50, 100])
    expect(pipeline.getLastRunSummary()?.range).toEqual([0, 2])
  })

  it('低于置信度阈值的结果被丢弃并计数', async () => {
    const { state, added } = createState(LOCAL)
    const { resolver } = createResolver(
      vi.fn(async () => [
        { id: 'keep', startTime: 0, endTime: 0, text: '保留', confidence: 90 },
        { id: 'drop', startTime: 0, endTime: 0, text: '丢弃', confidence: 30 },
      ]),
    )
    const pipeline = new PipelineEngine(state, resolver)

    await pipeline.startExtraction(createVideo(2), ROI, { minConfidence: 60 })

    // 2 秒视频按 1 秒步长抽 2 帧，每帧仅保留高置信度条目
    expect(added.flat()).toHaveLength(2)
    expect(added.flat().every((item) => item.confidence >= 60)).toBe(true)
    expect(pipeline.getLastRunSummary()).toMatchObject({ framesProcessed: 2, filteredByConfidence: 2 })
  })

  it('单帧识别失败不中断整轮任务', async () => {
    const { state, progress } = createState(LOCAL)
    let call = 0
    const { resolver } = createResolver(
      vi.fn(async () => {
        call += 1
        if (call === 1) throw new Error('单帧失败')
        return [{ id: 'ok', startTime: 0, endTime: 0, text: '第二帧', confidence: 88 }]
      }),
    )
    const pipeline = new PipelineEngine(state, resolver)

    const result = await pipeline.startExtraction(createVideo(2), ROI)

    expect(result).toBe('completed')
    expect(progress).toEqual([0, 50, 100])
    expect(pipeline.getLastRunSummary()).toMatchObject({ framesProcessed: 1, framesSkipped: 1 })
  })

  it('非法配置在改动状态前直接抛错', async () => {
    const { state, progress } = createState(LOCAL)
    const { resolver } = createResolver(vi.fn(async () => []))
    const pipeline = new PipelineEngine(state, resolver)

    await expect(
      pipeline.startExtraction(createVideo(100), ROI, { sampleInterval: 0 }),
    ).rejects.toThrow('大于 0')
    expect(progress).toEqual([])
  })
})
