<template>
  <div class="flex flex-col w-full h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
    <!-- 顶部 Header 工具条 -->
    <div class="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <span class="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <span>字幕识别结果 ({{ subtitleStore.subtitleCount }})</span>
          <span v-if="isFiltering" class="text-[11px] text-teal-300 font-normal">/ 显示 {{ visibleSubtitles.length }}</span>

          <!-- 时间轴校验健康状态胶囊 -->
          <button
            v-if="subtitleStore.subtitleCount > 0"
            :class="[
              'text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 cursor-pointer transition',
              timelineIssueCount === 0
                ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/60'
                : timelineHasErrors
                ? 'bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900'
                : 'bg-amber-950 text-amber-300 border border-amber-800 hover:bg-amber-900'
            ]"
            :title="`时间轴质量诊断：${timelineSummary}。点击查看详情`"
            @click="showTimelineDiagnostics"
          >
            <span>{{ timelineIssueCount === 0 ? '✓ 正常' : timelineHasErrors ? `⚠️ ${timelineIssueCount} 处异常` : `ℹ️ ${timelineIssueCount} 处提示` }}</span>
          </button>
        </span>
      </div>

      <!-- 快速导出 & AI 润色菜单 Dropdown -->
      <div class="flex items-center gap-2">
        <!-- AI 智能润色按键 -->
        <button
          v-if="subtitleStore.subtitleCount > 0 && !isAiRunning"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer"
          title="使用 AI 智能分析并纠正提取文本中的错别字与语法标点"
          @click="onAiCorrect"
        >
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
          </svg>
          <span>AI 润色</span>
        </button>

        <!-- 润色进行中：显示进度并提供取消 -->
        <button
          v-else-if="isAiRunning"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-indigo-700 text-indigo-200 text-xs font-semibold rounded-lg transition cursor-pointer"
          title="取消剩余条目的润色"
          @click="cancelAiCorrection"
        >
          <svg class="w-3.5 h-3.5 animate-spin text-indigo-300" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span>润色 {{ aiProgress.percent }}% · 取消</span>
        </button>

        <!-- 失败重试 -->
        <button
          v-if="failedItems.length > 0 && !isAiRunning"
          class="px-2.5 py-1.5 text-xs bg-amber-950/70 hover:bg-amber-900 border border-amber-800 text-amber-300 rounded-lg transition cursor-pointer"
          :title="`重试 ${failedItems.length} 条润色失败的条目`"
          @click="retryFailedCorrections"
        >
          重试失败 ({{ failedItems.length }})
        </button>

        <button
          v-if="subtitleStore.subtitleCount > 0"
          class="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-rose-400 rounded-lg transition border border-slate-700 cursor-pointer"
          @click="subtitleStore.clearSubtitles"
        >
          清空
        </button>

        <div class="relative group">
          <button
            :disabled="subtitleStore.subtitleCount === 0"
            class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer"
          >
            <span>导出字幕</span>
            <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </button>

          <!-- 导出格式下拉列表（格式清单与 core/Exporter 保持一致） -->
          <div class="absolute right-0 top-full mt-1 w-36 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 hidden group-hover:block z-50">
            <button
              v-for="format in EXPORT_FORMATS"
              :key="format.value"
              class="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-emerald-600 hover:text-white transition cursor-pointer"
              @click="exportAs(format.value)"
            >
              导出为 .{{ format.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索与筛选 -->
    <div v-if="subtitleStore.subtitleCount > 0" class="px-4 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center gap-2">
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索字幕文本（空格分隔多个关键词）"
        class="flex-1 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none"
      />
      <select
        v-model="confidenceFilter"
        class="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
      >
        <option value="all">全部置信度</option>
        <option value="low">低置信度 (&lt;60%)</option>
        <option value="high">高置信度 (≥90%)</option>
      </select>
    </div>

    <!-- 提取进度条动画 -->
    <div v-if="subtitleStore.isExtracting" class="px-4 py-2 bg-slate-950/90 border-b border-slate-800 flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-xs font-mono">
        <span class="text-emerald-400 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          提取进度 (Extracting)
        </span>
        <span class="text-slate-300 font-bold">{{ subtitleStore.progressPercent }}%</span>
      </div>
      <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150"
          :style="{ width: `${subtitleStore.progressPercent}%` }"
        ></div>
      </div>
    </div>

    <!-- AI 润色进度 -->
    <div v-if="isAiRunning" class="px-4 py-2 bg-indigo-950/40 border-b border-indigo-900/60 flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-xs font-mono">
        <span class="text-indigo-300">AI 润色进度</span>
        <span class="text-slate-300 font-bold">
          {{ aiProgress.done }}/{{ aiProgress.total }}
          <span v-if="aiProgress.failed > 0" class="text-amber-400">· 失败 {{ aiProgress.failed }}</span>
        </span>
      </div>
      <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full bg-indigo-500 transition-all duration-150" :style="{ width: `${aiProgress.percent}%` }"></div>
      </div>
    </div>

    <!-- 列表空状态 -->
    <div v-if="subtitleStore.subtitleCount === 0" class="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 gap-3">
      <svg class="w-12 h-12 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
      </svg>
      <p class="text-xs">暂无字幕识别记录</p>
      <p class="text-[11px] text-slate-600 max-w-xs">框选视频字幕区域后，点击顶部“开始提取”按键即可自动抽取时间轴字幕</p>
    </div>

    <!-- 筛选后无匹配 -->
    <div v-else-if="visibleSubtitles.length === 0" class="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 gap-2">
      <p class="text-xs">没有符合当前搜索 / 筛选条件的字幕</p>
      <button class="text-[11px] text-teal-300 hover:text-teal-200 transition cursor-pointer" @click="resetFilters">
        清除筛选条件
      </button>
    </div>

    <!-- 时间轴字幕卡片列表（点击跳转播放位置 / 播放时实时高亮） -->
    <div v-else class="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-slate-800/40">
      <div
        v-for="(item, position) in visibleSubtitles"
        :key="item.id"
        :class="[
          'pt-2.5 first:pt-0 group flex flex-col gap-1.5 p-2.5 rounded-lg transition cursor-pointer border',
          item.id === activeSubtitleId
            ? 'bg-emerald-950/40 border-emerald-500/80 shadow-md shadow-emerald-950/50'
            : 'bg-slate-950/60 hover:bg-slate-950 border-slate-800/80'
        ]"
        @click="seekToSubtitle(item.startTime)"
      >
        <!-- 卡片 Top 时间码 & 置信度 Badge -->
        <div class="flex items-center justify-between text-xs font-mono">
          <div class="flex items-center gap-2 text-emerald-400">
            <span class="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-[11px] font-bold">
              {{ formatTime(item.startTime) }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <!-- 润色失败与快捷重试 -->
            <button
              v-if="failedItemMap.has(item.id)"
              class="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900 transition flex items-center gap-1 cursor-pointer"
              :title="`润色失败：${failedItemMap.get(item.id)?.reason}。点击单条重试`"
              @click.stop="retrySingleCorrection(item.id)"
            >
              <span>重试润色</span>
            </button>

            <!-- 时间轴质量问题提示 -->
            <span
              v-if="itemIssueMap.has(position + 1)"
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold',
                itemIssueMap.get(position + 1)?.level === 'error' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
              ]"
              :title="itemIssueMap.get(position + 1)?.message"
            >
              {{ itemIssueMap.get(position + 1)?.level === 'error' ? '格式异常' : '时间轴重叠' }}
            </span>

            <!-- 置信度分值 -->
            <span
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold',
                item.confidence >= 90 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
              ]"
            >
              准确度 {{ Math.round(item.confidence) }}%
            </span>

            <button
              class="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition p-1 cursor-pointer"
              title="删除此条"
              @click.stop="subtitleStore.removeSubtitle(item.id)"
            >
              <svg class="w-3.5 h-3.5 stroke-current" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- 文本内联编辑框 -->
        <textarea
          :value="item.text"
          rows="2"
          class="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 text-slate-100 text-xs rounded p-2 resize-none focus:outline-none transition font-sans cursor-text"
          @click.stop
          @input="onTextChange(item.id, $event)"
        ></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSubtitleStore } from '../../stores';
