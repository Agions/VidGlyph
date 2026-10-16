import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from './projectStore'
import { useSubtitleStore } from './subtitleStore'
import { TauriBridge } from '@/services'

describe('useProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('未导入视频时无法保存工程并抛错', async () => {
    vi.spyOn(TauriBridge, 'isTauriEnv').mockReturnValue(true)
    const projectStore = useProjectStore()
    const subtitleStore = useSubtitleStore()

    subtitleStore.videoPath = ''
    subtitleStore.videoUrl = ''

    await expect(projectStore.saveCurrentProject()).rejects.toThrow('未导入视频')
  })

  it('桌面端正常保存工程并生成 ID 与项目名称', async () => {
    vi.spyOn(TauriBridge, 'isTauriEnv').mockReturnValue(true)
    vi.spyOn(TauriBridge, 'dbSaveProject').mockResolvedValue('test_proj_1')
    vi.spyOn(TauriBridge, 'dbListProjects').mockResolvedValue([])

    const projectStore = useProjectStore()
    const subtitleStore = useSubtitleStore()

    subtitleStore.videoPath = '/videos/test.mp4'
    subtitleStore.videoFileName = 'test.mp4'
    subtitleStore.subtitles = [
      {
        id: 'sub_1',
        startTime: 1000,
        endTime: 3000,
        text: '测试字幕行',
        confidence: 90,
      },
    ]

    const savedId = await projectStore.saveCurrentProject('我的字幕项目')
    expect(savedId).toBeDefined()
    expect(projectStore.currentProjectName).toBe('我的字幕项目')
    expect(TauriBridge.dbSaveProject).toHaveBeenCalledTimes(1)
  })

  it('加载工程时完整还原视频选区与字幕条目', async () => {
    vi.spyOn(TauriBridge, 'isTauriEnv').mockReturnValue(true)
    vi.spyOn(TauriBridge, 'dbLoadProject').mockResolvedValue({
      project: {
        id: 'proj_loaded',
        name: '已保存的项目',
        videoPath: '/videos/saved.mp4',
        durationMs: 120000,
        width: 1920,
        height: 1080,
        fps: 30,
        roiJson: JSON.stringify({ x: 0.1, y: 0.8, width: 0.8, height: 0.15 }),
        createdAt: 1000,
        updatedAt: 2000,
      },
      subtitles: [
        {
          id: 'sub_saved_1',
          projectId: 'proj_loaded',
          startTimeMs: 500,
          endTimeMs: 2500,
          textRaw: '恢复的字幕',
          textCorrected: '恢复并修正的字幕',
          confidence: 98,
          isReviewed: true,
          createdAt: 1000,
        },
      ],
    })

    const projectStore = useProjectStore()
    const subtitleStore = useSubtitleStore()

    await projectStore.loadProject('proj_loaded')

    expect(projectStore.currentProjectId).toBe('proj_loaded')
    expect(projectStore.currentProjectName).toBe('已保存的项目')
    expect(subtitleStore.roi.x).toBe(0.1)
    expect(subtitleStore.subtitles.length).toBe(1)
    expect(subtitleStore.subtitles[0].text).toBe('恢复并修正的字幕')
  })

  it('删除当前选定工程时重置当前工程名称', async () => {
    vi.spyOn(TauriBridge, 'isTauriEnv').mockReturnValue(true)
    vi.spyOn(TauriBridge, 'dbDeleteProject').mockResolvedValue()
    vi.spyOn(TauriBridge, 'dbListProjects').mockResolvedValue([])

    const projectStore = useProjectStore()
    projectStore.currentProjectId = 'proj_to_delete'
    projectStore.currentProjectName = '将被删除的项目'

    await projectStore.deleteProject('proj_to_delete')

    expect(projectStore.currentProjectId).toBeNull()
    expect(projectStore.currentProjectName).toBe('未命名项目')
    expect(TauriBridge.dbDeleteProject).toHaveBeenCalledWith('proj_to_delete')
  })
})
