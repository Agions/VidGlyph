<template>
  <header class="h-16 px-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between shadow-xl">
    <!-- Brand Logo & Name -->
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-950">
        <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
        </svg>
      </div>
      <div>
        <h1 class="text-base font-bold tracking-tight text-white flex items-center gap-2">
          SubLens
          <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80">v0.0.1</span>
          <span v-if="isTauri" class="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800/80">Tauri Native</span>
        </h1>
        <p class="text-[11px] text-slate-400">专业硬字幕提取与蒸馏工具</p>
      </div>
    </div>

    <!-- Center Main Action Buttons -->
    <div class="flex items-center gap-3">
      <!-- 原生 DOM File Input 选择器 (100% 兼容 WebKit blob: 协议) -->
      <input
        ref="fileInputRef"
        type="file"
        accept="video/*"
        class="hidden"
        @change="onFileSelected"
      />

      <!-- 导入视频按键 -->
      <button
        class="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg border border-slate-700 shadow transition cursor-pointer"
        @click="onImportClick"
      >
        <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
        </svg>
        <span>导入视频</span>
      </button>

      <!-- 自动定位选区按键 -->
      <button
        v-if="subtitleStore.videoUrl"
        :disabled="isDetectingROI"
        class="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-teal-300 text-xs font-semibold rounded-lg border border-slate-700 shadow transition cursor-pointer"
        title="智能分析视频硬字幕轮廓并自动推荐 ROI 选区"
        @click="onAutoDetectROI"
      >
        <svg class="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.6 15.12a2 2 0 00-1.023.547l-1.06 1.06a2 2 0 000 2.828l1.06 1.06a2 2 0 002.828 0l1.06-1.06a2 2 0 011.414-.586l.318-.016a6 6 0 013.86-.517l2.387.477a2 2 0 001.022.547l1.06-1.06a2 2 0 000-2.828l-1.06-1.06z"/>
        </svg>
        <span>{{ isDetectingROI ? '正在分析...' : '自动定位选区' }}</span>
      </button>

      <!-- 选择区域 (ROI 显隐开关联动) -->
      <button
        :class="[
          'flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border transition shadow cursor-pointer',
          subtitleStore.isRoiActive ? 'bg-emerald-950 border-emerald-500 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
        ]"
        @click="subtitleStore.isRoiActive = !subtitleStore.isRoiActive"
      >
        <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5v4h2V7h2V5H3zm0 10v4h4v-2H5v-2H3zm14 4h4v-4h-2v2h-2v2zm2-14h-4v2h2v2h2V5z"/>
        </svg>
        <span>选择区域</span>
      </button>

      <!-- 开始提取字幕 -->
      <button
        :disabled="!subtitleStore.videoUrl"
        class="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-950 transition cursor-pointer"
        @click="onExtractionClick"
      >
        <svg v-if="!subtitleStore.isExtracting" class="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <svg v-else class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        {{ subtitleStore.isExtracting ? `停止提取 [${subtitleStore.progressPercent}%]` : '开始提取字幕' }}
      </button>
    </div>

    <!-- Right Mode Switcher & Settings -->
    <div class="flex items-center gap-3">
      <!-- 提取配置快捷控件（语言、采样间隔、时间范围指示） -->
      <div class="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 text-xs">
        <!-- 识别语言快捷选择 -->
        <label class="flex items-center gap-1.5 cursor-pointer" title="OCR 识别语言">
          <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
          <select
            :value="extractionSettings.options.language"
            class="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer hover:text-white"
            @change="onLanguageChange"
          >
            <option
              v-for="lang in supportedLanguages"
              :key="lang.value"
              :value="lang.value"
              class="bg-slate-900 text-slate-200"
            >
              {{ lang.label }}
            </option>
          </select>
        </label>

        <span class="text-slate-700">|</span>

        <!-- 采样间隔快捷选择 -->
        <label class="flex items-center gap-1 cursor-pointer" title="抽帧采样间隔">
          <span class="text-[11px] text-slate-400">间隔:</span>
          <select
            :value="extractionSettings.options.sampleInterval"
            class="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer hover:text-white font-mono"
            @change="onSampleIntervalChange"
          >
            <option :value="0.5" class="bg-slate-900 text-slate-200">0.5s</option>
            <option :value="1.0" class="bg-slate-900 text-slate-200">1.0s</option>
            <option :value="2.0" class="bg-slate-900 text-slate-200">2.0s</option>
            <option :value="3.0" class="bg-slate-900 text-slate-200">3.0s</option>
          </select>
        </label>

        <!-- 自定义时间范围提示徽章（如仅截取局部片段时间） -->
        <button
          v-if="hasTimeSpanConstraint"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/60 text-emerald-400 font-mono text-[10px] cursor-pointer hover:bg-emerald-900 transition"
          title="已设置局部时间范围，点击可前往设置页修改"
          @click="$emit('openSettings')"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>{{ timeSpanLabel }}</span>
        </button>
      </div>

      <!-- 离线/云端 模式 Toggle -->
      <div class="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
        <button
          :class="[
            'px-3 py-1 rounded-md transition font-medium cursor-pointer',
            subtitleStore.ocrMode === 'local' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          ]"
          @click="subtitleStore.ocrMode = 'local'"
        >
          离线模式
        </button>
        <button
          :class="[
            'px-3 py-1 rounded-md transition font-medium cursor-pointer',
            subtitleStore.ocrMode === 'cloud' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          ]"
          @click="subtitleStore.ocrMode = 'cloud'"
        >
          云端 API
        </button>
      </div>

      <!-- 设置按钮 -->
      <button
        class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700 cursor-pointer"
        title="配置与安全密钥设置"
        @click="$emit('openSettings')"
      >
        <svg class="w-5 h-5 stroke-current" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useExtractionSettingsStore, useSubtitleStore } from '../../stores';
