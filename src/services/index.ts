/**
 * services/ — 基础设施适配层公开出口
 *
 * 约定：领域层与组件不直接依赖具体实现细节，
 * OCR 实现通过 `OCREngineFactory` + `IOCREngineProvider` 端口注入。
 */

export { TauriBridge } from './tauriBridge'
export type {
  DetectedROI,
  NativeOCRResult,
  NativeVideoMetadata,
  SceneChange,
  SceneDetectionConfig,
} from './tauriBridge'
export { DEFAULT_SCENE_CONFIG } from './tauriBridge'

export { UpdaterService } from './updaterService'
export type { UpdateInfo } from './updaterService'

export { OCREngineFactory } from './ocr/OCREngineFactory'
export type { IOCREngineProvider, NormalizedROI, OCRConfig, OCRItem } from './ocr/IOCREngine'
