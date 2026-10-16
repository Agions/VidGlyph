/**
 * @file updaterService.ts
 * @description Tauri 2.x 自动更新服务。
 * 封装客户端底层版本检测、GitHub Releases 描述文件比对、升级补丁解压替换与自动重启。
 */

import { TauriBridge } from './tauriBridge';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';

export interface UpdateHandle {
  downloadAndInstall(onEvent?: (event: DownloadEvent) => void): Promise<void>;
}

interface GitHubRelease {
  tag_name?: string;
  body?: string;
  published_at?: string;
}

export interface UpdateInfo {
  available: boolean;
  version?: string;
  currentVersion: string;
  notes?: string;
  pubDate?: string;
  rawUpdateObj?: UpdateHandle;
}

export class UpdaterService {
  public static readonly CURRENT_VERSION = '0.0.1';

  /** 检查是否有可用的新版本发布 */
  public static async check(): Promise<UpdateInfo> {
    const info: UpdateInfo = {
      available: false,
      currentVersion: this.CURRENT_VERSION,
    };

    if (TauriBridge.isTauriEnv()) {
      try {
        const modName = '@tauri-apps/plugin-updater';
        const updaterMod: typeof import('@tauri-apps/plugin-updater') = await import(/* @vite-ignore */ modName);
        const checkFn = updaterMod.check;
        if (typeof checkFn === 'function') {
          const update = await checkFn();
          if (update && update.available) {
            info.available = true;
            info.version = update.version;
            info.notes = update.body || '包含性能优化与已知问题修复。';
            info.pubDate = update.date;
            info.rawUpdateObj = update;
            return info;
          }
        }
      } catch (err) {
        console.warn('Tauri Native Updater 检测跳过，降级至 GitHub API 检测:', err);
      }
    }

    // 网页模式或原生态检查异常时的 GitHub API 检查兜底
    try {
      const response = await fetch('https://api.github.com/repos/Agions/VidGlyph/releases/latest');
      if (response.ok) {
        const data = await response.json() as GitHubRelease;
        const latestTag = data.tag_name ? data.tag_name.replace(/^v/, '') : '';
        if (latestTag && this.compareVersions(latestTag, this.CURRENT_VERSION) > 0) {
          info.available = true;
          info.version = latestTag;
          info.notes = data.body || 'VidGlyph · 字映 视频字幕光学解析工坊版本更新。';
          info.pubDate = data.published_at;
        }
      }
    } catch (e) {
      console.warn('GitHub API 版本检测跳过:', e);
    }

    return info;
  }

  /** 执行自动下载安装并重启应用 */
  public static async installUpdate(
    updateObj: UpdateHandle | undefined,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<boolean> {
    if (updateObj && typeof updateObj.downloadAndInstall === 'function') {
      try {
        let downloaded = 0;
        let total = 0;
        await updateObj.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === 'Started') {
            total = event.data.contentLength || 0;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength || 0;
            onProgress?.(downloaded, total);
          }
        });
        return true;
      } catch (err) {
        console.error('Tauri 自动更新下载安装失败:', err);
        throw err;
      }
    } else {
      // 网页模式直接跳转 GitHub Release 最新下载页面
      window.open('https://github.com/Agions/VidGlyph/releases/latest', '_blank');
      return false;
    }
  }

  /** 比较语义化版本号 (e.g. "0.0.2" vs "0.0.1") */
  private static compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}
