import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSupportedVideoFile, useWorkspaceVideoImport } from './useWorkspaceVideoImport'
import { useSubtitleStore } from '@/stores/subtitleStore'

vi.mock('@/services/tauriBridge', () => ({
  TauriBridge: { convertPathToAssetUrl: (path: string) => `asset://${path}` },
}))

describe('isSupportedVideoFile', () => {
  it('accepts files with a video MIME type', () => {
    expect(isSupportedVideoFile({ name: 'clip.bin', type: 'video/mp4' })).toBe(true)
  })

  it.each(['movie.mp4', 'movie.MKV', 'movie.mov', 'movie.webm'])('accepts supported extension %s', (name) => {
    expect(isSupportedVideoFile({ name, type: '' })).toBe(true)
  })

  it('rejects unrelated files', () => {
    expect(isSupportedVideoFile({ name: 'subtitle.srt', type: 'text/plain' })).toBe(false)
  })
})

describe('useWorkspaceVideoImport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores native path separately from the playback URL', () => {
    const store = useSubtitleStore()
    store.videoPoster = 'demo-poster'
    store.subtitles = [{ id: '1', startTime: 0, endTime: 1000, text: 'old', confidence: 90 }]

    const { importVideoPath } = useWorkspaceVideoImport()
    expect(importVideoPath('/videos/movie.mp4')).toBe(true)
    expect(store.videoPath).toBe('/videos/movie.mp4')
    expect(store.videoUrl).toBe('asset:///videos/movie.mp4')
    expect(store.videoPoster).toBe('')
    expect(store.subtitles).toEqual([])
  })
})
