<script setup lang="ts">
import { computed } from 'vue'
import { formatTimecode } from '@/utils/subtitle-format'

export interface DiffEntry {
  id: string
  originalText: string
  correctedText: string
  startTime: number
  endTime: number
  accepted?: boolean
}

const props = defineProps<{
  isOpen: boolean
  entries: DiffEntry[]
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'applyAll'): void
  (event: 'revertAll'): void
  (event: 'toggleEntry', id: string): void
}>()

const changedCount = computed(() => {
  return props.entries.filter((e) => e.originalText.trim() !== e.correctedText.trim()).length
})

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="diff-modal-title"
    @click="onBackdropClick"
  >
    <div
      class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-100"
      @click.stop
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-700/70 flex items-center justify-center text-indigo-400">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
            </svg>
          </div>
          <div>
            <h2 id="diff-modal-title" class="text-sm font-bold text-white">AI 润色文本对比审核</h2>
            <p class="text-[11px] text-slate-400">共对比 {{ entries.length }} 条，检测到 {{ changedCount }} 处修改</p>
          </div>
        </div>

        <button
          class="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          title="关闭"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Action Bar -->
      <div class="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between text-xs">
        <span class="text-slate-400">提示：绿色代表 AI 修正建议，红色代表原始识别文本</span>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold shadow transition cursor-pointer"
            @click="emit('applyAll')"
          >
            全部采纳润色
          </button>
          <button
            class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
            @click="emit('revertAll')"
          >
            全部保留原文
          </button>
        </div>
      </div>

      <!-- Diff Cards List -->
      <div class="flex-1 overflow-y-auto p-6 space-y-3">
        <div v-if="entries.length === 0" class="text-center py-12 text-slate-500 text-xs">
          暂无润色对比记录
        </div>

        <div
          v-for="item in entries"
          :key="item.id"
          class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>{{ formatTimecode(item.startTime) }} ~ {{ formatTimecode(item.endTime) }}</span>
            <button
              class="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
              @click="emit('toggleEntry', item.id)"
            >
              {{ item.accepted !== false ? '✓ 已采纳 (点击撤销)' : '✗ 已跳过 (点击采纳)' }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3 text-xs">
            <!-- 原文 -->
            <div class="p-2.5 rounded-lg bg-rose-950/20 border border-rose-900/40 text-slate-300">
              <span class="text-[10px] text-rose-400 font-semibold block mb-1">OCR 原始文本</span>
              <p class="leading-relaxed">{{ item.originalText }}</p>
            </div>

            <!-- AI 修正文本 -->
            <div class="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40 text-emerald-200">
              <span class="text-[10px] text-emerald-400 font-semibold block mb-1">AI 润色文本</span>
              <p class="leading-relaxed font-medium">{{ item.correctedText }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-3 border-t border-slate-800 flex items-center justify-end bg-slate-950/60">
        <button
          class="px-4 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
          @click="emit('close')"
        >
          完成审核
        </button>
      </div>
    </div>
  </div>
</template>
