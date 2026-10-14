/**
 * stores/ — 会话状态层公开出口
 *
 * 约定：同一业务状态只允许一个 Store 作为事实来源。
 * 曾存在的 `stores/subtitle.ts` 与 `stores/subtitleStore.ts` 同名导出已合并，
 * 新增状态请在此处登记，禁止重复定义 Pinia id。
 */

export { useSubtitleStore } from './subtitleStore'
export { useSecurityStore } from './securityStore'
export { useExtractionSettingsStore } from './extractionSettings'
