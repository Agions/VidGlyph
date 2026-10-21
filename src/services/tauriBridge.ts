/**
 * @file tauriBridge.ts
 * @description Tauri 2.x Rust 后端 IPC 桥接层（基础设施适配器）。
 *
 * 契约约定：
 * - 命令名与 Rust `generate_handler!` 注册名保持一致；
 * - 顶层命令参数使用 camelCase（Tauri v2 约定），嵌套结构体字段沿用 Rust 侧
 *   的 snake_case（未声明 `serde(rename_all)`），因此 `config` 内使用下划线命名；
 * - 所有方法在非 Tauri 环境下安全降级或抛出可读错误，不静默返回脏数据。
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { logger } from '@/utils/logger'

/**
 * 自动检测到的字幕选区。
 * 注意：坐标统一为归一化比例 0~1（Rust 侧返回 percent，桥接层已完成换算），
 * 与全应用其它 ROI 结构保持一致，调用方无需再做单位转换。
 */
export interface DetectedROI {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

/** Rust `DetectedROI`：坐标为 percent(0-100)，仅在本文件内部使用 */
interface RawDetectedROI extends DetectedROI {}

export interface NativeVideoMetadata {
  path: string
  width: number
  height: number
  duration: number
  fps: number
  total_frames: number
  codec: string
}

export interface NativeOCRResult {
  text: string
  confidence: number
  bbox: { x: number; y: number; width: number; height: number }
}

export interface SceneChange {
  frame_index: number
  timestamp: number
  similarity: number
}

/** Rust `SceneDetectionConfig` 字段（snake_case，与后端 serde 契约一致） */
export interface SceneDetectionConfig {
  threshold: number
  min_scene_length: number
  frame_interval: number
}

/** PySceneDetect 量纲的阈值会由 Rust 侧映射为 FFmpeg 场景阈值 */
export const DEFAULT_SCENE_CONFIG: SceneDetectionConfig = {
  threshold: 27,
  min_scene_length: 15,
  frame_interval: 3,
}

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', 'wmv', '3gp']

/** 导出格式 → 原生保存对话框过滤器 */
const EXPORT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  srt: { name: 'SRT Subtitle', extensions: ['srt'] },
  vtt: { name: 'WebVTT Subtitle', extensions: ['vtt'] },
  ass: { name: 'ASS Subtitle', extensions: ['ass'] },
  ssa: { name: 'SSA Subtitle', extensions: ['ssa'] },
  sbv: { name: 'SBV Subtitle', extensions: ['sbv'] },
  lrc: { name: 'LRC Lyrics', extensions: ['lrc'] },
  json: { name: 'JSON Data', extensions: ['json'] },
  jsonl: { name: 'JSON Lines', extensions: ['jsonl'] },
  csv: { name: 'CSV Data', extensions: ['csv'] },
  txt: { name: 'Text File', extensions: ['txt'] },
}

export interface NativePipelineRequest {
  taskId?: string
  videoPath: string
  roi: { x: number; y: number; width: number; height: number }
  startTime?: number
  endTime?: number
  sampleInterval?: number
  minConfidence?: number
  language?: string
  enableSceneSkip?: boolean
}

export interface PipelineProgressPayload {
  taskId: string
  currentTime: number
  totalTime: number
  percent: number
  framesProcessed: number
  framesSkipped: number
  subtitlesCount: number
}

export interface PipelineSubtitlePayload {
  taskId: string
  subtitle: {
    index: number
    id: string
    start_time: number
    end_time: number
    text: string
    confidence: number
    language?: string
  }
}

export interface PipelineFinishedPayload {
  taskId: string
  status: 'completed' | 'cancelled' | 'error'
  totalFrames: number
  framesProcessed: number
  framesSkipped: number
  subtitlesCount: number
  elapsedMs: number
  errorMessage?: string
}

export interface NativeOcrStatus {
  ready: boolean
  detExists: boolean
  recExists: boolean
  modelDir: string
}

export interface ProjectRecord {
  id: string
  name: string
  videoPath: string
  videoHash?: string | null
  durationMs: number
  width: number
  height: number
  fps: number
  roiJson: string
  createdAt: number
  updatedAt: number
}

export interface SubtitleRecord {
  id: string
  projectId: string
  startTimeMs: number
  endTimeMs: number
  textRaw: string
  textCorrected?: string | null
  confidence: number
  bboxJson?: string | null
  isReviewed: boolean
  createdAt: number
}

export interface BatchTaskRecord {
  id: string
  projectId?: string | null
  videoPath: string
  status: string
  progress: number
  configJson: string
  errorMsg?: string | null
  createdAt: number
  finishedAt?: number | null
}

export interface ProjectDetail {
  project: ProjectRecord
  subtitles: SubtitleRecord[]
}

export class TauriBridge {
  /** 检测当前应用是否运行在 Tauri 客户端容器中 */
  public static isTauriEnv(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  }

  /** 将原生系统路径转换为可在 Web 视图渲染的 asset URI */
  public static convertPathToAssetUrl(filePath: string): string {
    try {
      return convertFileSrc(filePath)
    } catch {
      return `https://asset.localhost/${encodeURIComponent(filePath)}`
    }
  }

