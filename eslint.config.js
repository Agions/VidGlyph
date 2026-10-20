import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'
import pluginVue from 'eslint-plugin-vue'

// Inline browser globals (replaces removed 'globals' package)
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  Promise: 'readonly',
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  structuredClone: 'readonly',
  ResizeObserver: 'readonly',
  // Animation / rAF globals
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  // DOM types
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  WheelEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLVideoElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLImageElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLFormElement: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLSpanElement: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  DragEvent: 'readonly',
}

const es2022Globals = {
  AggregateError: 'readonly',
  Atomics: 'readonly',
  FinalizationRegistry: 'readonly',
  globalThis: 'readonly',
  ImportMeta: 'readonly',
  Object: 'readonly',
  Promise: 'readonly',
  Reflect: 'readonly',
  SharedArrayBuffer: 'readonly',
  WeakRef: 'readonly',
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', '*.config.js'],
  },
  // Vue plugin (needed for rules)
  { plugins: { vue: pluginVue } },
  // Base JS config
  js.configs.recommended,
  // TypeScript files
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        ...es2022Globals,
      },
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-types': 'off',
      'no-useless-escape': 'off',
    },
  },
  // Vue SFC - must set parser AND processor
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
      globals: {
        ...browserGlobals,
        console: 'readonly',
        alert: 'readonly',
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        withDefaults: 'readonly',
      },
    },
    processor: pluginVue.processors['.vue'],
    rules: {
      'vue/comment-directive': 'off',
      'vue/jsx-uses-vars': 'off',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-useless-escape': 'off',
    },
  },
]
