/**
 * 文本工具函数 — 提取自 Pipeline.ts 和 Calibrator.ts
 * 提供 CJK 文本检测、规范化等通用能力。
 */

/** CJK 字符 Unicode 范围：中文 + 日文假名 + 韩文 */
const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/**
 * 检测文本是否主要为 CJK（中日韩）文字。
 * 当 CJK 字符占比超过 50% 时判定为 CJK 文本。
 */
export function isCJKText(text: string): boolean {
  if (!text.length) return false
  const cjkCount = (text.match(new RegExp(CJK_PATTERN.source, 'g')) || []).length
  return cjkCount / text.length > 0.5
}

/**
 * 检测文本中是否包含任何 CJK 字符。
 * 比 isCJKText 更宽松，只要有一个 CJK 字符即返回 true。
 */
export function hasCJKChars(text: string): boolean {
  return CJK_PATTERN.test(text)
}

/**
 * 中文标点 → 英文标点映射（全角 → 半角）
 * 提取自 Calibrator.ts，供多处复用。
 */
export const FULLWIDTH_PUNCT_MAP: Record<string, string> = {
  '，': ',', '。': '.', '！': '!', '？': '?',
  '：': ':', '；': ';', '（': '(', '）': ')',
  '【': '[', '】': ']', '「': '"', '」': '"',
  '『': "'", '』': "'", '、': ',',
}

/**
 * 将全角标点替换为半角标点。
 */
export function normalizeCJKPunct(text: string): string {
  let result = text
  for (const [full, half] of Object.entries(FULLWIDTH_PUNCT_MAP)) {
    // 兼容 ES2020：使用 split+join 替代 replaceAll
    result = result.split(full).join(half)
  }
  return result
}

// ─── 语言 → 书写系统映射 ────────────────────────────────────────
// 优化：从 Calibrator.ts 提取到通用文本工具，解除 useOCREngine/useExtractor 对 @/core 的耦合

export type Script = 'chinese' | 'japanese' | 'korean' | 'latin' | 'other'

/**
 * 语言代码 → 书写系统类型。
 * 供 Calibrator、OCREngine、Extractor 等多处复用。
 */
export function langToScript(lang: string): Script {
  if (['zh', 'chi', 'ch', 'zho'].includes(lang)) return 'chinese'
  if (['ja', 'jpn', 'jap'].includes(lang)) return 'japanese'
  if (['ko', 'kor', 'korean'].includes(lang)) return 'korean'
  if (['en', 'eng', 'latin'].includes(lang)) return 'latin'
  return 'other'
}

/**
 * 计算两段文本之间的归一化 Levenshtein 相似度 (0.0 ~ 1.0)。
 * 融合子串包含判断，以有效应对逐字推进字幕与 OCR 边缘抖动。
 */
export function calculateLevenshteinSimilarity(s1: string, s2: string): number {
  const t1 = s1.trim()
  const t2 = s2.trim()
  if (t1 === t2) return 1.0
  if (!t1.length || !t2.length) return 0.0

  // 子串包含启发式加权（处理逐字显示与前缀/后缀包含）
  if (t1.includes(t2) || t2.includes(t1)) {
    const shorter = Math.min(t1.length, t2.length)
    const longer = Math.max(t1.length, t2.length)
    if (shorter / longer >= 0.65) {
      return Math.max(shorter / longer, 0.85)
    }
  }

  const chars1 = Array.from(t1)
  const chars2 = Array.from(t2)
  const len1 = chars1.length
  const len2 = chars2.length

  let prevRow = new Array(len2 + 1)
  let currRow = new Array(len2 + 1)

  for (let j = 0; j <= len2; j++) {
    prevRow[j] = j
  }

  for (let i = 0; i < len1; i++) {
    currRow[0] = i + 1
    const c1 = chars1[i]
    for (let j = 0; j < len2; j++) {
      const cost = c1 === chars2[j] ? 0 : 1
      currRow[j + 1] = Math.min(
        prevRow[j + 1] + 1,
        currRow[j] + 1,
        prevRow[j] + cost
      )
    }
    const temp = prevRow
    prevRow = currRow
    currRow = temp
  }

  const distance = prevRow[len2]
  const maxLen = Math.max(len1, len2)
  return maxLen === 0 ? 1.0 : 1.0 - distance / maxLen
}

/**
 * 判断两个字幕条目在时序和内容上是否可融合。
 * @param existing 前一个字幕
 * @param incoming 后一个字幕
 * @param maxGapMs 允许的最大时间间隙（毫秒），默认 1500ms
 * @param minSimilarity 文本相似度阈值，默认 0.75
 */
export function areSubtitlesMergeable(
  existingText: string,
  incomingText: string,
  existingEnd: number,
  incomingStart: number,
  maxGapMs = 1500,
  minSimilarity = 0.75
): boolean {
  if (incomingStart < existingEnd - 1000) {
    // 逆序时间戳不融合
    return false
  }
  const gap = Math.max(0, incomingStart - existingEnd)
  if (gap > maxGapMs) {
    return false
  }

  const sim = calculateLevenshteinSimilarity(existingText, incomingText)
  return sim >= minSimilarity
}
