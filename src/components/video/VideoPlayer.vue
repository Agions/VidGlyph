<template>
  <div
    ref="playerContainerRef"
    class="relative flex flex-col w-full h-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 shadow-2xl transition-all"
  >
    <!-- 顶部视频标尺 / 文件名信息与快速属性栏 -->
    <div class="flex items-center justify-between px-4 py-2 bg-slate-900/90 backdrop-blur border-b border-slate-800/80 text-xs text-slate-300 select-none">
      <div class="flex items-center gap-2.5 font-mono">
        <span class="flex h-2 w-2 relative">
          <span v-if="subtitleStore.videoUrl || subtitleStore.videoPoster" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2" :class="subtitleStore.videoUrl || subtitleStore.videoPoster ? 'bg-emerald-500' : 'bg-slate-600'"></span>
        </span>
        <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <span class="truncate max-w-xs md:max-w-md text-emerald-200 font-semibold tracking-wide" :title="subtitleStore.videoFileName">
          {{ subtitleStore.videoFileName || '未加载视频源' }}
        </span>
        <span v-if="subtitleStore.videoWidth > 0" class="text-[10px] text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 font-mono">
          {{ subtitleStore.videoWidth }}×{{ subtitleStore.videoHeight }}
        </span>
      </div>

      <div class="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
        <span class="hidden sm:inline text-slate-500">当前 / 总长:</span>
        <span class="text-slate-200 font-bold bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
          <span class="text-emerald-400">{{ formattedCurrentTime }}</span>
          <span class="text-slate-600 mx-1">/</span>
          <span>{{ formattedDuration }}</span>
        </span>
      </div>
    </div>

    <!-- 视频预览区 & 拖拽放置 & ROI Overlay 覆盖层 -->
    <div
      class="relative flex-1 bg-black/95 flex items-center justify-center overflow-hidden"
      :class="{ 'ring-2 ring-emerald-500/50 bg-emerald-950/10': isDraggingOver }"
      @dragover.prevent="isDraggingOver = true"
      @dragleave.prevent="isDraggingOver = false"
      @drop.prevent="onDropVideo"
    >
      <!-- 视频未导入专业 Dark Studio 占位提示框 -->
      <div
        v-if="!subtitleStore.videoUrl && !subtitleStore.videoPoster"
        class="flex flex-col items-center justify-center text-slate-400 gap-5 p-8 text-center select-none w-full max-w-lg cursor-pointer group"
        @click="triggerFileInput"
      >
        <div class="relative w-24 h-24 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 group-hover:border-emerald-500/60 flex items-center justify-center shadow-xl group-hover:shadow-emerald-500/10 transition-all duration-300">
          <!-- 装饰四角十字准心 -->
          <div class="absolute -top-1.5 -left-1.5 w-3 h-3 border-t-2 border-l-2 border-emerald-500/40 rounded-tl"></div>
          <div class="absolute -top-1.5 -right-1.5 w-3 h-3 border-t-2 border-r-2 border-emerald-500/40 rounded-tr"></div>
          <div class="absolute -bottom-1.5 -left-1.5 w-3 h-3 border-b-2 border-l-2 border-emerald-500/40 rounded-bl"></div>
          <div class="absolute -bottom-1.5 -right-1.5 w-3 h-3 border-b-2 border-r-2 border-emerald-500/40 rounded-br"></div>

          <svg class="w-11 h-11 text-emerald-400/80 group-hover:text-emerald-400 group-hover:scale-105 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium text-slate-200 group-hover:text-emerald-300 transition-colors">
            拖拽视频文件至此处，或点击浏览本地文件
          </p>
          <p class="text-xs text-slate-500">
            支持无损本地解码，数据不出本机，保障隐私与版权安全
          </p>
        </div>

        <!-- 格式胶囊矩阵 -->
        <div class="flex flex-wrap items-center justify-center gap-1.5 pt-1">
          <span
            v-for="ext in ['MP4', 'MKV', 'MOV', 'WebM', 'TS', 'FLV', 'AVI']"
            :key="ext"
            class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 group-hover:border-slate-700 transition"
          >
            {{ ext }}
          </span>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="video/*,.mp4,.mkv,.avi,.mov,.webm,.flv,.m4v,.wmv,.3gp"
          class="hidden"
          @change="onFileInputChange"
        />
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
        class="max-w-full max-h-full object-contain"
        @loadedmetadata="onVideoLoaded"
        @timeupdate="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
        @error="onVideoError"
      ></video>

      <!-- ROI 选区交互 Canvas 层 (在视频/海报加载后且选择区域开关联动显示) -->
      <VideoCanvasOverlay
        v-if="(subtitleStore.videoUrl || subtitleStore.videoPoster) && subtitleStore.isRoiActive"
        class="absolute inset-0 z-20 pointer-events-auto"
      />
    </div>

    <!-- 底部视频控制栏与多轨时间轴 -->
    <div
      v-if="subtitleStore.videoUrl || subtitleStore.videoPoster"
      class="px-4 py-3 bg-slate-900/95 backdrop-blur border-t border-slate-800/80 flex flex-col gap-2.5"
    >
      <!-- 多轨音频波形与字幕时间轴轨道 -->
      <WaveformTimeline />

      <!-- 主进度滑块 -->
      <div class="relative flex items-center group">
        <input
          type="range"
          min="0"
          :max="subtitleStore.videoDuration || 100"
          step="0.05"
          :value="subtitleStore.currentTime"
          class="w-full h-1.5 bg-slate-800 accent-emerald-500 rounded-lg cursor-pointer transition-all hover:h-2"
          @input="onSeek"
        />
      </div>

      <!-- 播放/暂停/跳步/倍速/音量等控制按键组合 -->
      <div class="flex items-center justify-between pt-0.5">
        <!-- 左侧：播放、步进、时间码 -->
        <div class="flex items-center gap-2 sm:gap-3">
          <!-- 播放/暂停按键 -->
          <button
            class="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition cursor-pointer active:scale-95"
            :title="isPlaying ? '暂停 (Space)' : '播放 (Space)'"
            @click="togglePlay"
          >
            <svg v-if="!isPlaying" class="w-4 h-4 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            <svg v-else class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>

          <!-- 后退 5 秒 -->
          <button
            class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            title="后退 5 秒"
            @click="seekRelative(-5)"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
            </svg>
          </button>

          <!-- 前进 5 秒 -->
          <button
            class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            title="前进 5 秒"
            @click="seekRelative(5)"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
            </svg>
          </button>

          <span class="text-xs font-mono text-slate-300 tracking-tight">
            {{ formattedCurrentTime }} <span class="text-slate-600">/</span> {{ formattedDuration }}
          </span>
        </div>

        <!-- 右侧：倍速、静音、全屏与模式胶囊 -->
        <div class="flex items-center gap-2">
          <!-- 播放倍速切换 -->
          <div class="relative flex items-center">
            <button
              class="px-2 py-1 text-[11px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition cursor-pointer"
              title="切换播放倍速"
              @click="cyclePlaybackRate"
            >
              {{ playbackRate }}x
            </button>
          </div>

          <!-- 静音 / 音量切换 -->
          <button
            class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            :title="isMuted ? '取消静音' : '静音'"
            @click="toggleMute"
          >
            <svg v-if="!isMuted" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <svg v-else class="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          </button>

          <!-- 模式徽标 -->
          <div class="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-slate-950/80 border border-slate-800 text-[11px] font-mono">
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="subtitleStore.ocrMode === 'cloud' ? 'bg-cyan-400' : 'bg-emerald-400'"
            ></span>
            <span :class="subtitleStore.ocrMode === 'cloud' ? 'text-cyan-300' : 'text-emerald-300'">
              {{ subtitleStore.ocrMode === 'cloud' ? '云端 OCR' : '本地离线' }}
            </span>
          </div>

          <!-- 全屏切换 -->
          <button
            class="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            title="全屏预览"
            @click="toggleFullscreen"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSubtitleStore } from '../../stores';