import { TauriBridge } from '../../services';
import { useWorkspaceVideoImport } from '../../composables/useWorkspaceVideoImport';
import { SUPPORTED_LANGUAGES } from '../../core';

const props = defineProps<{ isDetectingRoi?: boolean }>();

const subtitleStore = useSubtitleStore();
const extractionSettings = useExtractionSettingsStore();
const supportedLanguages = SUPPORTED_LANGUAGES;

const fileInputRef = ref<HTMLInputElement | null>(null);
const isTauri = computed(() => TauriBridge.isTauriEnv());
const { importVideoFile, importVideoPath } = useWorkspaceVideoImport();
const isDetectingROI = computed(() => props.isDetectingRoi === true);

const hasTimeSpanConstraint = computed(() => {
  const { startTime, endTime } = extractionSettings.options;
  return startTime > 0 || (endTime !== null && endTime > 0);
});

const timeSpanLabel = computed(() => {
  const { startTime, endTime } = extractionSettings.options;
  const startStr = `${startTime}s`;
  const endStr = endTime !== null ? `${endTime}s` : '片尾';
  return `${startStr} ~ ${endStr}`;
});

function onLanguageChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  extractionSettings.update({ language: select.value });
}

function onSampleIntervalChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  extractionSettings.update({ sampleInterval: Number(select.value) });
}

const emit = defineEmits<{
  (event: 'startExtraction'): void
  (event: 'cancelExtraction'): void
  (event: 'openSettings'): void
  (event: 'autoRoi'): void
}>();

function onExtractionClick() {
  if (subtitleStore.isExtracting) emit('cancelExtraction')
  else emit('startExtraction')
}

async function onImportClick() {
  if (isTauri.value) {
    const path = await TauriBridge.openVideoFileDialog();
    if (path) importVideoPath(path);
    return;
  }
  fileInputRef.value?.click();
}

function onAutoDetectROI() {
  if (!subtitleStore.videoUrl) return;
  // 具体检测与结果写回由组合根（app.vue）协调，这里只负责派发意图
  emit('autoRoi');
}

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) importVideoFile(file);
  target.value = '';
}
</script>
