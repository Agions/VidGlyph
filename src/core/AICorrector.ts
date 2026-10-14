/**
 * @file AICorrector.ts
 * @description AI 字幕校对引擎（错别字 / 标点 / 上下文一致性）。
 *
 * 兼容两类云端接口，按 endpoint 自动识别：
 * - OpenAI 兼容（`/v1/chat/completions`、`choices[0].message.content`）
 * - Google Gemini（`...:generateContent`、`candidates[0].content.parts[].text`）
 *
 * 错误策略：
 * - `correct()` 保持宽松语义（失败返回原文、置信度 0），适合批量静默处理；
 * - `correctOrThrow()` 抛出 `AICorrectionError`，供需要对单条失败做重试 / 提示的调用方使用。
 */

export type AIProviderKind = 'openai' | 'gemini'

export interface AICorrectorConfig {
  apiEndpoint: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  /** 单次请求超时（毫秒），默认 30 秒 */
  timeoutMs?: number
}

export interface CorrectionChange {
  type: 'typo' | 'punctuation' | 'context'
  original: string
  corrected: string
}

export interface CorrectionResult {
  original: string
  corrected: string
  confidence: number
  changes: CorrectionChange[]
}

export interface CorrectOptions {
  /** 上下文（如前一条 / 后一条字幕），用于提升一致性 */
  context?: string
  /** 取消信号：任务取消时中止在途请求 */
  signal?: AbortSignal
}

/** 单条字幕润色失败时抛出，携带可读原因 */
export class AICorrectionError extends Error {
  public readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AICorrectionError'
    this.cause = cause
  }
}

/** 依据 endpoint 判断云端接口类型 */
export function detectProviderKind(apiEndpoint: string): AIProviderKind {
  return /generativelanguage\.googleapis\.com|:generateContent/i.test(apiEndpoint)
    ? 'gemini'
    : 'openai'
}

const SYSTEM_PROMPT = '你是一个专业的字幕校对助手。只返回JSON格式结果。'
const DEFAULT_TIMEOUT_MS = 30_000

export class AICorrector {
  private readonly config: AICorrectorConfig
  private readonly provider: AIProviderKind

  constructor(config: AICorrectorConfig) {
    this.config = config
    this.provider = detectProviderKind(config.apiEndpoint)
  }

  /** 宽松模式：任何失败都回退为原文，置信度 0（不抛错） */
  async correct(text: string, context?: string): Promise<CorrectionResult> {
    try {
      return await this.correctOrThrow(text, { context })
    } catch {
      return { original: text, corrected: text, confidence: 0, changes: [] }
    }
  }

  /** 严格模式：失败抛出 `AICorrectionError`，供调用方做重试与提示 */
  async correctOrThrow(text: string, options: CorrectOptions = {}): Promise<CorrectionResult> {
    if (!text.trim()) {
      return { original: text, corrected: text, confidence: 1, changes: [] }
    }

    const prompt = this.buildPrompt(text, options.context)
    const response = await this.callLLM(prompt, options.signal)
    const parsed = this.parseResponse(text, response)

    if (parsed.confidence === 0) {
      throw new AICorrectionError('模型返回内容无法解析为校对结果')
    }
    return parsed
  }

  /** 顺序批量纠错（保持接口兼容；需要进度 / 取消请使用 useAiCorrection） */
  async correctBatch(texts: string[], context?: string): Promise<CorrectionResult[]> {
    const results: CorrectionResult[] = []
    for (const text of texts) {
      results.push(await this.correct(text, context))
    }
    return results
  }

  private buildPrompt(text: string, context?: string): string {
    const base = `你是一个专业的字幕校对助手。请修正以下 OCR 识别结果中的错误：

原文：${text}

要求：
1. 修正错别字
2. 规范标点符号
3. 保持原意不变
4. 如果是多语言混合，保持语言一致性

请返回 JSON 格式：
{
  "corrected": "修正后的文本",
  "confidence": 0.95,
  "changes": [
    {
      "type": "typo|punctuation|context",
      "original": "原文片段",
      "corrected": "修正后"
    }
  ]
}

只返回 JSON，不要其他内容。`

    return context ? `上下文信息：${context}\n\n${base}` : base
  }

  /** 组装请求：按 provider 生成 body / headers / URL */
  private buildRequest(prompt: string): { url: string; init: RequestInit } {
    const { apiEndpoint, apiKey, model, temperature, maxTokens } = this.config

    if (this.provider === 'gemini') {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['x-goog-api-key'] = apiKey
      return {
        url: apiEndpoint,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              responseMimeType: 'application/json',
            },
          }),
        },
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    return {
      url: apiEndpoint,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
      },
    }
  }

  private async callLLM(prompt: string, signal?: AbortSignal): Promise<string> {
    const { url, init } = this.buildRequest(prompt)
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const { signal: combinedSignal, cleanup } = this.withTimeout(signal, timeoutMs)

    try {
      const response = await fetch(url, { ...init, signal: combinedSignal })

      if (!response.ok) {
        throw new AICorrectionError(`云端接口返回 ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as unknown
      return this.extractContent(data)
    } catch (error) {
      if (signal?.aborted) throw new AICorrectionError('已取消 AI 润色')
      if (error instanceof AICorrectionError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AICorrectionError('AI 润色请求超时')
      }
      throw new AICorrectionError('AI 润色请求失败，请检查网络与接口地址', error)
    } finally {
      cleanup()
    }
  }

  /** 按 provider 提取文本内容 */
  private extractContent(data: unknown): string {
    const payload = data as {
      choices?: Array<{ message?: { content?: string } }>
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      error?: { message?: string }
    }

    if (payload.error?.message) {
      throw new AICorrectionError(payload.error.message)
    }
    if (this.provider === 'gemini') {
      const parts = payload.candidates?.[0]?.content?.parts ?? []
      return parts.map((part) => part.text ?? '').join('')
    }
    return payload.choices?.[0]?.message?.content ?? ''
  }

  /** 组合外部取消信号与超时信号，并保证定时器被清理 */
  private withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      return {
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        cleanup: () => {},
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const abortFromCaller = () => controller.abort()
    signal?.addEventListener('abort', abortFromCaller, { once: true })

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abortFromCaller)
      },
    }
  }

  private parseResponse(original: string, response: string): CorrectionResult {
    try {
      let jsonStr = response
      const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenced) jsonStr = fenced[1]

      const brace = jsonStr.match(/\{[\s\S]*\}/)
      if (brace) jsonStr = brace[0]

      const parsed = JSON.parse(jsonStr) as {
        corrected?: string
        confidence?: number
        changes?: CorrectionChange[]
      }

      return {
        original,
        corrected: parsed.corrected || original,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      }
    } catch {
      return { original, corrected: original, confidence: 0, changes: [] }
    }
  }
}
