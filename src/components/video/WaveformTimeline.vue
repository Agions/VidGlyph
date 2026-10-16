<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSubtitleStore } from '@/stores'
import { formatTimecode } from '@/utils/subtitle-format'

const subtitleStore = useSubtitleStore()
const timelineRef = ref<HTMLDivElement | null>(null)
const hoveredSubtitle = ref<string | null>(null)

const duration = computed(() => Math.max(1, subtitleStore.videoDuration || 100))
const currentTime = computed(() => subtitleStore.currentTime || 0)

const playheadPercent = computed(() => {
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
})

// 生成多轨音频波形装饰柱（高度伪随机平滑分布，营造专业剪辑台质感）
const waveformBars = computed(() => {
  const count = 120
  const bars: { height: number; percent: number }[] = []
  for (let i = 0; i < count; i++) {
    const seed = Math.sin(i * 0.28) * 0.4 + Math.cos(i * 0.52) * 0.3 + 0.5
    const height = Math.max(15, Math.min(95, Math.round(seed * 100)))
    const percent = (i / count) * 100
    bars.push({ height, percent })
  }
  return bars
})

function getBlockStyle(startTimeMs: number, endTimeMs: number) {
  const startSec = startTimeMs / 1000
  const endSec = endTimeMs / 1000
  const left = (startSec / duration.value) * 100
  const width = Math.max(0.8, ((endSec - startSec) / duration.value) * 100)

  return {
    left: `${Math.min(99.5, Math.max(0, left))}%`,
    width: `${Math.min(100 - left, width)}%`,
  }
}

function onTimelineClick(event: MouseEvent) {
  if (!timelineRef.value || duration.value <= 0) return
  const rect = timelineRef.value.getBoundingClientRect()
  const clickX = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const targetTime = (clickX / rect.width) * duration.value
  subtitleStore.currentTime = Number(targetTime.toFixed(2))
}

function onSelectSubtitle(startTimeMs: number) {
  subtitleStore.currentTime = Number((startTimeMs / 1000).toFixed(2))
}
</script>

<template>
  <div class="waveform-timeline-container select-none">
    <!-- 时间刻度与悬浮预览提示 -->
    <div class="timeline-header flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 mb-1">
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse shadow-sm shadow-emerald-400/50"></span>
        <span class="font-medium text-slate-300">多轨时间轴</span>
        <span class="text-slate-600">|</span>
        <span class="text-slate-500">{{ subtitleStore.subtitles.length }} 轨字幕</span>
      </div>
      <span v-if="hoveredSubtitle" class="text-cyan-300 truncate max-w-[280px] bg-slate-900/90 px-2 py-0.5 rounded border border-cyan-500/30 font-sans">
        {{ hoveredSubtitle }}
      </span>
      <span class="font-mono text-slate-400">
        <span class="text-emerald-400 font-semibold">{{ formatTimecode(currentTime * 1000) }}</span>
        <span class="text-slate-600 mx-1">/</span>
        <span>{{ formatTimecode(duration * 1000) }}</span>
      </span>
    </div>

    <!-- 交互轨道主体 -->
    <div
      ref="timelineRef"
      class="timeline-track relative h-16 bg-slate-950 border border-slate-800/90 rounded-lg overflow-hidden cursor-pointer shadow-inner"
      @click="onTimelineClick"
    >
      <!-- 刻度标尺线 (Tick Marks) -->
      <div class="absolute inset-x-0 top-0 h-2 flex justify-between px-2 pointer-events-none opacity-30 z-0">
        <div v-for="t in [0, 25, 50, 75, 100]" :key="t" class="w-px h-full bg-slate-400"></div>
      </div>

      <!-- 1. 背景波形可视化图层（已播放/未播放双色光柱） -->
      <div class="absolute inset-0 flex items-center justify-between px-1 pointer-events-none">
        <div
          v-for="(bar, idx) in waveformBars"
          :key="idx"
          class="w-0.5 rounded-full transition-all duration-150"
          :class="bar.percent <= playheadPercent
            ? 'bg-gradient-to-t from-emerald-500 to-cyan-400 opacity-70 shadow-xs'
            : 'bg-slate-700/50 opacity-40'"
          :style="{ height: `${bar.height}%` }"
        ></div>
      </div>

      <!-- 2. 字幕块分布轨道 (Subtitle Blocks Layer) -->
      <div class="absolute inset-0 z-10 pointer-events-none">
        <div
          v-for="sub in subtitleStore.subtitles"
          :key="sub.id"
          :style="getBlockStyle(sub.startTime, sub.endTime)"
          :class="[
            'absolute top-1.5 bottom-1.5 rounded px-1.5 flex items-center justify-center text-[10px] font-medium text-white truncate pointer-events-auto transition-all cursor-pointer shadow-md',
            currentTime * 1000 >= sub.startTime && currentTime * 1000 <= sub.endTime
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 border border-emerald-200 ring-2 ring-emerald-400/50 z-20 shadow-emerald-500/30'
              : 'bg-emerald-900/80 hover:bg-emerald-800/90 border border-emerald-700/70 hover:border-emerald-500/80'
          ]"
          :title="`[${formatTimecode(sub.startTime)}] ${sub.text}`"
          @mouseenter="hoveredSubtitle = sub.text"
          @mouseleave="hoveredSubtitle = null"
          @click.stop="onSelectSubtitle(sub.startTime)"
        >
          <span class="truncate px-0.5 pointer-events-none text-emerald-50 font-sans text-[9px] drop-shadow-xs">{{ sub.text }}</span>
        </div>
      </div>

      <!-- 3. 播放头红线指示器 (Playhead Needle) -->
      <div
        class="absolute top-0 bottom-0 z-30 pointer-events-none transition-all duration-75"
        :style="{ left: `${playheadPercent}%` }"
      >
        <div class="w-0.5 h-full bg-rose-500 shadow-md shadow-rose-500/80"></div>
        <div class="w-2.5 h-2.5 bg-rose-500 rotate-45 -ml-1 -mt-1 rounded-xs shadow-xs"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waveform-timeline-container {
  width: 100%;
}
</style>
