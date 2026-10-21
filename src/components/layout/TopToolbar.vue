<template>
  <header class="h-16 px-5 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80 flex items-center justify-between shadow-2xl relative z-40 select-none">
    <!-- Brand Logo, Name & Active Project Pill -->
    <div class="flex items-center gap-3">
      <!-- VidGlyph Optical Prism & Character Glyph Logo -->
      <div class="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-emerald-400 to-indigo-500 p-0.5 shadow-lg shadow-cyan-950/80 group cursor-default">
        <div class="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
          <svg class="w-5 h-5 text-cyan-400 group-hover:scale-105 transition duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <!-- Optical lens hexagonal aperture with stylized V & G glyph lines -->
            <polygon points="12 2 20 6.5 20 17.5 12 22 4 17.5 4 6.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="stroke-cyan-400"/>
            <path d="M8 9l4 6 4-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-emerald-300"/>
            <circle cx="12" cy="12" r="2" fill="currentColor" class="text-indigo-400"/>
          </svg>
        </div>
      </div>

      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
            VidGlyph <span class="text-xs font-normal text-slate-400">· 字映</span>
          </h1>
          <span class="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded-full bg-cyan-950/90 text-cyan-400 border border-cyan-800/60 font-semibold">v0.1.0</span>
          <span v-if="isTauri" class="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded-full bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">Studio</span>
        </div>
        <p class="text-[10px] text-slate-400">专业视频字幕光学提取与多轨精编工作台</p>
      </div>

      <!-- Active Project Capsule Button -->
      <button
        class="hidden lg:flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-cyan-500/50 text-[11px] font-mono text-slate-300 hover:text-white transition cursor-pointer shadow-xs"
        title="当前工作区工程，点击切换或管理工程"
        @click="emit('openProjects')"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"></span>
        <span class="truncate max-w-[120px] font-medium">{{ projectStore.currentProjectName || '未命名工程' }}</span>
        <svg class="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
    </div>

    <!-- Center Main Action Buttons -->
    <div class="flex items-center gap-2.5">
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
        class="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-100 text-xs font-semibold rounded-lg border border-slate-700/80 hover:border-cyan-500/40 shadow-sm transition cursor-pointer"
        title="导入本地视频文件 (快捷键: ⌘O / Ctrl+O)"
        @click="onImportClick"
      >
        <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
        </svg>
        <span>导入视频</span>
      </button>

      <!-- 工程项目管理按键 -->
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700/80 hover:border-slate-600 shadow-sm transition cursor-pointer"
        title="打开本地 SQLite 工程管理与 .vidglyph 工程包"
        @click="emit('openProjects')"
      >
        <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
        <span>工程库</span>
      </button>

      <!-- 批量生产线按键 -->
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700/80 hover:border-indigo-500/40 shadow-sm transition cursor-pointer"
        title="打开多视频并发提取生产线看板"
        @click="emit('openBatch')"
      >
        <svg class="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
        </svg>
        <span>流水线</span>
      </button>

      <!-- 自动定位选区按键 -->
      <button
        v-if="subtitleStore.videoUrl"
        :disabled="isDetectingROI"
        class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-teal-300 text-xs font-semibold rounded-lg border border-teal-800/60 hover:border-teal-500/80 shadow-sm transition cursor-pointer"
        title="智能分析视频硬字幕轮廓并自动推荐 ROI 选区"
        @click="onAutoDetectROI"
      >
        <svg v-if="!isDetectingROI" class="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.6 15.12a2 2 0 00-1.023.547l-1.06 1.06a2 2 0 000 2.828l1.06 1.06a2 2 0 002.828 0l1.06-1.06a2 2 0 011.414-.586l.318-.016a6 6 0 013.86-.517l2.387.477a2 2 0 001.022.547l1.06-1.06a2 2 0 000-2.828l-1.06-1.06z"/>
        </svg>
        <svg v-else class="w-4 h-4 animate-spin text-teal-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span>{{ isDetectingROI ? '定位中...' : '自动选区' }}</span>
      </button>

      <!-- 选择区域 (ROI 显隐开关联动) -->
      <button
        :class="[
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition shadow-sm cursor-pointer',
          subtitleStore.isRoiActive ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-300 ring-1 ring-cyan-500/30' : 'bg-slate-900 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        ]"
        title="开启/关闭视频预览画面上的 8 点手柄硬字幕选区"
        @click="subtitleStore.isRoiActive = !subtitleStore.isRoiActive"
      >
        <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5v4h2V7h2V5H3zm0 10v4h4v-2H5v-2H3zm14 4h4v-4h-2v2h-2v2zm2-14h-4v2h2v2h2V5z"/>
        </svg>
        <span>标定选区</span>
      </button>

      <!-- 开始提取字幕 (Hero CTA 渐变按键) -->
      <button
        :disabled="!subtitleStore.videoUrl"
        :class="[
          'flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg shadow-lg transition cursor-pointer',
          subtitleStore.isExtracting
            ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/60 ring-2 ring-rose-500/30'
            : 'bg-gradient-to-r from-cyan-600 via-emerald-600 to-teal-500 hover:from-cyan-500 hover:to-emerald-400 text-white shadow-cyan-950/80 hover:shadow-cyan-900/60 disabled:opacity-40 disabled:pointer-events-none'
        ]"
        title="开始执行视频硬字幕流式提取 (快捷键: ⌘Enter / Ctrl+Enter)"
        @click="onExtractionClick"
      >
        <svg v-if="!subtitleStore.isExtracting" class="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <svg v-else class="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span>{{ subtitleStore.isExtracting ? `停止提取 [${subtitleStore.progressPercent}%]` : '开始提取' }}</span>
      </button>
    </div>

    <!-- Right Mode Switcher & Settings -->
    <div class="flex items-center gap-2.5">
      <!-- 提取配置快捷控件（语言、采样间隔、时间范围指示） -->
      <div class="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 text-xs">
        <!-- 识别语言快捷选择 -->
        <label class="flex items-center gap-1 cursor-pointer" title="OCR 识别模型主语言">
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

        <span class="text-slate-800">|</span>

        <!-- 采样间隔快捷选择 -->
        <label class="flex items-center gap-1 cursor-pointer" title="抽帧采样间隔频率">
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

        <!-- 自定义时间范围提示徽章 -->
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
      <div class="flex items-center p-0.5 bg-slate-900/90 border border-slate-800 rounded-lg text-xs">
        <button
          :class="[
            'px-2.5 py-1 rounded-md transition font-medium cursor-pointer',
            subtitleStore.ocrMode === 'local' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
          ]"
          title="使用本地轻量 ONNX 流式识别引擎 (无需网络，极速无耗)"
          @click="subtitleStore.ocrMode = 'local'"
        >
          本地原生
        </button>
        <button
          :class="[
            'px-2.5 py-1 rounded-md transition font-medium cursor-pointer',
            subtitleStore.ocrMode === 'cloud' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
          ]"
          title="使用云端视觉大模型 (Gemini / OpenAI Vision) 深度理解"
          @click="subtitleStore.ocrMode = 'cloud'"
        >
          云端大模型
        </button>
      </div>

      <!-- 设置按钮 (含 API Key 配置指示小绿点) -->
      <button
        class="relative p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition border border-slate-800 cursor-pointer"
        title="系统设置与 API 密钥管理"
        @click="$emit('openSettings')"
      >
        <span
          v-if="securityStore.apiKey"
          class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950"
          title="已配置云端 API Key"
        ></span>
        <svg class="w-4 h-4 stroke-current" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useExtractionSettingsStore, useSubtitleStore, useProjectStore, useSecurityStore } from '../../stores';
import { TauriBridge } from '../../services';
import { useWorkspaceVideoImport } from '../../composables/useWorkspaceVideoImport';
import { SUPPORTED_LANGUAGES } from '../../core';

const props = defineProps<{ isDetectingRoi?: boolean }>();

const subtitleStore = useSubtitleStore();
const projectStore = useProjectStore();
const securityStore = useSecurityStore();
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
  const target = event.target as { value?: string } | null;
  if (target?.value !== undefined) {
    extractionSettings.update({ language: target.value });
  }
}

function onSampleIntervalChange(event: Event) {
  const target = event.target as { value?: string } | null;
  if (target?.value !== undefined) {
    extractionSettings.update({ sampleInterval: Number(target.value) });
  }
}

const emit = defineEmits<{
  (event: 'startExtraction'): void
  (event: 'cancelExtraction'): void
  (event: 'openSettings'): void
  (event: 'openProjects'): void
  (event: 'openBatch'): void
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