import { useSecurityStore } from '../../stores';
import { TimecodeConverter } from '../../utils/TimecodeConverter';
import { SubtitleExporter, type ExportFormat } from '../../utils/SubtitleExporter';
import { filterSubtitleItems, findSubtitleAtTime, type ConfidenceFilter } from '../../utils/subtitleSearch';
import { TauriBridge } from '../../services';
import {
  AICorrector,
  filterExportable,
  formatExportSummary,
  validateSubtitleTimeline,
} from '../../core';
import { useNotification } from '../../composables/useNotification';
import {
  useAiCorrection,
  type AiCorrectionFailure,
} from '../../composables/useAiCorrection';
import { logger } from '../../utils/logger';

const emit = defineEmits<{
  (event: 'openSettings'): void
}>();

const subtitleStore = useSubtitleStore();
const securityStore = useSecurityStore();
const notifications = useNotification();

/** 导出格式清单（与 core/Exporter 支持的格式保持一致） */
const EXPORT_FORMATS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'srt', label: 'SRT' },
  { value: 'vtt', label: 'VTT' },
  { value: 'ass', label: 'ASS' },
  { value: 'ssa', label: 'SSA' },
  { value: 'txt', label: 'TXT' },
  { value: 'sbv', label: 'SBV' },
  { value: 'lrc', label: 'LRC' },
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
];

