/**
 * @file PipelineEngine.ts
 * @description 视频硬字幕提取主管道引擎。
 *
 * 职责边界：
 * - 依据校验后的 `ExtractionOptions` 在目标区间内按采样间隔抽帧；
 * - 通过端口回传进度、状态与字幕结果，不直接依赖任何 Store / 组件；
 * - 单帧失败不中断整轮任务，失败与过滤数量汇总到 `ExtractionRunSummary`。
 */

import type { NormalizedROI } from '@/services/ocr/IOCREngine'
import { TauriBridge } from '@/services/tauriBridge'
import { logger } from '@/utils/logger'
import {
  DEFAULT_EXTRACTION_OPTIONS,
  mergeExtractionOptions,
  validateExtractionOptions,
  type ExtractionOptions,
} from './ExtractionConfig'
import type {
  ExtractionResult,
  ExtractionRunSummary,
  ExtractionStatePort,
  ExtractionUseCase,
  OCREngineResolver,
} from './ExtractionUseCase'

const DEFAULT_STEP_SHORT_VIDEO = 1.0
const DEFAULT_STEP_LONG_VIDEO = 1.5
const LONG_VIDEO_SECONDS = 60
/** 等待 video seeked 事件的兜底超时，避免个别编码不触发事件时卡死 */
const SEEK_FALLBACK_MS = 250

export class PipelineEngine implements ExtractionUseCase {
  private isCancelRequested = false
  private currentTaskId: string | null = null
  private lastSummary: ExtractionRunSummary | null = null

  public constructor(
    private readonly state: ExtractionStatePort,
    private readonly ocrResolver: OCREngineResolver,
  ) {}

  /** 返回最近一次运行的汇总信息（未运行时为 null） */
  public getLastRunSummary(): ExtractionRunSummary | null {
    return this.lastSummary
  }

  /**
   * 启动硬字幕提取管道。
   * @param videoElement 已完成元数据加载的视频元素
   * @param roi 归一化字幕选区
   * @param options 本次运行的参数覆盖（优先级：入参 > 状态端口 > 默认值）
   */
  public async startExtraction(
    videoElement: HTMLVideoElement,
    roi: NormalizedROI,
    options?: Partial<ExtractionOptions>,
  ): Promise<ExtractionResult> {
    const config = this.state.getConfig()

    if (config.mode === 'cloud' && !config.apiKey?.trim()) {
      throw new Error('未配置 API Key，请点击右上角设置按钮配置密钥，或切换为离线模式')
    }

    const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0
      ? videoElement.duration
      : null

    const resolved = mergeExtractionOptions(
      mergeExtractionOptions(
        { ...DEFAULT_EXTRACTION_OPTIONS },
        this.state.getExtractionOptions?.() ?? null,
      ),
      options ?? null,
    )
    const validation = validateExtractionOptions(resolved, duration)
    if (!validation.valid) {
      throw new Error(validation.errors[0])
    }
    const effective = validation.options
    for (const warning of validation.warnings) logger.warn('Pipeline', warning)

    const stepSeconds = this.resolveStepSeconds(effective, duration)
    const rangeStart = effective.startTime
    const rangeEnd = effective.endTime ?? duration ?? rangeStart + stepSeconds
    const totalSteps = Math.max(1, Math.ceil((rangeEnd - rangeStart) / stepSeconds))

    this.isCancelRequested = false
    this.currentTaskId = null
    this.state.setExtracting(true)
    this.state.setProgress(0)

    // 桌面端原生流水线优化路径：当处于 Tauri 桌面端、存在本地文件路径且为本地模式时
    const nativePath = this.state.getVideoPath?.()
    if (TauriBridge.isTauriEnv() && nativePath && config.mode === 'local') {
      const nativeStatus = await TauriBridge.checkNativeOcrReady().catch(() => null)
      if (nativeStatus?.ready) {
        logger.info('Pipeline', `启用 Rust 原生流式硬件加速提取: ${nativePath}`)
        return await this.startNativeExtraction(
          nativePath,
          roi,
          effective,
          rangeStart,
          rangeEnd,
          stepSeconds,
        )
      } else {
        logger.warn('Pipeline', '原生 ONNX 模型未就绪，平滑降级至本地 Canvas OCR 引擎')
      }
    }

    const summary: ExtractionRunSummary = {
      framesProcessed: 0,
      framesSkipped: 0,
      filteredByConfidence: 0,
      range: [rangeStart, rangeEnd],
      sampleInterval: stepSeconds,
    }

    // 临时暂停播放以稳定抽取帧画面
    const wasPlaying = !videoElement.paused
    if (wasPlaying) videoElement.pause()
    const originalTime = videoElement.currentTime

    try {
      const ocrEngine = await this.ocrResolver.getEngine({
        ...config,
        language: effective.language,
        preprocessDenoise: effective.preprocessDenoise,
      })

      const canvas = document.createElement('canvas')
      canvas.width = videoElement.videoWidth || 1280
      canvas.height = videoElement.videoHeight || 720
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
      if (!ctx) throw new Error('无法创建视频帧处理画布')

      for (let step = 0; step < totalSteps; step++) {
        if (this.isCancelRequested) break

        const targetTime = Math.min(rangeStart + step * stepSeconds, rangeEnd)
        videoElement.currentTime = targetTime

        await this.waitForSeek(videoElement)

        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

        try {
          const results = await ocrEngine.recognizeFrame(canvas, roi)
          const kept = (results ?? []).filter((item) => item.confidence >= effective.minConfidence)
          summary.filteredByConfidence += (results?.length ?? 0) - kept.length

          if (kept.length > 0) {
            const timedResults = kept.map((result) => ({
              ...result,
              startTime: Math.round(targetTime * 1000),
              endTime: Math.round((targetTime + stepSeconds) * 1000),
            }))
            this.state.addSubtitles(timedResults)
            summary.framesProcessed += 1
          } else {
            summary.framesSkipped += 1
          }
        } catch (frameErr) {
          summary.framesSkipped += 1
          logger.warn('Pipeline', `帧 [${targetTime.toFixed(2)}s] OCR 识别跳过`, frameErr)
        }

        const percent = Math.min(100, Math.round(((step + 1) / totalSteps) * 100))
        this.state.setProgress(percent)
      }

      this.lastSummary = summary
      logger.debug(
        'Pipeline',
        `提取结束 processed=${summary.framesProcessed} skipped=${summary.framesSkipped} 区间=[${rangeStart}, ${rangeEnd}] 间隔=${stepSeconds}`,
      )
      return this.isCancelRequested ? 'cancelled' : 'completed'
    } catch (err: unknown) {
      this.lastSummary = summary
      logger.error('Pipeline', '识别过程出错', err)
      throw err
    } finally {
      videoElement.currentTime = originalTime
      if (wasPlaying) {
        videoElement.play().catch(() => {
          // 浏览器可能因缺少用户手势拒绝自动恢复播放，属可接受降级。
        })
      }
      this.state.setExtracting(false)
    }
  }

