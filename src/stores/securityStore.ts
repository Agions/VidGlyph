/**
 * @file securityStore.ts
 * @description 凭据管理 Store。API Key 仅做本地可逆混淆，不提供系统密钥链级别的安全保护。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { TauriBridge } from '@/services/tauriBridge';

const STORAGE_KEY = 'vidglyph_sec_credentials_v1';
const SECRET_SALT = 'VidGlyph_Salt_2026_Secure';
const KEYRING_SERVICE = 'com.agions.vidglyph.ai';
const KEYRING_ACCOUNT = 'default_api_key';

function obfuscate(text: string): string {
  try {
    const combined = `${SECRET_SALT}:${text}`;
    return btoa(unescape(encodeURIComponent(combined)));
  } catch {
    return text;
  }
}

function deobfuscate(encoded: string): string {
  try {
    const decoded = decodeURIComponent(escape(atob(encoded)));
    if (decoded.startsWith(`${SECRET_SALT}:`)) {
      return decoded.replace(`${SECRET_SALT}:`, '');
    }
    return decoded;
  } catch {
    return '';
  }
}

export const useSecurityStore = defineStore('security', () => {
  const apiKey = ref<string>('');
  const cloudEndpoint = ref<string>('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent');
  const localModelPath = ref<string>('/models/tesseract/');

  /** 从系统密钥环或 LocalStorage 加载凭据 */
  async function loadCredentials() {
    // 优先尝试从操作系统安全密钥环加载
    if (TauriBridge.isTauriEnv()) {
      try {
        const secureKey = await TauriBridge.getSecureCredential(KEYRING_SERVICE, KEYRING_ACCOUNT);
        if (secureKey) {
          apiKey.value = secureKey;
        }
      } catch {
        // 安全降级
      }
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!apiKey.value && parsed.encApiKey) {
          apiKey.value = deobfuscate(parsed.encApiKey);
        }
        if (parsed.cloudEndpoint) {
          cloudEndpoint.value = parsed.cloudEndpoint;
        }
        if (parsed.localModelPath) {
          localModelPath.value = parsed.localModelPath;
        }
      } catch {
        // 静默捕获 JSON 解析错误
      }
    }
  }

  /** 持久化凭据：桌面端写入系统密钥环，并同步兜底存储配置 */
  function saveApiKey(newKey: string, endpoint?: string) {
    apiKey.value = newKey.trim();
    if (endpoint) {
      cloudEndpoint.value = endpoint.trim();
    }

    if (TauriBridge.isTauriEnv()) {
      TauriBridge.saveSecureCredential(KEYRING_SERVICE, KEYRING_ACCOUNT, apiKey.value).catch(() => {});
    }

    const payload = {
      encApiKey: obfuscate(apiKey.value),
      cloudEndpoint: cloudEndpoint.value,
      localModelPath: localModelPath.value,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  /** 一键抹除并彻底清除所有安全凭据 */
  function clearCredentials() {
    apiKey.value = '';
    if (TauriBridge.isTauriEnv()) {
      TauriBridge.deleteSecureCredential(KEYRING_SERVICE, KEYRING_ACCOUNT).catch(() => {});
    }
    localStorage.removeItem(STORAGE_KEY);
  }

  // 初始化自动加载
  loadCredentials();

  return {
    apiKey,
    cloudEndpoint,
    localModelPath,
    loadCredentials,
    saveApiKey,
    clearCredentials,
  };
});
