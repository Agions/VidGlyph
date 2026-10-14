/**
 * @file subtitleStore.ts
 * @description 字幕列表、视频处理进度、模式切换与 ROI 选区全局状态 Store。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { OCRItem, NormalizedROI } from '../services';

export const useSubtitleStore = defineStore('subtitle', () => {
  // 当前模式: 'local' (离线硬字幕) | 'cloud' (API Key)
  const ocrMode = ref<'local' | 'cloud'>('local');

  // ROI 框选激活显示状态
  const isRoiActive = ref<boolean>(true);
  
  // 提取视频相关属性
  const videoUrl = ref<string>('');
  const videoPath = ref<string>('');
  const videoPoster = ref<string>('');
  const videoFileName = ref<string>('');
  const videoDuration = ref<number>(0);
  const videoWidth = ref<number>(0);
  const videoHeight = ref<number>(0);
  const currentTime = ref<number>(0);

  // 图像选区 ROI (0.0 ~ 1.0 归一化比例)
  const roi = ref<NormalizedROI>({
    x: 0.12,
    y: 0.72,
    width: 0.76,
    height: 0.18,
  });

  // 处理状态
  const isExtracting = ref<boolean>(false);
  const progressPercent = ref<number>(0);

  // 提取字幕列表结果
  const subtitles = ref<OCRItem[]>([]);

  // 选中的字幕 ID
  const selectedSubtitleId = ref<string | null>(null);

  /** 添加新的字幕条目并自动去重/融合 */
  function addSubtitles(items: OCRItem[]) {
    for (const item of items) {
      if (!item.text || item.text.trim().length === 0) continue;
      
      // 去重：如果上一条文本相同，扩展结束时间
      const last = subtitles.value[subtitles.value.length - 1];
      if (last && last.text.trim() === item.text.trim() && Math.abs(item.startTime - last.endTime) < 2000) {
        last.endTime = item.endTime;
        last.confidence = Math.max(last.confidence, item.confidence);
      } else {
        subtitles.value.push(item);
      }
    }
  }

  /** 更新某条字幕文本 */
  function updateSubtitleText(id: string, newText: string) {
    const target = subtitles.value.find((s) => s.id === id);
    if (target) {
      target.text = newText;
    }
  }

  /** 删除某条字幕 */
  function removeSubtitle(id: string) {
    subtitles.value = subtitles.value.filter((s) => s.id !== id);
  }

  /** 清空当前字幕列表 */
  function clearSubtitles() {
    subtitles.value = [];
    progressPercent.value = 0;
  }

  /** 更新 ROI 选区 */
  function setROI(newRoi: NormalizedROI) {
    roi.value = { ...newRoi };
  }

  const subtitleCount = computed(() => subtitles.value.length);

  const storeObj = {
    ocrMode,
    isRoiActive,
    videoUrl,
    videoPath,
    videoPoster,
    videoFileName,
    videoDuration,
    videoWidth,
    videoHeight,
    currentTime,
    roi,
    isExtracting,
    progressPercent,
    subtitles,
    selectedSubtitleId,
    subtitleCount,
    addSubtitles,
    updateSubtitleText,
    removeSubtitle,
    clearSubtitles,
    setROI,
  };

  // 仅开发环境暴露调试句柄，生产构建不再挂载全局对象
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as Window & { __subtitleStore?: typeof storeObj }).__subtitleStore = storeObj;
  }

  return storeObj;
});