  public cancel(): void {
    this.isCancelRequested = true
    if (this.currentTaskId && TauriBridge.isTauriEnv()) {
      TauriBridge.cancelNativePipeline(this.currentTaskId).catch(() => {})
    }
  }

  /**
   * 启动 Rust 原生硬件加速流式提取管道。
   */
  private async startNativeExtraction(
    videoPath: string,
    roi: NormalizedROI,
    options: ExtractionOptions,
    rangeStart: number,
    rangeEnd: number,
    stepSeconds: number,
  ): Promise<ExtractionResult> {
    this.isCancelRequested = false
    this.state.setExtracting(true)
    this.state.setProgress(0)

    const summary: ExtractionRunSummary = {
      framesProcessed: 0,
      framesSkipped: 0,
      filteredByConfidence: 0,
      range: [rangeStart, rangeEnd],
      sampleInterval: stepSeconds,
    }

    return new Promise<ExtractionResult>((resolve, reject) => {
      let unlistenFn: (() => void) | null = null

      TauriBridge.startNativePipeline(
        {
          videoPath,
          roi,
          startTime: rangeStart,
          endTime: rangeEnd,
          sampleInterval: stepSeconds,
          minConfidence: options.minConfidence,
          language: options.language,
          enableSceneSkip: true,
        },
        {
          onProgress: (prog) => {
            this.state.setProgress(Math.round(prog.percent))
            summary.framesProcessed = prog.framesProcessed
            summary.framesSkipped = prog.framesSkipped
          },
          onSubtitle: (payload) => {
            const sub = payload.subtitle
            this.state.addSubtitles([
              {
                id: sub.id,
                startTime: Math.round(sub.start_time * 1000),
                endTime: Math.round(sub.end_time * 1000),
                text: sub.text,
                confidence: Math.round(sub.confidence),
                roi,
              },
            ])
          },
          onFinished: (fin) => {
            if (unlistenFn) unlistenFn()
            this.currentTaskId = null
            this.state.setExtracting(false)
            summary.framesProcessed = fin.framesProcessed
            summary.framesSkipped = fin.framesSkipped
            this.lastSummary = summary

            if (fin.status === 'cancelled' || this.isCancelRequested) {
              resolve('cancelled')
            } else if (fin.status === 'error') {
              reject(new Error(fin.errorMessage || '原生提取管道执行失败'))
            } else {
              this.state.setProgress(100)
              resolve('completed')
            }
          },
        },
      )
        .then(({ taskId, unlisten }) => {
          this.currentTaskId = taskId
          unlistenFn = unlisten
          if (this.isCancelRequested) {
            TauriBridge.cancelNativePipeline(taskId).catch(() => {})
          }
        })
        .catch((err) => {
          this.state.setExtracting(false)
          this.currentTaskId = null
          reject(err)
        })
    })
  }

  /** 用户显式配置优先；否则按视频长度使用启发式步长 */
  private resolveStepSeconds(options: ExtractionOptions, duration: number | null): number {
    if (options.sampleInterval !== DEFAULT_EXTRACTION_OPTIONS.sampleInterval) {
      return options.sampleInterval
    }
    if (duration !== null && duration > LONG_VIDEO_SECONDS) return DEFAULT_STEP_LONG_VIDEO
    return DEFAULT_STEP_SHORT_VIDEO
  }

  /** 精准等待 seek 完成，超时兜底 */
  private waitForSeek(videoElement: HTMLVideoElement): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(fallbackTimer)
        videoElement.removeEventListener('seeked', onSeeked)
        resolve()
      }
      const onSeeked = () => finish()
      const fallbackTimer = setTimeout(finish, SEEK_FALLBACK_MS)
      videoElement.addEventListener('seeked', onSeeked, { once: true })
    })
  }
}
