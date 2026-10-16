import { describe, expect, it } from 'vitest'
import { mapLegacyKey, migrateLegacyStorageKeys } from './legacyStorage'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length() {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }

  // 让 Object.keys(storage) 返回已存储的键，模拟真实 Storage 行为
  [Symbol.iterator]() {
    return this.map.keys()
  }
}

function createStorage(entries: Record<string, string>): Storage {
  const storage = new MemoryStorage()
  for (const [key, value] of Object.entries(entries)) {
    storage.setItem(key, value)
    Object.defineProperty(storage, key, { value, enumerable: true, configurable: true })
  }
  return storage
}

describe('mapLegacyKey', () => {
  it('把历史品牌前缀映射到新品牌前缀', () => {
    expect(mapLegacyKey('sublens-settings')).toBe('vidglyph-settings')
    expect(mapLegacyKey('sublens_sec_credentials_v1')).toBe('vidglyph_sec_credentials_v1')
    expect(mapLegacyKey('distill-settings')).toBe('vidglyph-settings')
    expect(mapLegacyKey('distill_sec_credentials_v1')).toBe('vidglyph_sec_credentials_v1')
    expect(mapLegacyKey('caption-fab-config')).toBe('vidglyph-config')
    expect(mapLegacyKey('captionfab-cache')).toBe('vidglyph-cache')
  })

  it('非历史键返回 null', () => {
    expect(mapLegacyKey('vidglyph-settings')).toBeNull()
    expect(mapLegacyKey('unrelated')).toBeNull()
  })
})

describe('migrateLegacyStorageKeys', () => {
  it('复制旧键数据到新键，且保留旧键以便回滚', () => {
    const storage = createStorage({ 'sublens-settings': '{"theme":"dark"}' })
    const report = migrateLegacyStorageKeys(storage)

    expect(report.migrated).toEqual([{ from: 'sublens-settings', to: 'vidglyph-settings' }])
    expect(storage.getItem('vidglyph-settings')).toBe('{"theme":"dark"}')
    expect(storage.getItem('sublens-settings')).toBe('{"theme":"dark"}')
  })

  it('目标键已存在时不覆盖用户新数据', () => {
    const storage = createStorage({
      'sublens-settings': 'old',
      'vidglyph-settings': 'new',
    })
    const report = migrateLegacyStorageKeys(storage)

    expect(report.migrated).toEqual([])
    expect(report.skipped).toEqual([{ from: 'sublens-settings', to: 'vidglyph-settings' }])
    expect(storage.getItem('vidglyph-settings')).toBe('new')
  })

  it('不可用的存储环境返回空报告而不抛错', () => {
    expect(migrateLegacyStorageKeys(undefined as unknown as Storage).migrated).toEqual([])
  })
})
