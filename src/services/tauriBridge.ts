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
}
