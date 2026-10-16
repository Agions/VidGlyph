import type {
  IOCREngineProvider,
  NormalizedROI,
  OCRConfig,
  OCRItem,
} from '@/services/ocr/IOCREngine'
import type { ExtractionOptions } from './ExtractionConfig'

export type ExtractionResult = 'completed' | 'cancelled'

/** 单次提取运行汇总，供 UI 提示与可追溯日志使用 */
export interface ExtractionRunSummary {
  /** 实际完成 OCR 的帧数 */
  framesProcessed: number
  /** 被跳过的帧数（OCR 抛错或返回空结果） */
  framesSkipped: number
  /** 被置信度阈值过滤掉的条目数 */
  filteredByConfidence: number
  /** 采样区间 [start, end)（秒） */
  range: [number, number]
  /** 采样间隔（秒） */
  sampleInterval: number
}

/** 核心提取流程对工作区状态的最小依赖。 */
export interface ExtractionStatePort {
  getConfig(): OCRConfig
  /** 可选：读取用户配置的提取参数（未实现时使用默认值） */
  getExtractionOptions?(): Partial<ExtractionOptions>
  /** 可选：读取当前视频本地文件系统路径（桌面端原生管道使用） */
  getVideoPath?(): string | null
  setExtracting(extracting: boolean): void
  setProgress(percent: number): void
  addSubtitles(items: OCRItem[]): void
}

/** OCR 实例解析端口，便于在测试或未来插件系统中替换实现。 */
export interface OCREngineResolver {
  getEngine(config: OCRConfig): Promise<IOCREngineProvider>
}

export interface ExtractionUseCase {
  startExtraction(
    videoElement: HTMLVideoElement,
    roi: NormalizedROI,
    options?: Partial<ExtractionOptions>,
  ): Promise<ExtractionResult>
  cancel(): void
}
