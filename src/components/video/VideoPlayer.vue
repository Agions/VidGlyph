<template>
  <div class="relative flex flex-col w-full h-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
    <!-- 顶部视频标尺 / 文件名信息 -->
    <div class="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-300">
      <div class="flex items-center gap-2 font-mono">
        <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <span class="truncate max-w-md text-emerald-200 font-semibold">{{ subtitleStore.videoFileName || '未导入视频文件' }}</span>
      </div>

      <div class="flex items-center gap-4 text-slate-400 font-mono">
        <span>当前时间: <strong class="text-white">{{ formattedCurrentTime }}</strong></span>
        <span>总时长: <strong class="text-white">{{ formattedDuration }}</strong></span>
      </div>
    </div>

    <!-- 视频预览区 & 拖拽放置 & ROI Overlay 覆盖层 -->
    <div
      class="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
      @dragover.prevent
      @drop.prevent="onDropVideo"
    >
      <!-- 视频未导入占位提示框 -->
      <div v-if="!subtitleStore.videoUrl && !subtitleStore.videoPoster" class="flex flex-col items-center justify-center text-slate-400 gap-4 p-8 text-center select-none">
        <div class="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 shadow-inner">
          <svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div>
          <p class="text-base font-medium text-slate-200">拖拽视频文件至此处，或点击顶部“导入视频”</p>
          <p class="text-xs text-slate-500 mt-1">支持 MP4, MKV, AVI, MOV, WebM 等主流影视格式</p>
        </div>
      </div>

      <!-- Poster Backdrop 画面渲染层 (优先渲染海报/帧图像) -->
      <img
        v-if="subtitleStore.videoPoster"
        :src="subtitleStore.videoPoster"
        class="max-w-full max-h-full object-contain select-none"
        alt="Video Preview Frame"
      />

      <!-- 真实视频 HTML5 video 元素 -->
      <video
        v-else-if="subtitleStore.videoUrl"
        ref="videoRef"
        :src="subtitleStore.videoUrl"
        preload="auto"
        controls
        class="max-w-full max-h-full object-contain"
        @loadedmetadata="onVideoLoaded"
        @timeupdate="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @error="onVideoError"
      ></video>

      <!-- ROI 选区交互 Canvas 层 (在视频/海报加载后且选择区域开关联动显示) -->
      <VideoCanvasOverlay v-if="(subtitleStore.videoUrl || subtitleStore.videoPoster) && subtitleStore.isRoiActive" class="absolute inset-0 z-20 pointer-events-auto" />
    </div>

    <!-- 底部视频控制栏 -->
    <div v-if="subtitleStore.videoUrl || subtitleStore.videoPoster" class="px-4 py-3 bg-slate-900 border-t border-slate-800 flex flex-col gap-2">
      <!-- 进度条 -->
      <input
        type="range"
        min="0"
        :max="subtitleStore.videoDuration || 100"
        step="0.1"
        :value="subtitleStore.currentTime"
        class="w-full h-1.5 bg-slate-800 accent-emerald-500 rounded-lg cursor-pointer"
        @input="onSeek"
      />

      <!-- 播放/暂停/快进控制按键 -->
      <div class="flex items-center justify-between pt-1">
        <div class="flex items-center gap-3">
          <button
            class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 transition cursor-pointer"
            @click="togglePlay"
          >
            <svg v-if="!isPlaying" class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg v-else class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>

          <span class="text-xs font-mono text-slate-300">
            {{ formattedCurrentTime }} / {{ formattedDuration }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-1 rounded">
            模式: {{ subtitleStore.ocrMode === 'cloud' ? '云端 API OCR' : '本地离线硬字幕' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSubtitleStore } from '../../stores';
import VideoCanvasOverlay from './VideoCanvasOverlay.vue';
import { TimecodeConverter } from '../../utils/TimecodeConverter';
import { useWorkspaceVideoImport } from '../../composables/useWorkspaceVideoImport';

const subtitleStore = useSubtitleStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const { importVideoFile } = useWorkspaceVideoImport();

const formattedCurrentTime = computed(() =>
  TimecodeConverter.msToSRT(subtitleStore.currentTime * 1000).split(',')[0]
);

const formattedDuration = computed(() =>
  TimecodeConverter.msToSRT(subtitleStore.videoDuration * 1000).split(',')[0]
);

function onVideoLoaded() {
  if (videoRef.value) {
    subtitleStore.videoDuration = videoRef.value.duration || 0;
    subtitleStore.videoWidth = videoRef.value.videoWidth || 0;
    subtitleStore.videoHeight = videoRef.value.videoHeight || 0;
  }
}

function onTimeUpdate() {
  if (videoRef.value) {
    subtitleStore.currentTime = videoRef.value.currentTime;
  }
}

function onVideoError(e: Event) {
  console.warn('Video 元素视频加载异常:', e);
}

function onDropVideo(e: DragEvent) {
  const file = e.dataTransfer?.files[0];
  if (file) importVideoFile(file);
}

function togglePlay() {
  if (videoRef.value) {
    if (isPlaying.value) {
      videoRef.value.pause();
    } else {
      videoRef.value.play();
    }
  }
}

function onSeek(e: Event) {
  const target = e.target as HTMLInputElement;
  const val = parseFloat(target.value);
  if (videoRef.value) {
    videoRef.value.currentTime = val;
    subtitleStore.currentTime = val;
  }
}

// 暴露获取当前 Canvas 帧供 OCR Engine 使用
defineExpose({
  getCurrentFrameCanvas(): HTMLCanvasElement | null {
    if (!videoRef.value || videoRef.value.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.value.videoWidth || 1280;
    canvas.height = videoRef.value.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(videoRef.value, 0, 0, canvas.width, canvas.height);
    return canvas;
  },
  getVideoElement(): HTMLVideoElement | null {
    return videoRef.value;
  }
});
</script>
