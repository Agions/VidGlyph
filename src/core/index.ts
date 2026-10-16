/**
 * core/ — VidGlyph 领域层公开出口
 *
 * 分层约定：
 * - `ExtractionConfig` / `ExportValidator`：纯函数规则，可独立单元测试；
 * - `PipelineEngine` / `ExtractionUseCase`：提取用例与端口定义；
 * - `Exporter` / `AICorrector` / `Calibrator` / `SceneDetect`：领域服务。
 *
 * 该 barrel 是本层唯一对外契约，组件与 composable 不应直接深入子文件路径。
 */

export { PipelineEngine } from './PipelineEngine'
export type {
  ExtractionResult,
  ExtractionRunSummary,
  ExtractionStatePort,
  ExtractionUseCase,
  OCREngineResolver,
} from './ExtractionUseCase'

export {
  DEFAULT_EXTRACTION_OPTIONS,
  MAX_EXTRACTION_SPAN,
  MAX_SAMPLE_INTERVAL,
  MIN_SAMPLE_INTERVAL,
  SUPPORTED_LANGUAGES,
  estimateFrameCount,
  mergeExtractionOptions,
  validateExtractionOptions,
} from './ExtractionConfig'
export type { ExtractionConfigValidation, ExtractionOptions } from './ExtractionConfig'

export {
  LOW_CONFIDENCE_THRESHOLD,
  MAX_SUBTITLE_DURATION_MS,
  filterExportable,
  formatExportSummary,
  validateSubtitleTimeline,
} from './ExportValidator'
export type {
  ExportIssue,
  ExportIssueCode,
  ExportValidationStats,
  ExportValidationSummary,
} from './ExportValidator'

export { DEFAULT_AUTO_ROI_OPTIONS, detectSubtitleBand } from './AutoRoiDetector'
export type { AutoRoiDetection, AutoRoiOptions, NormalizedBand } from './AutoRoiDetector'

export { AICorrectionError, AICorrector, detectProviderKind } from './AICorrector'
export type {
  AICorrectorConfig,
  AIProviderKind,
  CorrectOptions,
  CorrectionChange,
  CorrectionResult,
} from './AICorrector'

export { Exporter, getExporter, exportJSONL, exportVTTWithStyle } from './Exporter'
export type { ExportResult, VTTStyle } from './Exporter'

export { Calibrator, getCalibrator, langToScript } from './Calibrator'
export { SceneDetect } from './SceneDetect'
export type { SceneDetectOptions } from './SceneDetect'
