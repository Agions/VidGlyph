/**
 * @file useAutoRoi.ts
 * @description 自动定位字幕选区。
 *
 * 策略（按优先级）：
 * 1. 桌面端原生检测：`TauriBridge.autoDetectROI`（Rust 边缘轮廓分析，精度更高）；
 * 2. 本地兜底：抓取当前帧像素，交由 `detectSubtitleBand` 纯算法分析。
 *
 * 两条路径都会做几何校验，只有得到合法选区才写回工作区，避免出现「空选区」把提取结果清空。
 */

import { ref } from 'vue'
import { detectSubtitleBand } from '@/core'
import type { NormalizedROI } from '@/services/ocr/IOCREngine'
import { TauriBridge } from '@/services'
import { logger } from '@/utils/logger'
import { useNotification } from './useNotification'

export type AutoRoiSource = 'native' | 'heuristic'

export interface AutoRoiOutcome {
  roi: NormalizedROI
  confidence: number
  source: AutoRoiSource
}

export interface AutoRoiRequest {
  videoElement: HTMLVideoElement | null
  /** 本地文件路径；为空时无法调用原生检测 */
  videoPath: string
  /** 取帧时间点（秒） */
  timestamp: number
}

const MIN_ROI_SIDE = 0.01

/** 归一化选区几何校验：必须在 0~1 内且有有效面积 */
export function isUsableRoi(roi: NormalizedROI | null | undefined): roi is NormalizedROI {
  if (!roi) return false
  const values = [roi.x, roi.y, roi.width, roi.height]
  if (values.some((value) => !Number.isFinite(value))) return false
  if (roi.x < 0 || roi.y < 0) return false
  if (roi.width < MIN_ROI_SIDE || roi.height < MIN_ROI_SIDE) return false
  if (roi.x + roi.width > 1.001 || roi.y + roi.height > 1.001) return false
  return true
}

export function useAutoRoi() {
  const isDetecting = ref(false)
  const notifications = useNotification()

  /** 抓取当前视频帧的像素数据 */
  function captureFrameData(videoElement: HTMLVideoElement): ImageData | null {
    const width = videoElement.videoWidth
    const height = videoElement.videoHeight
    if (!width || !height) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return null

    ctx.drawImage(videoElement, 0, 0, width, height)
    return ctx.getImageData(0, 0, width, height)
  }

  async function detect(request: AutoRoiRequest): Promise<AutoRoiOutcome | null> {
    const { videoElement, videoPath, timestamp } = request
    if (!videoElement) {
      notifications.warn('请先导入视频后再自动定位字幕区域')
      return null
    }

    isDetecting.value = true
    try {
      if (videoPath && TauriBridge.isTauriEnv()) {
        try {
          const detected = await TauriBridge.autoDetectROI(
            videoPath,
            timestamp,
            videoElement.videoWidth,
            videoElement.videoHeight,
          )
          const roi: NormalizedROI = {
            x: detected.x,
            y: detected.y,
            width: detected.width,
            height: detected.height,
          }
          if (isUsableRoi(roi)) {
            return { roi, confidence: detected.confidence, source: 'native' }
          }
          logger.warn('AutoRoi', '原生检测返回的选区不合法，回退本地算法', detected)
        } catch (error) {
          logger.warn('AutoRoi', '原生检测不可用，回退本地算法', error)
        }
      }

      const frameData = captureFrameData(videoElement)
      if (!frameData) {
        notifications.warn('无法读取视频画面，请确认视频已完成加载')
        return null
      }

      const detection = detectSubtitleBand(frameData)
      if (!detection || !isUsableRoi(detection.roi)) {
        notifications.warn('未在当前画面中识别到明显字幕区域，请手动框选')
        return null
      }

      return { roi: detection.roi, confidence: detection.confidence, source: 'heuristic' }
    } finally {
      isDetecting.value = false
    }
  }

  return { isDetecting, detect }
}
