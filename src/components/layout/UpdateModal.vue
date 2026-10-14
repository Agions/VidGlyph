<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-opacity duration-200"
    >
      <div class="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <!-- Top Banner Header -->
        <div class="px-6 py-5 bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <svg class="w-6 h-6 stroke-current" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h3 class="text-base font-bold text-white flex items-center gap-2">
                发现新版本
                <span class="px-2 py-0.5 text-xs font-mono rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  v{{ updateInfo?.version }}
                </span>
              </h3>
              <p class="text-xs text-slate-400">当前版本: v{{ updateInfo?.currentVersion }}</p>
            </div>
          </div>

          <button
            class="text-slate-400 hover:text-slate-200 transition p-1 cursor-pointer"
            @click="$emit('close')"
          >
            <svg class="w-5 h-5 stroke-current" fill="none" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Body Content & Release Notes -->
        <div class="p-6 space-y-4">
          <div class="space-y-1.5">
            <h4 class="text-xs font-semibold text-slate-300 uppercase tracking-wider">更新说明 (Release Notes)</h4>
            <div class="p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {{ updateInfo?.notes || '包含最新性能提升、算法响应优化与全平台兼容性修复。' }}
            </div>
          </div>

          <!-- Progress bar if downloading -->
          <div v-if="isDownloading" class="space-y-2">
            <div class="flex items-center justify-between text-xs font-mono">
              <span class="text-emerald-400 flex items-center gap-2">
                <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                正在下载最新包...
              </span>
              <span class="text-slate-300 font-bold">{{ progressPercent }}%</span>
            </div>
            <div class="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150"
                :style="{ width: `${progressPercent}%` }"
              ></div>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            :disabled="isDownloading"
            class="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition disabled:opacity-50 cursor-pointer"
            @click="$emit('close')"
          >
            稍后提醒
          </button>
          <button
            :disabled="isDownloading"
            class="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-lg shadow-emerald-950 transition cursor-pointer"
            @click="startUpdate"
          >
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            <span>{{ isDownloading ? '下载更新中...' : '立即更新并重启' }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { UpdaterService, type UpdateInfo } from '../../services';
import { useNotification } from '../../composables/useNotification';

const props = defineProps<{
  isOpen: boolean;
  updateInfo: UpdateInfo | null;
}>();

const emit = defineEmits(['close']);

const isDownloading = ref(false);
const progressPercent = ref(0);
const notifications = useNotification();

async function startUpdate() {
  if (!props.updateInfo) return;

  isDownloading.value = true;
  progressPercent.value = 0;

  try {
    const success = await UpdaterService.installUpdate(
      props.updateInfo.rawUpdateObj,
      (downloaded, total) => {
        if (total > 0) {
          progressPercent.value = Math.min(100, Math.round((downloaded / total) * 100));
        }
      }
    );

    if (success) {
      notifications.success('更新包安装完成，应用即将重启');
      emit('close');
    }
  } catch (error: unknown) {
    notifications.error(`自动更新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isDownloading.value = false;
  }
}
</script>
