/**
 * @file useAiCorrection.ts
 * @description AI 字幕润色的批处理编排：进度、并发、逐条失败隔离、重试与取消。
 *
 * 与 `AICorrector` 的分工：本层只负责「怎么跑一批任务」，
 * 单次请求的协议差异与错误语义由领域层 `AICorrector` 负责。
 */

import { computed, ref } from 'vue'
import type { AICorrector, CorrectionResult } from '@/core'
import { logger } from '@/utils/logger'

export interface AiCorrectionTarget {
  id: string
  text: string
}

export interface AiCorrectionFailure {
  id: string
  text: string
  reason: string
}

export interface AiCorrectionOutcome {
  total: number
  /** 文本被改写并已应用 */
  corrected: number
  /** 模型未改动原文 */
  unchanged: number
  failed: number
  cancelled: boolean
  failures: AiCorrectionFailure[]
}

export interface AiCorrectionProgress {
  total: number
  done: number
  failed: number
  percent: number
}

export interface RunAiCorrectionOptions {
  /** 并发请求数，默认 3；过高易触发云端限流 */
  concurrency?: number
  /** 提供给模型的前后文（如视频文件名），提升一致性 */
  context?: string
}

const DEFAULT_CONCURRENCY = 3

export function useAiCorrection() {
  const isRunning = ref(false)
  const progress = ref<AiCorrectionProgress>({ total: 0, done: 0, failed: 0, percent: 0 })
  let controller: AbortController | null = null

  const isCancellable = computed(() => isRunning.value && controller !== null)

  function resetProgress() {
    progress.value = { total: 0, done: 0, failed: 0, percent: 0 }
  }

  /** 取消在途批次：已完成的条目保留，未开始的条目不再发起 */
  function cancel() {
    controller?.abort()
  }

  async function run(
    corrector: AICorrector,
    targets: readonly AiCorrectionTarget[],
    apply: (id: string, text: string) => void,
    options: RunAiCorrectionOptions = {},
  ): Promise<AiCorrectionOutcome> {
    const pending = targets.filter((target) => target.text.trim().length > 0)
    const failures: AiCorrectionFailure[] = []
    const outcome: AiCorrectionOutcome = {
      total: pending.length,
      corrected: 0,
      unchanged: 0,
      failed: 0,
      cancelled: false,
      failures,
    }

    if (pending.length === 0) {
      resetProgress()
      return outcome
    }

    controller = new AbortController()
    const signal = controller.signal
    isRunning.value = true
    resetProgress()
    progress.value = { total: pending.length, done: 0, failed: 0, percent: 0 }

    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 8))
    let cursor = 0

    const worker = async () => {
      while (cursor < pending.length) {
        if (signal.aborted) return
        const target = pending[cursor++]
        if (!target) return

        try {
          const result: CorrectionResult = await corrector.correctOrThrow(target.text, {
            context: options.context,
            signal,
          })
          if (result.corrected && result.corrected !== target.text) {
            apply(target.id, result.corrected)
            outcome.corrected += 1
          } else {
            outcome.unchanged += 1
          }
        } catch (error) {
          if (signal.aborted) return
          outcome.failed += 1
          failures.push({
            id: target.id,
            text: target.text,
            reason: error instanceof Error ? error.message : String(error),
          })
          logger.warn('AiCorrection', `润色失败(${target.id})`, error)
        } finally {
          progress.value = {
            total: pending.length,
            done: outcome.corrected + outcome.unchanged + outcome.failed,
            failed: outcome.failed,
            percent: Math.round(
              ((outcome.corrected + outcome.unchanged + outcome.failed) / pending.length) * 100,
            ),
          }
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
      outcome.cancelled = signal.aborted
      return outcome
    } finally {
      isRunning.value = false
      controller = null
    }
  }

  /** 仅重试上一批中失败的条目 */
  async function retryFailed(
    corrector: AICorrector,
    failures: readonly AiCorrectionFailure[],
    apply: (id: string, text: string) => void,
    options: RunAiCorrectionOptions = {},
  ): Promise<AiCorrectionOutcome> {
    return run(
      corrector,
      failures.map((failure) => ({ id: failure.id, text: failure.text })),
      apply,
      options,
    )
  }

  return { isRunning, isCancellable, progress, run, retryFailed, cancel }
}