// ─── 搜索 / 筛选 ─────────────────────────────────────────────
const keyword = ref('');
const confidenceFilter = ref<ConfidenceFilter>('all');

const visibleSubtitles = computed(() =>
  filterSubtitleItems(subtitleStore.subtitles, {
    keyword: keyword.value,
    confidence: confidenceFilter.value,
  }),
);

const isFiltering = computed(() => keyword.value.trim().length > 0 || confidenceFilter.value !== 'all');

function resetFilters() {
  keyword.value = '';
  confidenceFilter.value = 'all';
}

// ─── 时间轴质量诊断 ──────────────────────────────────────────
const timelineQuality = computed(() => validateSubtitleTimeline(subtitleStore.subtitles));
const timelineSummary = computed(() => formatExportSummary(timelineQuality.value));
const timelineIssueCount = computed(() => timelineQuality.value.issues.length);
const timelineHasErrors = computed(() =>
  timelineQuality.value.issues.some((issue) => issue.level === 'error'),
);

const itemIssueMap = computed(() => {
  const map = new Map<number, { level: 'error' | 'warning'; message: string }>();
  for (const issue of timelineQuality.value.issues) {
    if (issue.index !== null && !map.has(issue.index)) {
      map.set(issue.index, { level: issue.level, message: issue.message });
    }
  }
  return map;
});

function showTimelineDiagnostics() {
  if (timelineIssueCount.value === 0) {
    notifications.success('时间轴质量检测通过，无乱序、重叠或异常区间');
    return;
  }
  const topIssues = timelineQuality.value.issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join('；');
  const message = `质量诊断（${timelineSummary.value}）\n${topIssues}`;
  if (timelineHasErrors.value) {
    notifications.warn(message);
  } else {
    notifications.info(message);
  }
}

// ─── 播放位置联动（O(log n) 二分查找，替代逐项线性判断）────────
const activeSubtitleId = computed<string | null>(() => {
  const timeline = SubtitleExporter.toSubtitleItems(subtitleStore.subtitles);
  return findSubtitleAtTime(timeline, subtitleStore.currentTime)?.id ?? null;
});

function formatTime(ms: number): string {
  return TimecodeConverter.msToSRT(ms).split(',')[0];
}

function seekToSubtitle(startTimeMs: number) {
  subtitleStore.currentTime = startTimeMs / 1000;
}

function onTextChange(id: string, e: Event) {
  const target = e.target as HTMLTextAreaElement;
  subtitleStore.updateSubtitleText(id, target.value);
}

// ─── AI 润色：进度 / 取消 / 失败重试 ──────────────────────────
const { isRunning: isAiRunning, progress: aiProgress, run, retryFailed, cancel } = useAiCorrection();
const failedItems = ref<AiCorrectionFailure[]>([]);

const failedItemMap = computed(() => {
  const map = new Map<string, AiCorrectionFailure>();
  for (const failure of failedItems.value) {
    map.set(failure.id, failure);
  }
  return map;
});

function buildCorrector(): AICorrector {
  const endpoint = (securityStore.cloudEndpoint || '').trim();
  const isGemini =
    !endpoint ||
    /generativelanguage\.googleapis\.com|:generateContent/i.test(endpoint);

  return new AICorrector({
    apiEndpoint:
      endpoint ||
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    apiKey: securityStore.apiKey,
    model: isGemini ? 'gemini-1.5-flash' : 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1024,
  });
}

