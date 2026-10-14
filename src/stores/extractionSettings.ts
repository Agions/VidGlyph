/**
 * @file extractionSettings.ts
 * @description 提取任务配置 Store —— 「提取范围 / 采样间隔 / 语言 / 置信度」的唯一事实来源。
 *
 * 设计要点：
 * - 写入口径统一为 `update()` / `reset()`，避免组件各自拼装字段；
 * - 持久化带防抖与容量保护，读取时做一次校验归一化；
 * - 暴露 `validation` 计算结果供 UI 直接提示错误，不在组件内重复实现校验。
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_EXTRACTION_OPTIONS,
  mergeExtractionOptions,
  validateExtractionOptions,
  type ExtractionOptions,
} from '@/core'
import { LOCALSTORAGE_KEY_EXTRACTION_CONFIG, LOCALSTORAGE_SIZE_LIMIT } from '@/utils/constants'
import { logger } from '@/utils/logger'

const PERSIST_DEBOUNCE_MS = 120

/** 安全获取可用的 localStorage（测试环境 / 受限容器可能不存在或为桩对象） */
function getLocalStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage
    if (!candidate || typeof candidate.getItem !== 'function') return null
    return candidate
  } catch {
    return null
  }
}

function loadOptions(): ExtractionOptions {
  const storage = getLocalStorage()
  if (!storage) return { ...DEFAULT_EXTRACTION_OPTIONS }
  try {
    const raw = storage.getItem(LOCALSTORAGE_KEY_EXTRACTION_CONFIG)
    if (!raw) return { ...DEFAULT_EXTRACTION_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<ExtractionOptions>
    // 读取时归一化：历史数据可能缺少字段或含非法值
    return validateExtractionOptions(parsed).options
  } catch (error) {
    logger.warn('ExtractionSettings', '读取提取配置失败，已回退默认值', error)
    return { ...DEFAULT_EXTRACTION_OPTIONS }
  }
}

export const useExtractionSettingsStore = defineStore('extractionSettings', () => {
  const options = ref<ExtractionOptions>(loadOptions())

  /** 当前配置的校验结果（duration 未知，范围上限延迟到提取时校验） */
  const validation = computed(() => validateExtractionOptions(options.value, null))

  /** 依据配置覆盖更新（缺省字段保持原值） */
  function update(patch: Partial<ExtractionOptions>) {
    options.value = mergeExtractionOptions(options.value, patch)
  }

  /** 整体替换（会与默认值合并，防止缺字段） */
  function replace(next: Partial<ExtractionOptions>) {
    options.value = { ...DEFAULT_EXTRACTION_OPTIONS, ...next }
  }

  /** 恢复默认配置 */
  function reset() {
    options.value = { ...DEFAULT_EXTRACTION_OPTIONS }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    options,
    (next) => {
      const storage = getLocalStorage()
      if (!storage) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        try {
          const serialized = JSON.stringify(next)
          if (serialized.length > LOCALSTORAGE_SIZE_LIMIT) {
            logger.warn('ExtractionSettings', '配置过大，已跳过持久化')
            return
          }
          storage.setItem(LOCALSTORAGE_KEY_EXTRACTION_CONFIG, serialized)
        } catch (error) {
          logger.warn('ExtractionSettings', '保存提取配置失败', error)
        }
      }, PERSIST_DEBOUNCE_MS)
    },
    { deep: true },
  )

  return { options, validation, update, replace, reset }
})
