import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AICorrectionError, AICorrector, detectProviderKind } from './AICorrector'

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

describe('detectProviderKind', () => {
  it('识别 Gemini generateContent 端点', () => {
    expect(detectProviderKind(GEMINI_ENDPOINT)).toBe('gemini')
  })

  it('其它端点按 OpenAI 兼容协议处理', () => {
    expect(detectProviderKind('https://api.openai.com/v1/chat/completions')).toBe('openai')
    expect(detectProviderKind('http://localhost:11434/v1/chat/completions')).toBe('openai')
  })
})

describe('AICorrector Gemini 协议', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockClear()
  })

  function createGeminiCorrector() {
    return new AICorrector({
      apiEndpoint: GEMINI_ENDPOINT,
      apiKey: 'test-key',
      model: 'gemini-1.5-flash',
      temperature: 0.2,
      maxTokens: 512,
    })
  }

  it('按 Gemini 契约组装请求体与鉴权头', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [
                  { text: JSON.stringify({ corrected: '今天天气真好', confidence: 0.95, changes: [] }) },
                ],
              },
            },
          ],
        }),
    })

    const result = await createGeminiCorrector().correctOrThrow('今天天汽真好')

    expect(result.corrected).toBe('今天天气真好')

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(GEMINI_ENDPOINT)
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-key')
    expect(headers['Authorization']).toBeUndefined()

    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].text).toContain('今天天汽真好')
    expect(body.generationConfig.maxOutputTokens).toBe(512)
    expect(body.messages).toBeUndefined()
  })

  it('多段候选文本会被拼接', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            {
              content: {
                parts: [{ text: '{"corrected":' }, { text: '"拼接结果","confidence":0.9}' }],
              },
            },
          ],
        }),
    })

    const result = await createGeminiCorrector().correctOrThrow('原文')
    expect(result.corrected).toBe('拼接结果')
  })

  it('接口报错时严格模式抛出可读错误', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    })

    await expect(createGeminiCorrector().correctOrThrow('文本')).rejects.toThrow(AICorrectionError)
    await expect(createGeminiCorrector().correctOrThrow('文本')).rejects.toThrow('400')
  })

  it('严格模式对无法解析的响应抛错，宽松模式回退原文', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '不是JSON' }] } }] }),
    })

    const corrector = createGeminiCorrector()
    await expect(corrector.correctOrThrow('原文')).rejects.toThrow('无法解析')

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '不是JSON' }] } }] }),
    })
    const relaxed = await corrector.correct('原文')
    expect(relaxed).toMatchObject({ corrected: '原文', confidence: 0 })
  })

  it('API 返回 error 字段时转换为可读错误', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: { message: 'API key not valid' } }),
    })

    await expect(createGeminiCorrector().correctOrThrow('文本')).rejects.toThrow('API key not valid')
  })

  it('空文本不发起网络请求', async () => {
    const result = await createGeminiCorrector().correctOrThrow('   ')
    expect(result.confidence).toBe(1)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
