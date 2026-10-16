<script setup lang="ts">
import { ref } from 'vue'
import { TauriBridge } from '@/services'
import { useNotification } from '@/composables/useNotification'

export interface BatchItem {
  id: string
  path: string
  name: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  subtitlesCount: number
  error?: string
}

defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const notifications = useNotification()
const batchQueue = ref<BatchItem[]>([])
const isRunningBatch = ref(false)
const isCancelRequested = ref(false)
const selectedLanguage = ref('ch')
const sampleInterval = ref(1.0)
let currentRunningTaskId: string | null = null

async function onAddVideos() {
  const selected = await TauriBridge.openVideoFileDialog()
  if (!selected) return

  const name = selected.split('/').pop() || selected
  if (batchQueue.value.some((item) => item.path === selected)) {
    notifications.warn('该视频已在批量队列中')
    return
  }

  batchQueue.value.push({
    id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    path: selected,
    name,
    status: 'pending',
    progress: 0,
    subtitlesCount: 0,
  })
}

function onRemoveItem(id: string) {
  if (isRunningBatch.value) {
    notifications.warn('批量任务执行中，无法移除')
    return
  }
  batchQueue.value = batchQueue.value.filter((item) => item.id !== id)
}

function onClearQueue() {
  if (isRunningBatch.value) return
  batchQueue.value = []
}

async function startBatchProcessing() {
  if (batchQueue.value.length === 0) {
    notifications.warn('请先添加待处理的视频')
    return
  }

  isRunningBatch.value = true
  isCancelRequested.value = false

  for (const item of batchQueue.value) {
    if (isCancelRequested.value) break
    if (item.status === 'completed') continue

    item.status = 'processing'
    item.progress = 0

    try {
      if (TauriBridge.isTauriEnv()) {
        const defaultRoi = { x: 0.1, y: 0.72, width: 0.8, height: 0.2 }
        await new Promise<void>((resolve, reject) => {
          TauriBridge.startNativePipeline(
            {
              videoPath: item.path,
              roi: defaultRoi,
              sampleInterval: sampleInterval.value,
              language: selectedLanguage.value,
            },
            {
              onProgress: (prog) => {
                item.progress = Math.round(prog.percent)
              },
              onSubtitle: () => {
                item.subtitlesCount += 1
              },
              onFinished: (fin) => {
                currentRunningTaskId = null
                if (fin.status === 'completed') {
                  item.status = 'completed'
                  item.progress = 100
                  resolve()
                } else if (fin.status === 'cancelled') {
                  item.status = 'pending'
                  resolve()
                } else {
                  item.status = 'failed'
                  item.error = fin.errorMessage || '提取出错'
                  reject(new Error(item.error))
                }
              },
            },
          )
            .then(({ taskId }) => {
              currentRunningTaskId = taskId
            })
            .catch(reject)
        })
      } else {
        // 非桌面端模拟执行进度
        for (let p = 0; p <= 100; p += 25) {
          if (isCancelRequested.value) break
          await new Promise((r) => setTimeout(r, 200))
          item.progress = p
        }
        item.status = 'completed'
        item.subtitlesCount = 12
      }
    } catch (err: unknown) {
      item.status = 'failed'
      item.error = err instanceof Error ? err.message : String(err)
    }
  }

  isRunningBatch.value = false
  currentRunningTaskId = null
  notifications.success('批量队列处理流程结束')
}

function cancelBatchProcessing() {
  isCancelRequested.value = true
  if (currentRunningTaskId && TauriBridge.isTauriEnv()) {
    void TauriBridge.cancelNativePipeline(currentRunningTaskId)
  }
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget && !isRunningBatch.value) {
    emit('close')
  }
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="batch-modal-title"
    @click="onBackdropClick"
  >
    <div
      class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-100"
      @click.stop
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-blue-950 border border-blue-700/70 flex items-center justify-center text-blue-400">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
            </svg>
          </div>
          <div>
            <h2 id="batch-modal-title" class="text-sm font-bold text-white">批量视频生产线</h2>
            <p class="text-[11px] text-slate-400">多视频队列并发调度与无人值守硬字幕提取</p>
          </div>
        </div>

        <button
          :disabled="isRunningBatch"
          class="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          title="关闭"
          @click="emit('close')"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Settings & Controls Toolbar -->
      <div class="px-6 py-3 bg-slate-950/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <button
            :disabled="isRunningBatch"
            class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer flex items-center gap-1.5"
            @click="onAddVideos"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            <span>添加视频</span>
          </button>

          <label class="flex items-center gap-1 text-xs text-slate-300">
            <span>采样:</span>
            <select
              v-model.number="sampleInterval"
              :disabled="isRunningBatch"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white"
            >
              <option :value="0.5">0.5 秒 (精细)</option>
              <option :value="1.0">1.0 秒 (标准)</option>
              <option :value="2.0">2.0 秒 (极速)</option>
            </select>
          </label>

          <label class="flex items-center gap-1 text-xs text-slate-300">
            <span>语言:</span>
            <select
              v-model="selectedLanguage"
              :disabled="isRunningBatch"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white"
            >
              <option value="ch">中文 (中英混排)</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="!isRunningBatch"
            :disabled="batchQueue.length === 0"
            class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
            @click="startBatchProcessing"
          >
            开始批量流水线 ({{ batchQueue.length }})
          </button>
          <button
            v-else
            class="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
            @click="cancelBatchProcessing"
          >
            停止流水线
          </button>
          <button
            :disabled="isRunningBatch || batchQueue.length === 0"
            class="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
            @click="onClearQueue"
          >
            清空
          </button>
        </div>
      </div>

      <!-- Queue List -->
      <div class="flex-1 overflow-y-auto p-6 space-y-3">
        <div v-if="batchQueue.length === 0" class="text-center py-16 text-slate-500 flex flex-col items-center gap-3">
          <div class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-600">
            <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
            </svg>
          </div>
          <p class="text-xs">批量队列为空，请点击上方「添加视频」将视频导入流水线</p>
        </div>

        <div
          v-for="item in batchQueue"
          :key="item.id"
          class="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-white truncate">{{ item.name }}</span>
                <span
                  :class="[
                    'text-[10px] px-2 py-0.5 rounded-full font-mono',
                    item.status === 'completed' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                    item.status === 'processing' ? 'bg-blue-950 text-blue-400 border border-blue-800 animate-pulse' :
                    item.status === 'failed' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                    'bg-slate-900 text-slate-400 border border-slate-800'
                  ]"
                >
                  {{ item.status === 'completed' ? '已完成' :
                     item.status === 'processing' ? '提取中' :
                     item.status === 'failed' ? '失败' : '排队中' }}
                </span>
              </div>
              <p class="text-[10px] text-slate-500 font-mono truncate mt-0.5">{{ item.path }}</p>
            </div>

            <div class="flex items-center gap-3 shrink-0">
              <span v-if="item.subtitlesCount > 0" class="text-xs font-mono text-emerald-400">
                {{ item.subtitlesCount }} 条字幕
              </span>
              <button
                v-if="!isRunningBatch"
                class="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition"
                title="移除"
                @click="onRemoveItem(item.id)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
            <div
              :class="[
                'h-full transition-all duration-300',
                item.status === 'completed' ? 'bg-emerald-500' :
                item.status === 'failed' ? 'bg-rose-500' : 'bg-blue-500'
              ]"
              :style="{ width: `${item.progress}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
