<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none" @click.self="$emit('close')">
    <div ref="dialogRef" class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <!-- Modal Header -->
      <div class="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800">
        <h3 id="settings-title" class="text-sm font-bold text-slate-100 flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
          </svg>
          SubLens 全局设置与安全密钥管理
        </h3>
        <button class="text-slate-400 hover:text-white transition cursor-pointer" aria-label="关闭设置" title="关闭设置" @click="$emit('close')">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Modal Body -->
      <div class="p-6 space-y-5 text-xs text-slate-300">
        <!-- 云端 API Key -->
        <div class="space-y-1.5">
          <label class="font-semibold text-slate-200 block">云端 API Key (Gemini / OpenAI Vision)</label>
          <input
            v-model="tempApiKey"
            type="password"
            placeholder="输入您的 API Key"
            class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none transition font-mono"
          />
          <p class="text-[11px] text-slate-500">凭据仅在本地混淆保存，不等同于系统密钥链；请勿在共享设备保存长期密钥。</p>
        </div>

        <!-- Custom Cloud Endpoint -->
        <div class="space-y-1.5">
          <label class="font-semibold text-slate-200 block">云端 API Endpoint URL</label>
          <input
            v-model="tempEndpoint"
            type="text"
            placeholder="https://..."
            class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none transition font-mono"
          />
        </div>

        <!-- 提取参数（范围 / 采样 / 语言 / 阈值） -->
        <div class="space-y-3 p-3 bg-slate-950 border border-slate-800 rounded-xl">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-200">提取参数</span>
            <button
              class="text-[11px] text-teal-300 hover:text-teal-200 transition cursor-pointer"
              @click="onResetExtractionConfig"
            >
              恢复默认
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="space-y-1">
              <span class="text-[11px] text-slate-400">识别语言</span>
              <select
                v-model="configDraft.language"
                class="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-slate-100 text-xs focus:outline-none"
              >
                <option v-for="lang in supportedLanguages" :key="lang.value" :value="lang.value">
                  {{ lang.label }}
                </option>
              </select>
            </label>

            <label class="space-y-1">
              <span class="text-[11px] text-slate-400">采样间隔（秒）</span>
              <input
                v-model.number="configDraft.sampleInterval"
                type="number"
                :min="MIN_SAMPLE_INTERVAL"
                :max="MAX_SAMPLE_INTERVAL"
                step="0.5"
                class="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-slate-100 text-xs focus:outline-none font-mono"
              />
            </label>

            <label class="space-y-1">
              <span class="text-[11px] text-slate-400">起始时间（秒）</span>
              <input
                v-model.number="configDraft.startTime"
                type="number"
                min="0"
                step="1"
                class="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-slate-100 text-xs focus:outline-none font-mono"
              />
            </label>

            <label class="space-y-1">
              <span class="text-[11px] text-slate-400">结束时间（留空 = 到片尾）</span>
              <input
                :value="configDraft.endTime ?? ''"
                type="number"
                min="0"
                step="1"
                placeholder="到片尾"
                class="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-slate-100 text-xs focus:outline-none font-mono"
                @input="onEndTimeInput"
              />
            </label>

            <label class="space-y-1 col-span-2">
              <span class="text-[11px] text-slate-400">
                最低置信度阈值：{{ configDraft.minConfidence }}%（低于该值的识别结果会被丢弃）
              </span>
              <input
                v-model.number="configDraft.minConfidence"
                type="range"
                min="0"
                max="95"
                step="5"
                class="w-full accent-emerald-500"
              />
            </label>
          </div>

          <label class="flex items-center gap-2 text-[11px] text-slate-300">
            <input v-model="configDraft.preprocessDenoise" type="checkbox" class="accent-emerald-500" />
            本地引擎启用帧预处理降噪（提升低对比度字幕识别率，耗时略增）
          </label>

          <p v-if="configErrors.length > 0" class="text-[11px] text-rose-400">
            {{ configErrors[0] }}
          </p>
          <p v-else class="text-[11px] text-slate-500">
            当前配置合法，保存后对后续提取任务生效。
          </p>
        </div>

        <!-- 软件版本与自动检查更新 -->
        <div class="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
          <div>
            <span class="font-semibold text-slate-200 block">软件版本信息</span>
            <span class="text-[11px] text-slate-500 font-mono">当前安装版本: v0.0.1</span>
          </div>
          <button
            :disabled="isCheckingUpdate"
            class="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-teal-300 rounded-lg transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            @click="onCheckForUpdates"
          >
            <svg class="w-3.5 h-3.5 stroke-current" fill="none" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{{ isCheckingUpdate ? '检测中...' : '检查更新' }}</span>
          </button>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
        <button
          class="px-3 py-1.5 text-xs bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg transition cursor-pointer"
          @click="onClearCredentials"
        >
          抹除所有密钥
        </button>

        <div class="flex items-center gap-3">
          <button
            class="px-4 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
            @click="$emit('close')"
          >
            取消
          </button>
          <button
            class="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow transition cursor-pointer"
            @click="onSave"
          >
            保存并应用
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSecurityStore } from '../../stores';
import { useExtractionSettingsStore } from '../../stores';
import { UpdaterService } from '../../services';
import { useNotification } from '../../composables/useNotification';
import {
  MAX_SAMPLE_INTERVAL,
  MIN_SAMPLE_INTERVAL,
  SUPPORTED_LANGUAGES,
  validateExtractionOptions,
  type ExtractionOptions,
} from '../../core';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close', 'saved', 'updateFound']);