import VideoCanvasOverlay from './VideoCanvasOverlay.vue';
import WaveformTimeline from './WaveformTimeline.vue';
import { TimecodeConverter } from '../../utils/TimecodeConverter';
import { useWorkspaceVideoImport } from '../../composables/useWorkspaceVideoImport';

const subtitleStore = useSubtitleStore();
const videoRef = ref<HTMLVideoElement | null>(null);
const playerContainerRef = ref<HTMLDivElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isPlaying = ref(false);
const isDraggingOver = ref(false);
const isMuted = ref(false);
const playbackRate = ref(1.0);
const { importVideoFile } = useWorkspaceVideoImport();

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

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
    videoRef.value.playbackRate = playbackRate.value;
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
  isDraggingOver.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) importVideoFile(file);
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

function onFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    importVideoFile(file);
    target.value = '';
  }
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

function seekRelative(seconds: number) {
  const next = Math.max(0, Math.min(subtitleStore.videoDuration, subtitleStore.currentTime + seconds));
  if (videoRef.value) {
    videoRef.value.currentTime = next;
  }
  subtitleStore.currentTime = next;
}

function cyclePlaybackRate() {
  const currentIndex = PLAYBACK_RATES.indexOf(playbackRate.value);
  const nextIndex = (currentIndex + 1) % PLAYBACK_RATES.length;
  playbackRate.value = PLAYBACK_RATES[nextIndex];
  if (videoRef.value) {
    videoRef.value.playbackRate = playbackRate.value;
  }
}

function toggleMute() {
  if (videoRef.value) {
    isMuted.value = !isMuted.value;
    videoRef.value.muted = isMuted.value;
  }
}

function toggleFullscreen() {
  if (!playerContainerRef.value) return;
  if (!document.fullscreenElement) {
    playerContainerRef.value.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

function onSeek(e: Event) {
  const target = e.target as HTMLInputElement;
  const val = parseFloat(target.value);
  if (videoRef.value) {
    videoRef.value.currentTime = val;
  }
  subtitleStore.currentTime = val;
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
