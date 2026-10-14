import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXTRACTION_OPTIONS } from '@/core/ExtractionConfig'
import { useExtractionSettingsStore } from './extractionSettings'
import { LOCALSTORAGE_KEY_EXTRACTION_CONFIG } from '@/utils/constants'

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

describe('useExtractionSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('无持久化数据时使用默认配置', () => {
    const store = useExtractionSettingsStore()
    expect(store.options).toEqual({ ...DEFAULT_EXTRACTION_OPTIONS })
    expect(store.validation.valid).toBe(true)
  })

  it('读取持久化配置时做归一化（过滤非法历史值）', () => {
    vi.stubGlobal(
      'localStorage',
      createMemoryStorage({
        [LOCALSTORAGE_KEY_EXTRACTION_CONFIG]: JSON.stringify({
          sampleInterval: 999,
          language: 'chi_sim+eng',
          minConfidence: -5,
        }),
      }),
    )

    const store = useExtractionSettingsStore()
    expect(store.options.sampleInterval).toBe(30)
    expect(store.options.minConfidence).toBe(0)

    vi.unstubAllGlobals()
  })

  it('损坏的持久化数据回退默认值而不抛错', () => {
    vi.stubGlobal(
      'localStorage',
      createMemoryStorage({ [LOCALSTORAGE_KEY_EXTRACTION_CONFIG]: '{not-json' }),
    )

    const store = useExtractionSettingsStore()
    expect(store.options).toEqual({ ...DEFAULT_EXTRACTION_OPTIONS })

    vi.unstubAllGlobals()
  })

  it('update 只覆盖传入字段，replace 与默认值合并', () => {
    const store = useExtractionSettingsStore()

    store.update({ sampleInterval: 2.5 })
    expect(store.options.sampleInterval).toBe(2.5)
    expect(store.options.language).toBe(DEFAULT_EXTRACTION_OPTIONS.language)

    store.replace({ language: 'eng' })
    expect(store.options.language).toBe('eng')
    expect(store.options.sampleInterval).toBe(DEFAULT_EXTRACTION_OPTIONS.sampleInterval)
  })

  it('reset 恢复默认配置', () => {
    const store = useExtractionSettingsStore()
    store.update({ sampleInterval: 5, minConfidence: 80 })

    store.reset()
    expect(store.options).toEqual({ ...DEFAULT_EXTRACTION_OPTIONS })
  })

  it('validation 反映非法配置', () => {
    const store = useExtractionSettingsStore()
    store.update({ language: 'unsupported-lang' })

    expect(store.validation.valid).toBe(false)
    expect(store.validation.errors[0]).toContain('unsupported-lang')
  })
})
