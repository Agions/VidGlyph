/**
 * @file useWorkspaceVideoImport.ts
 * @description 工作区视频导入：所有入口（点击选择 / 拖拽 / 原生对话框）共用同一套
 * 校验与状态重置逻辑，避免出现「某些入口未清理旧字幕」的不一致。
 */

import { useNotification } from '@/composables/useNotification'
import { TauriBridge } from '@/services'
import { useSubtitleStore } from '@/stores'
import { logger } from '@/utils/logger'

/** 支持导入的视频扩展名（与 Rust 文件对话框过滤器保持一致） */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', 'wmv', '3gp',
] as const

const VIDEO_EXTENSION_PATTERN = new RegExp(
  `\\.(${SUPPORTED_VIDEO_EXTENSIONS.join('|')})$`,
  'i',
)

/** 单个视频文件体积上限（8GB），超大文件在浏览器解码阶段几乎必然失败 */
export const MAX_VIDEO_FILE_SIZE = 8 * 1024 * 1024 * 1024

export interface VideoValidation {
  ok: boolean
  reason?: string
}

/** 仅按名称 / MIME 判断是否可能为视频（兼容旧调用方） */
export function isSupportedVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSION_PATTERN.test(file.name)
}

/** 完整校验：类型 + 体积 + 空文件 */
export function validateVideoFile(file: Pick<File, 'name' | 'type' | 'size'>): VideoValidation {
  if (!isSupportedVideoFile(file)) {
    return { ok: false, reason: `不支持的文件格式，请选择 ${SUPPORTED_VIDEO_EXTENSIONS.join(' / ')} 视频` }
  }
  if (file.size === 0) {
    return { ok: false, reason: '文件内容为空，可能尚未完成复制或已损坏' }
  }
  if (file.size > MAX_VIDEO_FILE_SIZE) {
    return { ok: false, reason: '文件体积超过 8GB，请先压缩或切分后再导入' }
  }
  return { ok: true }
}

/** 校验路径形式的视频（原生对话框返回值） */
export function validateVideoPath(path: string): VideoValidation {
  if (!path.trim()) return { ok: false, reason: '未获取到有效的文件路径' }
  if (!VIDEO_EXTENSION_PATTERN.test(path)) {
    return { ok: false, reason: `不支持的文件格式，请选择 ${SUPPORTED_VIDEO_EXTENSIONS.join(' / ')} 视频` }
  }
  return { ok: true }
}

export function useWorkspaceVideoImport() {
  const subtitleStore = useSubtitleStore()
  const notifications = useNotification()

  /** 清理上一段视频的会话状态，保证工作区只有一个事实来源 */
  function resetWorkspace(next: { url: string; path: string; fileName: string }) {
    if (subtitleStore.videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(subtitleStore.videoUrl)
    }
    subtitleStore.videoUrl = next.url
    subtitleStore.videoPath = next.path
    subtitleStore.videoPoster = ''
    subtitleStore.videoFileName = next.fileName
    subtitleStore.videoDuration = 0
    subtitleStore.videoWidth = 0
    subtitleStore.videoHeight = 0
    subtitleStore.currentTime = 0
    subtitleStore.clearSubtitles()
    subtitleStore.isRoiActive = true
  }

  function importVideoFile(file: File): boolean {
    if (subtitleStore.isExtracting) {
      notifications.warn('正在提取字幕，请先停止当前任务再导入新视频')
      return false
    }

    const validation = validateVideoFile(file)
    if (!validation.ok) {
      notifications.warn(validation.reason ?? '无法导入该文件')
      return false
    }

    resetWorkspace({ url: URL.createObjectURL(file), path: '', fileName: file.name })
    notifications.success(`已导入 ${file.name}`)
    return true
  }

  function importVideoPath(path: string): boolean {
    if (subtitleStore.isExtracting) {
      notifications.warn('正在提取字幕，请先停止当前任务再导入新视频')
      return false
    }

    const validation = validateVideoPath(path)
    if (!validation.ok) {
      notifications.warn(validation.reason ?? '无法导入该文件')
      return false
    }

    const fileName = path.split(/[\\/]/).pop() || path
    resetWorkspace({ url: TauriBridge.convertPathToAssetUrl(path), path, fileName })
    notifications.success(`已导入 ${fileName}`)
    logger.debug('VideoImport', `导入原生视频 ${path}`)
    return true
  }

  return { importVideoFile, importVideoPath }
}
