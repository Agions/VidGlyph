<script setup lang="ts">
import { ref } from 'vue'
import TopToolbar from './components/layout/TopToolbar.vue'
import VideoPlayer from './components/video/VideoPlayer.vue'
import SubtitleTimelineList from './components/subtitle/SubtitleTimelineList.vue'
import SettingsModal from './components/layout/SettingsModal.vue'
import UpdateModal from './components/layout/UpdateModal.vue'
import ProjectModal from './components/project/ProjectModal.vue'
import BatchWorkspaceModal from './components/batch/BatchWorkspaceModal.vue'
import Toast from './components/common/toast.vue'
import { useSubtitleStore } from './stores'
import { useWorkspaceController } from './composables/useWorkspaceController'
import { useAutoRoi } from './composables/useAutoRoi'
import { useNotification } from './composables/useNotification'

const subtitleStore = useSubtitleStore()
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null)
const notifications = useNotification()
const isProjectsOpen = ref(false)
const isBatchOpen = ref(false)
const {
  isSettingsOpen,
  isUpdateOpen,
  currentUpdateInfo,
  startExtraction,
  cancelExtraction,
  handleUpdateFound,
} = useWorkspaceController()
const { isDetecting, detect } = useAutoRoi()

function handleStartExtraction() {
  void startExtraction(videoPlayerRef.value?.getVideoElement() ?? null, subtitleStore.roi)
}

/** 自动定位字幕选区：原生检测优先，失败时回退本地像素分析 */
async function handleAutoRoi() {
  const outcome = await detect({
    videoElement: videoPlayerRef.value?.getVideoElement() ?? null,
    videoPath: subtitleStore.videoPath,
    timestamp: subtitleStore.currentTime,
  })
  if (!outcome) return

  subtitleStore.setROI(outcome.roi)
  subtitleStore.isRoiActive = true
  const source = outcome.source === 'native' ? '原生检测' : '本地分析'
  notifications.success(
    `已定位字幕区域（${source}），置信度 ${Math.round(outcome.confidence * 100)}%`,
  )
}
</script>

<template>
  <div class="vidglyph-app">
    <TopToolbar
      :is-detecting-roi="isDetecting"
      @start-extraction="handleStartExtraction"
      @cancel-extraction="cancelExtraction"
      @open-settings="isSettingsOpen = true"
      @open-projects="isProjectsOpen = true"
      @open-batch="isBatchOpen = true"
      @auto-roi="handleAutoRoi"
    />
    <main class="workspace-main" aria-label="字幕提取工作台">
      <section class="workspace-preview" aria-label="视频预览与区域选择">
        <VideoPlayer ref="videoPlayerRef" />
      </section>
      <aside class="workspace-results" aria-label="字幕识别结果">
        <SubtitleTimelineList @open-settings="isSettingsOpen = true" />
      </aside>
    </main>
    <SettingsModal
      :is-open="isSettingsOpen"
      @close="isSettingsOpen = false"
      @update-found="handleUpdateFound"
    />
    <ProjectModal
      :is-open="isProjectsOpen"
      @close="isProjectsOpen = false"
    />
    <BatchWorkspaceModal
      :is-open="isBatchOpen"
      @close="isBatchOpen = false"
    />
    <UpdateModal
      :is-open="isUpdateOpen"
      :update-info="currentUpdateInfo"
      @close="isUpdateOpen = false"
    />
    <Toast />
  </div>
</template>

<style>
@import 'assets/styles/global.scss';

.vidglyph-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base, #090d16);
  color: var(--text-primary, #f8fafc);
  overflow: hidden;
}

.workspace-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 16px;
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  background: var(--bg-base, #090d16);
}

.workspace-preview,
.workspace-results { min-width: 0; min-height: 0; }

@media (max-width: 900px) {
  .workspace-main {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(300px, 1fr) minmax(260px, 42vh);
    overflow: auto;
  }
}

@media (max-width: 560px) {
  .workspace-main { padding: 8px; gap: 8px; }
}
</style>