const securityStore = useSecurityStore();
const extractionSettings = useExtractionSettingsStore();

const tempApiKey = ref('');
const tempEndpoint = ref('');
const isCheckingUpdate = ref(false);
const dialogRef = ref<HTMLElement | null>(null);
const notifications = useNotification();

const supportedLanguages = SUPPORTED_LANGUAGES;
const configDraft = ref<ExtractionOptions>({ ...extractionSettings.options });
/** 草稿态校验：用户编辑时即时反馈，未通过则阻止保存 */
const configValidation = computed(() => validateExtractionOptions(configDraft.value, null));
const configErrors = computed(() => configValidation.value.errors);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      tempApiKey.value = securityStore.apiKey;
      tempEndpoint.value = securityStore.cloudEndpoint;
      configDraft.value = { ...extractionSettings.options };
      void nextTick(() => dialogRef.value?.focus());
    }
  }
);

/** 结束时间为空表示「直到片尾」，此时写入 null 而非 0 */
function onEndTimeInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (raw === '') {
    configDraft.value.endTime = null;
    return;
  }
  const parsed = Number(raw);
  configDraft.value.endTime = Number.isFinite(parsed) ? parsed : null;
}

function onResetExtractionConfig() {
  extractionSettings.reset();
  configDraft.value = { ...extractionSettings.options };
  notifications.info('提取参数已恢复默认值');
}

function onSave() {
  if (!configValidation.value.valid) {
    notifications.error(configErrors.value[0] ?? '提取参数不合法');
    return;
  }
  securityStore.saveApiKey(tempApiKey.value, tempEndpoint.value);
  extractionSettings.replace(configValidation.value.options);
  emit('saved');
  notifications.success('设置已保存');
  emit('close');
}

function onClearCredentials() {
  securityStore.clearCredentials();
  tempApiKey.value = '';
  emit('saved');
  notifications.success('已抹除本地密钥');
}

async function onCheckForUpdates() {
  isCheckingUpdate.value = true;
  try {
    const info = await UpdaterService.check();
    if (info.available) {
      emit('updateFound', info);
      emit('close');
    } else {
      notifications.success(`当前已是最新版本 v${info.currentVersion}`);
    }
  } catch {
    notifications.error('检测版本更新失败，请检查网络连接');
  } finally {
    isCheckingUpdate.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.isOpen && event.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>
