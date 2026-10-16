/**
 * @file legacyStorage.ts
 * @description 品牌重命名（Distill / CaptionFab / SubLens → VidGlyph）后的本地数据迁移。
 *
 * 兼容策略：旧 key 一律「复制」到新 key，不删除原数据，
 * 保证用户凭据 / 配置升级后不丢失，同时允许回滚到旧版本。
 */

const LEGACY_PREFIXES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'sublens-', to: 'vidglyph-' },
  { from: 'sublens_', to: 'vidglyph_' },
  { from: 'distill-', to: 'vidglyph-' },
  { from: 'distill_', to: 'vidglyph_' },
  { from: 'caption-fab', to: 'vidglyph' },
  { from: 'captionfab', to: 'vidglyph' },
]

/** 把单个旧 key 映射为新 key；无匹配前缀时返回 null */
export function mapLegacyKey(key: string): string | null {
  for (const { from, to } of LEGACY_PREFIXES) {
    if (key.startsWith(from)) return `${to}${key.slice(from.length)}`
  }
  return null
}

export interface MigrationReport {
  migrated: Array<{ from: string; to: string }>
  /** 目标 key 已存在、无需迁移 */
  skipped: Array<{ from: string; to: string }>
}

/**
 * 执行一次性迁移。可在应用启动最早期调用，重复调用无副作用。
 */
export function migrateLegacyStorageKeys(storage?: Storage): MigrationReport {
  const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const report: MigrationReport = { migrated: [], skipped: [] }
  if (!target) return report

  let keys: string[]
  try {
    keys = Object.keys(target)
  } catch {
    return report
  }

  for (const key of keys) {
    const mapped = mapLegacyKey(key)
    if (!mapped) continue

    try {
      if (target.getItem(mapped) !== null) {
        report.skipped.push({ from: key, to: mapped })
        continue
      }
      const value = target.getItem(key)
      if (value === null) continue
      target.setItem(mapped, value)
      report.migrated.push({ from: key, to: mapped })
    } catch {
      // 单个 key 迁移失败不影响其余数据
    }
  }

  return report
}
