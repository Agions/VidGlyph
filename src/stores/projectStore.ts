/**
 * @file projectStore.ts
 * @description SQLite 工程项目管理、持久化与 .vidglyph 工程包管理 Store。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  TauriBridge,
  type ProjectRecord,
  type SubtitleRecord,
  type ProjectDetail,
} from '@/services';
import { useSubtitleStore } from './subtitleStore';
import { logger } from '@/utils/logger';

export const useProjectStore = defineStore('project', () => {
  const currentProjectId = ref<string | null>(null);
  const currentProjectName = ref<string>('未命名项目');
  const projectsList = ref<ProjectRecord[]>([]);
  const isSaving = ref<boolean>(false);
  const isLoading = ref<boolean>(false);

  /** 刷新已保存工程列表 */
  async function refreshProjectsList(): Promise<void> {
    if (!TauriBridge.isTauriEnv()) return;
    try {
      isLoading.value = true;
      projectsList.value = await TauriBridge.dbListProjects();
    } catch (err) {
      logger.error('ProjectStore', '获取工程列表失败', err);
    } finally {
      isLoading.value = false;
    }
  }

  /** 将当前主工作区的视频和字幕原子落盘保存到 SQLite */
  async function saveCurrentProject(customName?: string): Promise<string | null> {
    if (!TauriBridge.isTauriEnv()) return null;
    const subtitleStore = useSubtitleStore();

    if (!subtitleStore.videoPath && !subtitleStore.videoUrl) {
      throw new Error('未导入视频，无法保存工程');
    }

    try {
      isSaving.value = true;
      const projectId = currentProjectId.value || `proj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const name = customName?.trim() || currentProjectName.value || subtitleStore.videoFileName || '未命名项目';
      const now = Date.now();

      const projectRecord: ProjectRecord = {
        id: projectId,
        name,
        videoPath: subtitleStore.videoPath || subtitleStore.videoUrl,
        videoHash: null,
        durationMs: Math.round((subtitleStore.videoDuration || 0) * 1000),
        width: subtitleStore.videoWidth || 1920,
        height: subtitleStore.videoHeight || 1080,
        fps: 30.0,
        roiJson: JSON.stringify(subtitleStore.roi),
        createdAt: now,
        updatedAt: now,
      };

      const subtitleRecords: SubtitleRecord[] = subtitleStore.subtitles.map((sub) => ({
        id: sub.id,
        projectId,
        startTimeMs: sub.startTime,
        endTimeMs: sub.endTime,
        textRaw: sub.text,
        textCorrected: null,
        confidence: sub.confidence,
        bboxJson: sub.roi ? JSON.stringify(sub.roi) : null,
        isReviewed: false,
        createdAt: now,
      }));

      await TauriBridge.dbSaveProject(projectRecord, subtitleRecords);
      currentProjectId.value = projectId;
      currentProjectName.value = name;
      await refreshProjectsList();
      logger.info('ProjectStore', `工程 [${name}] 保存成功，包含 ${subtitleRecords.length} 条字幕`);
      return projectId;
    } catch (err) {
      logger.error('ProjectStore', '保存工程失败', err);
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  /** 从 SQLite 载入指定工程到当前主工作区 */
  async function loadProject(projectId: string): Promise<ProjectDetail | null> {
    if (!TauriBridge.isTauriEnv()) return null;
    const subtitleStore = useSubtitleStore();

    try {
      isLoading.value = true;
      const detail = await TauriBridge.dbLoadProject(projectId);
      if (!detail) return null;

      currentProjectId.value = detail.project.id;
      currentProjectName.value = detail.project.name;

      // 还原 ROI 选区
      if (detail.project.roiJson) {
        try {
          const parsedRoi = JSON.parse(detail.project.roiJson);
          if (parsedRoi && typeof parsedRoi.x === 'number') {
            subtitleStore.roi = parsedRoi;
          }
        } catch {
          // ignore invalid json
        }
      }

      // 还原字幕条目
      subtitleStore.subtitles = detail.subtitles.map((sub) => ({
        id: sub.id,
        startTime: sub.startTimeMs,
        endTime: sub.endTimeMs,
        text: sub.textCorrected || sub.textRaw,
        confidence: Math.round(sub.confidence),
        roi: subtitleStore.roi,
      }));

      logger.info('ProjectStore', `工程 [${detail.project.name}] 载入成功`);
      return detail;
    } catch (err) {
      logger.error('ProjectStore', '加载工程失败', err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  /** 删除工程及其关联数据 */
  async function deleteProject(projectId: string): Promise<void> {
    if (!TauriBridge.isTauriEnv()) return;
    try {
      await TauriBridge.dbDeleteProject(projectId);
      if (currentProjectId.value === projectId) {
        currentProjectId.value = null;
        currentProjectName.value = '未命名项目';
      }
      await refreshProjectsList();
    } catch (err) {
      logger.error('ProjectStore', '删除工程失败', err);
      throw err;
    }
  }

  /** 导出当前或指定项目为 .vidglyph 独立工程包 */
  async function exportBundle(outputPath: string, targetProjectId?: string): Promise<string> {
    const resolvedId = targetProjectId || currentProjectId.value;
    if (!resolvedId) {
      await saveCurrentProject();
    }
    const finalId = targetProjectId || currentProjectId.value;
    if (!finalId) {
      throw new Error('未选定工程');
    }
    return await TauriBridge.exportProjectBundle(finalId, outputPath);
  }

  /** 导入 .vidglyph 独立工程包并激活 */
  async function importBundle(bundlePath: string): Promise<ProjectDetail> {
    const detail = await TauriBridge.importProjectBundle(bundlePath);
    await refreshProjectsList();
    await loadProject(detail.project.id);
    return detail;
  }

  return {
    currentProjectId,
    currentProjectName,
    projectsList,
    isSaving,
    isLoading,
    refreshProjectsList,
    saveCurrentProject,
    loadProject,
    deleteProject,
    exportBundle,
    importBundle,
  };
});
