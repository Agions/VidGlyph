<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProjectStore, useSubtitleStore } from '@/stores'
import { useNotification } from '@/composables/useNotification'
import { TauriBridge } from '@/services'
import { formatTimecode } from '@/utils/subtitle-format'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const projectStore = useProjectStore()
const subtitleStore = useSubtitleStore()
const notifications = useNotification()

const newProjectName = ref('')

watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      newProjectName.value = subtitleStore.videoFileName
        ? `${subtitleStore.videoFileName.replace(/\.[^/.]+$/, '')}_字幕工程`
        : ''
      void projectStore.refreshProjectsList()
    }
  },
)

async function onSaveCurrent() {
  try {
    const id = await projectStore.saveCurrentProject(newProjectName.value)
    if (id) {
      notifications.success(`工程 [${projectStore.currentProjectName}] 已保存到本地 SQLite`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    notifications.error(`保存失败：${msg}`)
  }
}

async function onLoadProject(projectId: string) {
  try {
    await projectStore.loadProject(projectId)
    notifications.success(`已载入工程 [${projectStore.currentProjectName}]`)
    emit('close')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    notifications.error(`载入失败：${msg}`)
  }
}

async function onDeleteProject(projectId: string, name: string) {
  if (!confirm(`确定要删除工程「${name}」及其全部字幕记录吗？此操作无法撤销。`)) return
  try {
    await projectStore.deleteProject(projectId)
    notifications.info(`已删除工程 [${name}]`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    notifications.error(`删除失败：${msg}`)
  }
}

async function onExportBundle(projectId: string, defaultName: string) {
  try {
    const defaultFile = `${defaultName.replace(/\s+/g, '_')}.vidglyph`
    const path = await TauriBridge.saveSubtitlesDialog('', defaultFile, 'vidglyph')
    if (!path) return
    await projectStore.exportBundle(path, projectId)
    notifications.success(`已导出工程包至: ${path}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    notifications.error(`导出失败：${msg}`)
  }
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="project-modal-title"
    @click="onBackdropClick"
    @keydown="onKeydown"
  >
    <div
      class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-100"
      @click.stop
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-700/70 flex items-center justify-center text-emerald-400">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
            </svg>
          </div>
          <div>
            <h2 id="project-modal-title" class="text-sm font-bold text-white">工程项目管理</h2>
            <p class="text-[11px] text-slate-400">SQLite 本地轻量持久化与 .vidglyph 工程包</p>
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

      <!-- Action: Save Current Project Bar -->
      <div class="px-6 py-3 bg-slate-950/40 border-b border-slate-800 flex items-center gap-3">
        <input
          v-model="newProjectName"
          type="text"
          placeholder="输入当前工程名称..."
          class="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          :disabled="projectStore.isSaving || (!subtitleStore.videoPath && !subtitleStore.videoUrl)"
          class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer flex items-center gap-1.5"
          @click="onSaveCurrent"
        >
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
          <span>{{ projectStore.isSaving ? '保存中...' : '保存当前工作区' }}</span>
        </button>
      </div>

      <!-- Project List Body -->
      <div class="flex-1 overflow-y-auto p-6 space-y-3">
        <div v-if="projectStore.isLoading" class="text-center py-12 text-slate-500 text-xs">
          正在加载本地工程数据库...
        </div>

        <div
          v-else-if="projectStore.projectsList.length === 0"
          class="text-center py-12 text-slate-500 flex flex-col items-center gap-3"
        >
          <div class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-600">
            <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
            </svg>
          </div>
          <p class="text-xs">暂无已保存工程，可在上方将当前识别进度保存入库</p>
        </div>

        <div
          v-for="p in projectStore.projectsList"
          :key="p.id"
          :class="[
            'border rounded-xl p-4 transition flex items-center justify-between gap-4',
            projectStore.currentProjectId === p.id
              ? 'bg-emerald-950/30 border-emerald-600/80 shadow-md'
              : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800/80'
          ]"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-white truncate">{{ p.name }}</h3>
              <span
                v-if="projectStore.currentProjectId === p.id"
                class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/80 text-emerald-300 font-mono"
              >
                当前工程
              </span>
            </div>
            <p class="text-[11px] text-slate-400 font-mono truncate mt-1" :title="p.videoPath">
              {{ p.videoPath }}
            </p>
            <div class="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-1.5">
              <span>时长: {{ formatTimecode(p.durationMs) }}</span>
              <span>分辨率: {{ p.width }}x{{ p.height }}</span>
              <span>更新于: {{ new Date(p.updatedAt).toLocaleString() }}</span>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              class="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition font-medium cursor-pointer"
              @click="onLoadProject(p.id)"
            >
              载入
            </button>
            <button
              class="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition cursor-pointer"
              title="导出为独立 .vidglyph 工程包"
              @click="onExportBundle(p.id, p.name)"
            >
              导出包
            </button>
            <button
              class="px-2 py-1.5 text-xs text-rose-400 hover:bg-rose-950/60 rounded-lg transition cursor-pointer"
              title="删除工程"
              @click="onDeleteProject(p.id, p.name)"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-950/60 text-xs text-slate-400">
        <span>已保存工程：{{ projectStore.projectsList.length }} 个</span>
        <button
          class="px-4 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>
