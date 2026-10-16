/**
 * @file useWorkspaceController.ts
 * @description 工作区编排层：把领域用例（提取管道）与状态层、通知层装配起来。
 *
 * 职责边界：本层只做「协调 + 反馈」，不承载算法与格式逻辑。
 * 提取参数统一来自 `useExtractionSettingsStore`，不再在调用处硬编码。
 */

import { onMounted, ref } from 'vue'
import { PipelineEngine, validateExtractionOptions } from '@/core'
import { useNotification } from '@/composables/useNotification'
import { useExtractionSettingsStore, useSecurityStore, useSubtitleStore } from '@/stores'
import { OCREngineFactory, UpdaterService, type UpdateInfo } from '@/services'
import type { NormalizedROI } from '@/services/ocr/IOCREngine'
import { logger } from '@/utils/logger'

export function useWorkspaceController() {
  const subtitleStore = useSubtitleStore()
  const securityStore = useSecurityStore()
  const extractionSettings = useExtractionSettingsStore()
  const notifications = useNotification()

  const pipeline = new PipelineEngine(
    {
      getConfig: () => ({
        mode: subtitleStore.ocrMode,
        language: extractionSettings.options.language,
        apiKey: securityStore.apiKey,
        cloudEndpoint: securityStore.cloudEndpoint,
        preprocessDenoise: extractionSettings.options.preprocessDenoise,
      }),
      getExtractionOptions: () => extractionSettings.options,
      getVideoPath: () => subtitleStore.videoPath || null,
      setExtracting: (extracting) => { subtitleStore.isExtracting = extracting },
      setProgress: (percent) => { subtitleStore.progressPercent = percent },
      addSubtitles: (items) => subtitleStore.addSubtitles(items),
    },
    OCREngineFactory,
  )

  const isSettingsOpen = ref(false)
  const isUpdateOpen = ref(false)
  const currentUpdateInfo = ref<UpdateInfo | null>(null)

  async function startExtraction(videoElement: HTMLVideoElement | null, roi: NormalizedROI) {
    if (!videoElement || !subtitleStore.videoUrl) {
      notifications.warn('请先导入视频文件')
      return
    }
    const videoDuration =
      Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : null
    const validation = validateExtractionOptions(extractionSettings.options, videoDuration)
    if (!validation.valid) {
      notifications.error(validation.errors[0])
      isSettingsOpen.value = true
      return
    }
    if (validation.warnings.length > 0) {
      notifications.info(validation.warnings[0])
    }
    if (subtitleStore.isExtracting) {
      notifications.warn('已有提取任务正在进行')
      return
    }

    try {
      const result = await pipeline.startExtraction(videoElement, roi)
      const summary = pipeline.getLastRunSummary()

      if (result === 'cancelled') {
        notifications.info('提取已停止，已保留当前识别结果')
        return
      }
      if (subtitleStore.subtitleCount > 0) {
        const detail = summary ? `（采样 ${summary.framesProcessed} 帧）` : ''
        notifications.success(`提取完成，识别到 ${subtitleStore.subtitleCount} 条字幕${detail}`)
      } else {
        notifications.info('提取完成，但未识别到字幕，请调整 ROI、识别语言或采样间隔')
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Workspace', '提取失败', error)
      notifications.error(message)
      if (message.includes('API Key')) isSettingsOpen.value = true
    }
  }

  function cancelExtraction() {
    pipeline.cancel()
    notifications.info('已请求停止提取，当前帧处理完成后生效')
  }

  function handleUpdateFound(info: UpdateInfo) {
    currentUpdateInfo.value = info
    isUpdateOpen.value = true
  }

  function loadDemoPresentationData() {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      notifications.error('无法创建演示画布')
      return
    }
    const gradient = ctx.createLinearGradient(0, 0, 1280, 720)
    gradient.addColorStop(0, '#0f172a')
    gradient.addColorStop(0.4, '#1e293b')
    gradient.addColorStop(0.8, '#090d16')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = '#334155'
    ctx.beginPath()
    ctx.arc(640, 260, 180, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.ellipse(640, 480, 480, 160, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = 'bold 38px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.lineWidth = 6
    ctx.strokeStyle = '#000000'
    ctx.strokeText('欢迎使用 VidGlyph · 字映 智能硬字幕提取工坊', 640, 620)
    ctx.fillStyle = '#ffffff'
    ctx.fillText('欢迎使用 VidGlyph · 字映 智能硬字幕提取工坊', 640, 620)

    const dataUrl = canvas.toDataURL('image/png')
    subtitleStore.videoUrl = dataUrl
    subtitleStore.videoPath = ''
    subtitleStore.videoPoster = dataUrl
    subtitleStore.videoFileName = 'VidGlyph_Demo_4K_Movie.mp4'
    subtitleStore.videoDuration = 185.5
    subtitleStore.videoWidth = 1280
    subtitleStore.videoHeight = 720
    subtitleStore.currentTime = 14.2
    subtitleStore.isRoiActive = true
    subtitleStore.setROI({ x: 0.1, y: 0.7, width: 0.8, height: 0.2 })
    subtitleStore.subtitles = [
      { id: 'sub_1', startTime: 3200, endTime: 6800, text: '欢迎使用 VidGlyph · 字映 智能硬字幕提取工坊', confidence: 98 },
      { id: 'sub_2', startTime: 7200, endTime: 11500, text: '自动识别视频硬字幕区域与多语言文本', confidence: 96 },
      { id: 'sub_3', startTime: 12000, endTime: 16800, text: '支持 AI 错别字校对与多格式字幕实时导出', confidence: 95 },
    ]
  }

  onMounted(async () => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') loadDemoPresentationData()
    try {
      const info = await UpdaterService.check()
      if (info.available) handleUpdateFound(info)
    } catch {
      // 更新检查是可选能力，失败不得打断编辑工作流
    }
  })

  return {
    isSettingsOpen,
    isUpdateOpen,
    currentUpdateInfo,
    startExtraction,
    cancelExtraction,
    handleUpdateFound,
  }
}