function applyCorrectedText(id: string, text: string) {
  subtitleStore.updateSubtitleText(id, text);
}

async function onAiCorrect() {
  if (subtitleStore.subtitleCount === 0) return;
  if (!securityStore.apiKey.trim()) {
    notifications.warn('请先在设置中配置云端 API Key');
    emit('openSettings');
    return;
  }

  // 快照目标，避免在批量修改过程中读取到已变更的文本
  const targets = subtitleStore.subtitles
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({ id: item.id, text: item.text }));

  const outcome = await run(buildCorrector(), targets, applyCorrectedText, {
    context: subtitleStore.videoFileName || undefined,
  });
  failedItems.value = outcome.failures;
  reportAiOutcome(outcome.corrected, outcome.failed, outcome.cancelled);
}

async function retryFailedCorrections() {
  if (failedItems.value.length === 0) return;
  const pending = [...failedItems.value];
  const outcome = await retryFailed(buildCorrector(), pending, applyCorrectedText, {
    context: subtitleStore.videoFileName || undefined,
  });
  failedItems.value = outcome.failures;
  reportAiOutcome(outcome.corrected, outcome.failed, outcome.cancelled);
}

async function retrySingleCorrection(id: string) {
  const failure = failedItemMap.value.get(id);
  if (!failure || isAiRunning.value) return;

  const outcome = await retryFailed(buildCorrector(), [failure], applyCorrectedText, {
    context: subtitleStore.videoFileName || undefined,
  });
  if (outcome.failed === 0) {
    failedItems.value = failedItems.value.filter((item) => item.id !== id);
    notifications.success('单条字幕润色已成功更新');
  } else {
    notifications.warn(`该条润色仍未成功：${outcome.failures[0]?.reason ?? '未知错误'}`);
  }
}

function cancelAiCorrection() {
  cancel();
  notifications.info('已请求取消润色，已完成的结果会保留');
}

function reportAiOutcome(corrected: number, failed: number, cancelled: boolean) {
  if (cancelled) {
    notifications.info(`润色已取消，已修正 ${corrected} 条`);
    return;
  }
  if (failed > 0) {
    notifications.warn(`润色完成：修正 ${corrected} 条，失败 ${failed} 条（可点击「重试失败」）`);
    return;
  }
  if (corrected === 0) {
    notifications.info('润色完成：模型未发现需要修正的内容');
    return;
  }
  notifications.success(`AI 润色完成，共修正 ${corrected} 条字幕`);
}

// ─── 导出：先校验时间轴，再按格式导出 ────────────────────────
async function exportAs(format: ExportFormat) {
  const summary = validateSubtitleTimeline(subtitleStore.subtitles);
  const exportable = filterExportable(subtitleStore.subtitles);

  if (exportable.length === 0) {
    notifications.error(`无法导出：${formatExportSummary(summary)}`);
    return;
  }
  if (summary.issues.some((issue) => issue.level === 'error')) {
    notifications.warn(`已跳过无效条目（${summary.stats.emptyText} 条空文本、${summary.stats.invalidRange} 条时间非法）`);
  } else if (summary.issues.some((issue) => issue.level === 'warning')) {
    notifications.info(`导出前检查：${formatExportSummary(summary)}`);
  }

  const content = SubtitleExporter.exportToString(exportable, format);
  const baseName = subtitleStore.videoFileName
    ? subtitleStore.videoFileName.replace(/\.[^/.]+$/, '')
    : 'sublens_subtitles';
  const fileName = `${baseName}.${format}`;

  try {
    if (TauriBridge.isTauriEnv()) {
      const path = await TauriBridge.saveSubtitlesDialog(content, fileName, format);
      if (!path) {
        notifications.info('已取消导出');
        return;
      }
      notifications.success(`已导出 ${format.toUpperCase()} → ${path}`);
    } else {
      SubtitleExporter.downloadFile(content, fileName, SubtitleExporter.mimeTypeFor(format));
      notifications.success(`已导出 ${format.toUpperCase()} 字幕（共 ${exportable.length} 条）`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '字幕导出失败';
    logger.error('Export', '导出失败', error);
    notifications.error(message);
  }
}
</script>
