/**
 * @file ExtractionConfig.ts
 * @description 提取任务配置模型与校验规则（纯函数，无 Vue / DOM 依赖）。
 *
 * 该模块是「提取范围 / 采样间隔 / 识别语言 / 置信度阈值」的唯一事实来源：
 * - UI 层通过 `useExtractionSettings` Store 持久化配置并调用这里的校验；
 * - 领域层 `PipelineEngine` 只消费校验后的不可变配置，不再各自硬编码参数。
 */

/** 提取任务参数（用户可配置项） */
export interface ExtractionOptions {
  /** 提取起始时间（秒，含） */
  startTime: number
  /** 提取结束时间（秒，不含）；null 表示直到视频结尾 */
  endTime: number | null
  /** 抽帧采样间隔（秒） */
  sampleInterval: number
  /** 最低置信度阈值（0~100，低于该值的识别结果会被丢弃） */
  minConfidence: number
  /** OCR 识别语言（Tesseract 语言包标识，如 chi_sim+eng） */
  language: string
  /** 本地引擎是否对帧图像做降噪预处理 */
  preprocessDenoise: boolean
}

export const MIN_SAMPLE_INTERVAL = 0.2
export const MAX_SAMPLE_INTERVAL = 30

/** 单次任务最大覆盖时长（秒），避免误配置导致长时间占用 */
export const MAX_EXTRACTION_SPAN = 6 * 60 * 60

export const DEFAULT_EXTRACTION_OPTIONS: Readonly<ExtractionOptions> = Object.freeze({
  startTime: 0,
  endTime: null,
  sampleInterval: 1,
  minConfidence: 0,
  language: 'chi_sim+eng',
  preprocessDenoise: true,
})

/** 受支持的识别语言（与 Tesseract 语言包 / 云端提示词保持一致） */
export const SUPPORTED_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'chi_sim+eng', label: '简体中文 + 英文' },
  { value: 'chi_tra+eng', label: '繁体中文 + 英文' },
  { value: 'eng', label: '英文' },
  { value: 'jpn', label: '日文' },
  { value: 'kor', label: '韩文' },
]

export interface ExtractionConfigValidation {
  /** 是否存在阻断性问题（有则不可启动提取） */
  valid: boolean
  /** 阻断性错误，逐条可展示 */
  errors: string[]
  /** 非阻断提示（如被自动收窄的范围） */
  warnings: string[]
  /** 归一化后的配置 */
  options: ExtractionOptions
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 校验并归一化提取配置。
 * @param input 用户输入（允许缺省字段）
 * @param duration 视频总时长（秒）；未知时传 null，将跳过范围越界检查
 */
export function validateExtractionOptions(
  input: Partial<ExtractionOptions> = {},
  duration: number | null = null,
): ExtractionConfigValidation {
  const errors: string[] = []
  const warnings: string[] = []

  const merged: ExtractionOptions = { ...DEFAULT_EXTRACTION_OPTIONS, ...input }

  // ── 采样间隔 ────────────────────────────────────────────────
  let sampleInterval = merged.sampleInterval
  if (!isFiniteNumber(sampleInterval) || sampleInterval <= 0) {
    errors.push('采样间隔必须是大于 0 的数字')
    sampleInterval = DEFAULT_EXTRACTION_OPTIONS.sampleInterval
  } else if (sampleInterval < MIN_SAMPLE_INTERVAL) {
    errors.push(`采样间隔过小，最小支持 ${MIN_SAMPLE_INTERVAL} 秒`)
    sampleInterval = MIN_SAMPLE_INTERVAL
  } else if (sampleInterval > MAX_SAMPLE_INTERVAL) {
    errors.push(`采样间隔过大，最大支持 ${MAX_SAMPLE_INTERVAL} 秒`)
    sampleInterval = MAX_SAMPLE_INTERVAL
  }

  // ── 置信度阈值 ──────────────────────────────────────────────
  let minConfidence = merged.minConfidence
  if (!isFiniteNumber(minConfidence)) {
    errors.push('置信度阈值必须是数字')
    minConfidence = DEFAULT_EXTRACTION_OPTIONS.minConfidence
  } else if (minConfidence < 0 || minConfidence > 100) {
    errors.push('置信度阈值需在 0 ~ 100 之间')
    minConfidence = Math.min(100, Math.max(0, minConfidence))
  }

  // ── 识别语言 ────────────────────────────────────────────────
  const language = (merged.language ?? '').trim()
  if (!language) {
    errors.push('识别语言不能为空')
  } else if (!SUPPORTED_LANGUAGES.some((item) => item.value === language)) {
    errors.push(`暂不支持识别语言「${language}」`)
  }

  // ── 时间范围 ────────────────────────────────────────────────
  const knownDuration = isFiniteNumber(duration) && duration > 0 ? duration : null

  let startTime = merged.startTime
  if (!isFiniteNumber(startTime) || startTime < 0) {
    errors.push('起始时间必须是不小于 0 的数字')
    startTime = 0
  }

  let endTime = merged.endTime
  if (endTime !== null) {
    if (!isFiniteNumber(endTime) || endTime <= 0) {
      errors.push('结束时间必须是大于 0 的数字或留空')
      endTime = null
    } else {
      if (knownDuration !== null && endTime > knownDuration) {
        warnings.push(`结束时间超出视频时长，已收窄至 ${knownDuration.toFixed(1)} 秒`)
        endTime = knownDuration
      }
      if (endTime <= startTime) {
        errors.push('结束时间必须晚于起始时间')
      }
    }
  }

  if (knownDuration !== null && startTime >= knownDuration) {
    errors.push(`起始时间需小于视频时长 ${knownDuration.toFixed(1)} 秒`)
  }

  if ((endTime ?? knownDuration ?? 0) - startTime > MAX_EXTRACTION_SPAN) {
    errors.push('单次提取范围过长，请缩短区间后分批提取')
  }

  const options: ExtractionOptions = {
    startTime: Number(startTime.toFixed(3)),
    endTime: endTime === null ? null : Number(endTime.toFixed(3)),
    sampleInterval: Number(sampleInterval.toFixed(3)),
    minConfidence,
    language,
    preprocessDenoise: merged.preprocessDenoise !== false,
  }

  return { valid: errors.length === 0, errors, warnings, options }
}

/** 依据配置估算需要抽取的帧数量（用于进度展示与耗时预估） */
export function estimateFrameCount(
  options: Pick<ExtractionOptions, 'startTime' | 'endTime' | 'sampleInterval'>,
  duration: number,
): number {
  if (!isFiniteNumber(duration) || duration <= 0) return 0
  const start = Math.max(0, options.startTime)
  const end = Math.min(duration, options.endTime ?? duration)
  const span = Math.max(0, end - start)
  if (span <= 0) return 0
  const interval = options.sampleInterval > 0 ? options.sampleInterval : 1
  return Math.max(1, Math.ceil(span / interval))
}

/** 覆盖式合并配置，用于 `DEFAULT → Store → 调用方` 的逐层覆盖 */
export function mergeExtractionOptions(
  base: ExtractionOptions,
  patch?: Partial<ExtractionOptions> | null,
): ExtractionOptions {
  if (!patch) return { ...base }
  const merged: ExtractionOptions = { ...base, ...patch }
  return { ...merged, endTime: patch.endTime === undefined ? base.endTime : patch.endTime }
}
