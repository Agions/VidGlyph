import { describe, expect, it, vi } from 'vitest'
import type { AICorrector, CorrectOptions, CorrectionResult } from '@/core/AICorrector'
import { useAiCorrection } from './useAiCorrection'

function result(original: string, corrected: string): CorrectionResult {
  return { original, corrected, confidence: 0.9, changes: [] }
}

/** 用桩对象替代真实网络请求，专注验证编排行为 */
function createCorrector(
  handler: (text: string, options: CorrectOptions) => Promise<CorrectionResult>,
): AICorrector {
  return { correctOrThrow: handler } as unknown as AICorrector
}

describe('useAiCorrection', () => {
  it('逐条应用修正结果并统计成功 / 未改动数量', async () => {
    const { run, progress } = useAiCorrection()
    const applied: Array<[string, string]> = []
    const corrector = createCorrector(async (text) =>
      text === '原文B' ? result(text, text) : result(text, `${text}!`),
    )

    const outcome = await run(
      corrector,
      [
        { id: 'a', text: '原文A' },
        { id: 'b', text: '原文B' },
        { id: 'c', text: '   ' },
      ],
      (id, text) => applied.push([id, text]),
    )

    expect(outcome.total).toBe(2)
    expect(outcome.corrected).toBe(1)
    expect(outcome.unchanged).toBe(1)
    expect(outcome.failed).toBe(0)
    expect(applied).toEqual([['a', '原文A!']])
    expect(progress.value.percent).toBe(100)
  })

  it('单条失败不影响其它条目，并保留失败明细供重试', async () => {
    const { run } = useAiCorrection()
    const corrector = createCorrector(async (text) => {
      if (text === '坏文本') throw new Error('云端接口返回 429')
      return result(text, `${text}!`)
    })

    const outcome = await run(
      corrector,
      [
        { id: 'a', text: '坏文本' },
        { id: 'b', text: '好文本' },
      ],
      () => {},
    )

    expect(outcome.failed).toBe(1)
    expect(outcome.failures[0]).toMatchObject({ id: 'a', reason: '云端接口返回 429' })
    expect(outcome.corrected).toBe(1)
  })

  it('取消后在途批次标记为 cancelled，未开始条目不再请求', async () => {
    const { run, cancel } = useAiCorrection()
    const calls: string[] = []
    const corrector = createCorrector(async (text, options) => {
      calls.push(text)
      cancel()
      expect(options.signal?.aborted).toBe(true)
      throw new Error('已取消 AI 润色')
    })

    const outcome = await run(
      corrector,
      Array.from({ length: 6 }, (_, index) => ({ id: `id-${index}`, text: `文本${index}` })),
      () => {},
      { concurrency: 1 },
    )

    expect(outcome.cancelled).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('并发度受限于 [1, 8] 区间', async () => {
    const { run, progress } = useAiCorrection()
    let inFlight = 0
    let peak = 0
    const corrector = createCorrector(async (text) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return result(text, text)
    })

    await run(
      corrector,
      Array.from({ length: 8 }, (_, index) => ({ id: `id-${index}`, text: `t${index}` })),
      () => {},
      { concurrency: 99 },
    )

    expect(peak).toBeLessThanOrEqual(8)
    expect(progress.value.total).toBe(8)
  })

  it('没有可处理条目时直接返回空结果', async () => {
    const { run, progress } = useAiCorrection()
    const spy = vi.fn()
    const corrector = createCorrector(spy)

    const outcome = await run(corrector, [{ id: 'a', text: '   ' }], () => {})

    expect(outcome.total).toBe(0)
    expect(spy).not.toHaveBeenCalled()
    expect(progress.value.total).toBe(0)
  })
})
