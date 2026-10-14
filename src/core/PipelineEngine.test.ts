import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineEngine } from './PipelineEngine'
import type { ExtractionStatePort, OCREngineResolver } from './ExtractionUseCase'
import type { IOCREngineProvider, OCRConfig, OCRItem } from '@/services/ocr/IOCREngine'

class CanvasContextMock {
  drawImage = vi.fn()
}

class CanvasMock {
  width = 0
  height = 0
  readonly context = new CanvasContextMock()

  getContext() {
    return this.context
  }
}

function createVideo(duration = 2, paused = false) {
  const listeners = new Map<string, EventListener>()
  return {
    duration,
    paused,
    currentTime: 0.75,
    videoWidth: 1920,
    videoHeight: 1080,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      listeners.set(event, listener)
      listener(new Event(event))
    }),
    removeEventListener: vi.fn((event: string) => listeners.delete(event)),
  } as unknown as HTMLVideoElement
}

function createState(config: OCRConfig) {
  const added: OCRItem[][] = []
  const progress: number[] = []
  const extracting: boolean[] = []
  const state: ExtractionStatePort = {
    getConfig: () => config,
    setExtracting: (value) => extracting.push(value),
    setProgress: (value) => progress.push(value),
    addSubtitles: (items) => added.push(items),
  }
  return { state, added, progress, extracting }
}

function createResolver(recognizeFrame: IOCREngineProvider['recognizeFrame']) {
  const engine: IOCREngineProvider = {
    engineName: 'Test OCR',
    mode: 'local',
    initialize: vi.fn(async () => undefined),
    recognizeFrame,
    destroy: vi.fn(async () => undefined),
  }
  const resolver: OCREngineResolver = {
    getEngine: vi.fn(async () => engine),
  }
  return { resolver, engine }
}

describe('PipelineEngine extraction use case', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLCanvasElement', CanvasMock)
    vi.stubGlobal('document', {
      createElement: vi.fn(() => new CanvasMock()),
    })
  })

  it('extracts frames through ports and restores playback state', async () => {
    const originalResult: OCRItem = {
      id: 'result',
      startTime: 0,
      endTime: 0,
      text: '字幕',
      confidence: 95,
    }
    const { state, added, progress, extracting } = createState({
      mode: 'local',
      language: 'chi_sim+eng',
    })
    const { resolver } = createResolver(vi.fn(async () => [originalResult]))
    const pipeline = new PipelineEngine(state, resolver)
    const video = createVideo()

    const result = await pipeline.startExtraction(
      video,
      { x: 0, y: 0.7, width: 1, height: 0.3 },
    )

    expect(result).toBe('completed')
    expect(progress).toEqual([0, 50, 100])
    expect(extracting).toEqual([true, false])
    expect(added).toHaveLength(2)
    expect(added[0]?.[0]).toMatchObject({ startTime: 0, endTime: 1000 })
    expect(added[1]?.[0]).toMatchObject({ startTime: 1000, endTime: 2000 })
    expect(originalResult).toMatchObject({ startTime: 0, endTime: 0 })
    expect(video.currentTime).toBe(0.75)
    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.play).toHaveBeenCalledOnce()
  })

  it('stops before the next frame when cancellation is requested', async () => {
    const { state, progress, extracting } = createState({
      mode: 'local',
      language: 'chi_sim+eng',
    })
    const pipelineRef: { current: PipelineEngine | null } = { current: null }
    const recognize = vi.fn(async () => {
      pipelineRef.current?.cancel()
      return []
    })
    const { resolver } = createResolver(recognize)
    const pipeline = new PipelineEngine(state, resolver)
    pipelineRef.current = pipeline

    const result = await pipeline.startExtraction(
      createVideo(3, true),
      { x: 0, y: 0.7, width: 1, height: 0.3 },
    )

    expect(result).toBe('cancelled')
    expect(recognize).toHaveBeenCalledOnce()
    expect(progress).toEqual([0, 33])
    expect(extracting).toEqual([true, false])
  })

  it('rejects cloud extraction without an API key before changing state', async () => {
    const { state, progress, extracting } = createState({
      mode: 'cloud',
      language: 'chi_sim+eng',
      apiKey: '  ',
    })
    const { resolver } = createResolver(vi.fn(async () => []))
    const pipeline = new PipelineEngine(state, resolver)

    await expect(pipeline.startExtraction(
      createVideo(),
      { x: 0, y: 0.7, width: 1, height: 0.3 },
    )).rejects.toThrow('未配置 API Key')

    expect(resolver.getEngine).not.toHaveBeenCalled()
    expect(progress).toEqual([])
    expect(extracting).toEqual([])
  })
})