  /** 调用原生文件选择对话框选择视频文件；取消时返回 null */
  public static async openVideoFileDialog(): Promise<string | null> {
    if (!this.isTauriEnv()) return null
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Video Files', extensions: VIDEO_EXTENSIONS }],
      })
      if (Array.isArray(selected)) return selected[0] || null
      return typeof selected === 'string' ? selected : null
    } catch (error) {
      logger.warn('TauriBridge', '打开视频文件对话框失败/取消', error)
      return null
    }
  }

  /** 获取视频元数据（时长、分辨率、FPS、编码） */
  public static async getVideoMetadata(filePath: string): Promise<NativeVideoMetadata | null> {
    if (!this.isTauriEnv()) return null
    return await invoke<NativeVideoMetadata>('get_video_metadata', { path: filePath })
  }

  /** 场景切换检测 */
  public static async detectScenes(
    filePath: string,
    config: Partial<SceneDetectionConfig> = {},
  ): Promise<SceneChange[]> {
    if (!this.isTauriEnv()) return []
    return await invoke<SceneChange[]>('detect_scenes', {
      videoPath: filePath,
      config: { ...DEFAULT_SCENE_CONFIG, ...config },
    })
  }

  /**
   * 原生智能硬字幕 ROI 检测（仅桌面端可用）。
   * Rust 返回 percent(0-100)，此处统一归一化为 0~1 后再交给调用方。
   */
  public static async autoDetectROI(
    filePath: string,
    timestamp: number,
    videoWidth: number,
    videoHeight: number,
  ): Promise<DetectedROI> {
    if (!this.isTauriEnv()) throw new Error('自动定位选区仅在桌面版中可用')
    if (!videoWidth || !videoHeight) {
      throw new Error('视频尺寸未知，请等待视频加载完成后再自动定位')
    }

    const raw = await invoke<RawDetectedROI>('auto_detect_roi', {
      videoPath: filePath,
      timestamp,
      videoWidth,
      videoHeight,
    })

    const normalize = (value: number) => Number(Math.min(1, Math.max(0, value / 100)).toFixed(4))
    return {
      x: normalize(raw.x),
      y: normalize(raw.y),
      width: normalize(raw.width),
      height: normalize(raw.height),
      confidence: raw.confidence,
    }
  }

  /** 原生 ONNX OCR 识别（仅桌面端可用） */
  public static async ocrRecognizeNative(
    imagePath: string,
    lang = 'ch',
    engine = 'native',
  ): Promise<NativeOCRResult[] | null> {
    if (!this.isTauriEnv()) return null
    return await invoke<NativeOCRResult[]>('ocr_recognize', { imagePath, lang, engine })
  }

  /**
   * 通过原生保存对话框写入字幕文件。
   * @returns 保存成功的绝对路径；用户取消时返回 null
   * @throws 写入失败时抛出可读错误，调用方需据此提示失败而非「已导出」
   */
  public static async saveSubtitlesDialog(
    content: string,
    defaultName: string,
    format: string = 'srt',
  ): Promise<string | null> {
    if (!this.isTauriEnv()) throw new Error('当前环境不支持原生保存，请使用浏览器下载')

    const normalized = format.toLowerCase()
    const primary = EXPORT_FILTERS[normalized] ?? EXPORT_FILTERS.txt
    const filters = [primary, ...Object.values(EXPORT_FILTERS).filter((f) => f !== primary)]

    let path: string | null
    try {
      path = await save({ defaultPath: defaultName, filters })
    } catch (error) {
      throw new Error(
        `打开保存对话框失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }

    if (!path) return null

    try {
      await invoke('write_text_file', { path, content })
      return path
    } catch (error) {
      throw new Error(
        `写入字幕文件失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  /** 检查本地原生 ONNX 模型是否已就绪 */
  public static async checkNativeOcrReady(): Promise<NativeOcrStatus | null> {
    if (!this.isTauriEnv()) return null
    return await invoke<NativeOcrStatus>('check_native_ocr_ready')
  }

  /** 取消正在运行的原生提取任务 */
  public static async cancelNativePipeline(taskId: string): Promise<void> {
    if (!this.isTauriEnv()) return
    await invoke('cancel_native_pipeline', { taskId })
  }

  /** 一键下载并就绪缺失的原生 ONNX OCR 模型 */
  public static async downloadNativeOcrModels(
    onProgress?: (payload: { modelName: string; status: string; percent: number; error?: string }) => void,
  ): Promise<NativeOcrStatus> {
    if (!this.isTauriEnv()) {
      return { ready: false, detExists: false, recExists: false, modelDir: '' }
    }

    let unlisten: UnlistenFn | null = null
    if (onProgress) {
      unlisten = await listen<{ modelName: string; status: string; percent: number; error?: string }>(
        'vidglyph://model-download-progress',
        (event) => onProgress(event.payload),
      )
    }

    try {
      return await invoke<NativeOcrStatus>('download_native_ocr_models')
    } finally {
      if (unlisten) unlisten()
    }
  }

  /**
   * 启动原生高性能流式提取管道。
   * 通过 Tauri Event 实时推送抽帧进度、检测出的字幕项与结束事件。
   */
  public static async startNativePipeline(
    request: NativePipelineRequest,
    callbacks: {
      onProgress?: (progress: PipelineProgressPayload) => void
      onSubtitle?: (subtitle: PipelineSubtitlePayload) => void
      onFinished?: (finished: PipelineFinishedPayload) => void
    } = {},
  ): Promise<{ taskId: string; unlisten: () => void }> {
    if (!this.isTauriEnv()) {
      throw new Error('原生提取管道仅在 Tauri 客户端容器中可用')
    }

    const unlistens: UnlistenFn[] = []

    if (callbacks.onProgress) {
      const u = await listen<PipelineProgressPayload>('vidglyph://pipeline-progress', (event) => {
        if (!request.taskId || event.payload.taskId === request.taskId) {
          callbacks.onProgress?.(event.payload)
        }
      })
      unlistens.push(u)
    }

    if (callbacks.onSubtitle) {
      const u = await listen<PipelineSubtitlePayload>('vidglyph://pipeline-subtitle', (event) => {
        if (!request.taskId || event.payload.taskId === request.taskId) {
          callbacks.onSubtitle?.(event.payload)
        }
      })
      unlistens.push(u)
    }

    if (callbacks.onFinished) {
      const u = await listen<PipelineFinishedPayload>('vidglyph://pipeline-finished', (event) => {
        if (!request.taskId || event.payload.taskId === request.taskId) {
          callbacks.onFinished?.(event.payload)
        }
      })
      unlistens.push(u)
    }

    const cleanup = () => {
      for (const u of unlistens) {
        try {
          u()
        } catch {
          // ignore
        }
      }
      unlistens.length = 0
    }

    try {
      const taskId = await invoke<string>('start_native_pipeline', { request })
      return { taskId, unlisten: cleanup }
    } catch (err) {
      cleanup()
      throw err
    }
  }

  // ─── OS 安全凭据与密钥环 ────────────────────────────────────────────────

  /** 保存敏感 API 凭据到操作系统原生密钥环（macOS Keychain / 加密保险库） */
  public static async saveSecureCredential(service: string, account: string, secret: string): Promise<void> {
    if (!this.isTauriEnv()) return
    await invoke('save_secure_credential', { service, account, secret })
  }

  /** 从操作系统原生密钥环读取凭据 */
  public static async getSecureCredential(service: string, account: string): Promise<string | null> {
    if (!this.isTauriEnv()) return null
    return await invoke<string | null>('get_secure_credential', { service, account })
  }

  /** 从操作系统原生密钥环抹除凭据 */
  public static async deleteSecureCredential(service: string, account: string): Promise<void> {
    if (!this.isTauriEnv()) return
    await invoke('delete_secure_credential', { service, account })
  }

  // ─── SQLite 本地工程与任务持久化 ──────────────────────────────────────────

  /** 保存或更新完整项目及其字幕集合（事务级原子落盘） */
  public static async dbSaveProject(project: ProjectRecord, subtitles: SubtitleRecord[]): Promise<string> {
    if (!this.isTauriEnv()) throw new Error('SQLite 本地持久化仅在桌面客户端支持')
    return await invoke<string>('db_save_project', { project, subtitles })
  }

  /** 读取项目详情及其全部字幕条目 */
  public static async dbLoadProject(projectId: string): Promise<ProjectDetail | null> {
    if (!this.isTauriEnv()) return null
    return await invoke<ProjectDetail | null>('db_load_project', { projectId })
  }

  /** 获取所有已保存的项目列表概要 */
  public static async dbListProjects(): Promise<ProjectRecord[]> {
    if (!this.isTauriEnv()) return []
    return await invoke<ProjectRecord[]>('db_list_projects')
  }

  /** 删除项目及其所有关联字幕 */
  public static async dbDeleteProject(projectId: string): Promise<void> {
    if (!this.isTauriEnv()) return
    await invoke('db_delete_project', { projectId })
  }

  /** 保存或更新批处理任务记录 */
  public static async dbSaveBatchTask(task: BatchTaskRecord): Promise<void> {
    if (!this.isTauriEnv()) return
    await invoke('db_save_batch_task', { task })
  }

  /** 查询所有批处理任务列表 */
  public static async dbListBatchTasks(): Promise<BatchTaskRecord[]> {
    if (!this.isTauriEnv()) return []
    return await invoke<BatchTaskRecord[]>('db_list_batch_tasks')
  }

  /** 导出独立 .vidglyph 工程包 */
  public static async exportProjectBundle(projectId: string, outputPath: string): Promise<string> {
    if (!this.isTauriEnv()) throw new Error('工程导出仅在桌面客户端支持')
    return await invoke<string>('export_project_bundle', { projectId, outputPath })
  }

  /** 导入 .vidglyph 工程包并载入数据库 */
  public static async importProjectBundle(bundlePath: string): Promise<ProjectDetail> {
    if (!this.isTauriEnv()) throw new Error('工程导入仅在桌面客户端支持')
    return await invoke<ProjectDetail>('import_project_bundle', { bundlePath })
  }
}


