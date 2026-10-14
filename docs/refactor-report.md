# 重构说明与关键变更点

本文记录本轮「重命名 + 架构收敛 + 功能补齐 + 流程规范」的完整对比，
供评审与后续维护作为行为基线。

## 1. 背景

SubLens 是一个 Tauri 2 + Vue 3 + Rust 桌面应用：从视频画面中提取硬编码字幕（离线 OCR 与云端视觉大模型双模式），
再经 AI 润色与多格式导出。重构前仓库同时存在两代前端实现：一套已接入入口的 PascalCase 组件，
以及一套小写命名的完整候选组件树（含 3 个重复 Store、15 个 composable），
并且经历了 Distill、CaptionFab 两次更名，品牌标识与本地存储键残留混用。

| 重构前问题 | 影响 |
| --- | --- |
| `stores/subtitle.ts` 与 `stores/subtitleStore.ts` 同名导出 `useSubtitleStore` 且 Pinia id 同为 `subtitle` | 两套 state/action 合并到同一实例，状态来源不可预期 |
| 149 个源文件中仅 25 个被生产入口可达，另有 90 个文件完全不可达 | 维护成本高、新人认知负担重、评审噪音大 |
| 导出写入被 Rust 侧目录白名单拦截，且前端忽略失败返回值 | 桌面端导出到用户目录失败却被提示「已导出」 |
| `AICorrector` 用 OpenAI 报文格式请求 Gemini 端点，且吞掉全部错误 | 默认配置下「AI 润色」不可用且无任何失败提示 |
| `TauriBridge.detectScenes` / `ocrRecognizeNative` 参数名与 Rust 命令不一致 | 调用必然失败（当时无消费者，属隐藏缺陷） |
| 文档声称本地引擎「支持预处理降噪」，但代码未接入 `image-preprocessor` | 功能与文档不符 |

## 2. 项目重命名：`Distill` → `SubLens`

### 命名论证

| 维度 | 说明 |
| --- | --- |
| 业务准确 | `Sub` = Subtitle，直指「字幕」；旧名 `Distill`（蒸馏）是隐喻，无法体现字幕提取 |
| 交互隐喻 | `Lens` = 透镜/取景，贴合「在视频画面上框选区域、逐帧观察」的核心交互 |
| 技术栈中立 | 不绑定 Tauri / OCR / Vue，离线与云端引擎都能容纳 |
| 可扩展 | 便于衍生 `SubLens Studio`（桌面）、`SubLens CLI`（批处理）、`SubLens Cloud`（服务端） |
| 检索友好 | 单一词、易拼读、无先前品牌的历史包袱（仓库曾用 `CaptionFab`、`Distill`） |

### 标识映射

| 位置 | 重构前 | 重构后 |
| --- | --- | --- |
| npm 包名 | `distill` | `sublens` |
| Rust crate / lib | `distill` / `distill_lib` | `sublens` / `sublens_lib` |
| 应用标识 | `com.distill.desktop` | `com.agions.sublens.desktop` |
| 产品名 / 窗口标题 | `Distill` | `SubLens` |
| 本地存储前缀 | `distill-*` / `distill_*` | `sublens-*` / `sublens_*` |
| 凭据盐值 | `Distill_Salt_2026_Secure` | `SubLens_Salt_2026_Secure` |
| 导出文件名兜底 | `distill_subtitles.<ext>` | `sublens_subtitles.<ext>` |
| 全局样式类 | `.distill-app` | `.sublens-app` |
| 日志前缀 | `[caption-fab]` | `[sublens]` |
| 导出元信息 | `Title: Distill Export` / `[by:Distill v4.0]` | `Title: SubLens Export` / `[by:SubLens v4.0]` |
| 仓库地址 | `github.com/Agions/Distill` | `github.com/Agions/SubLens` |

覆盖 64 个文件：前端源码、Rust 源码、`package.json`、`Cargo.toml`、`tauri.conf.json`、
capabilities、CI/CD 工作流、VitePress 配置、README 与全部指南文档、品牌 SVG 与预览页。

### 兼容措施（保证业务逻辑与用户数据不丢失）

1. **本地数据迁移**：新增 `utils/legacyStorage`，启动时把 `distill-*`、`distill_*`、`caption-fab*`、`captionfab*`
   键**复制**到 `sublens-*`（目标键已存在时不覆盖），旧键保留以便回滚；API Key 与提取配置因此无缝保留。
2. **仓库地址**：GitHub 更名后旧 URL 会自动 302 到新地址，`updater` 端点与文档链接同步更新为新仓库名。
3. **需人工执行的外部动作**（代码无法代为完成）：
   - GitHub 仓库改名为 `Agions/SubLens`（否则自动更新检查会 404）；
   - 工作区目录 `distill/` 改名为 `sublens/`；
   - 应用标识变更会导致数据目录从 `…/com.distill.desktop` 迁移到 `…/com.agions.sublens.desktop`，
     如需保留旧目录内的模型缓存，请在改名前手工拷贝。

## 3. 重构前后对比总览

| 指标 | 重构前 | 重构后 | 变化 |
| --- | --- | --- | --- |
| `src/` 源文件（ts + vue） | 149 | 86 | −63（清理 84 个文件、新增 21 个） |
| 生产入口可达文件 | 25 | 51 | +104%（模块被真实接线，而非堆在仓库里） |
| Vue 组件 | 56 | 8 | −48（删除整棵孤立候选树） |
| Pinia Store | 6（含 1 个 id 冲突） | 3（id 唯一） | 事实来源收敛 |
| 重复的导出格式实现 | 2 套（前端 4 种 / 领域 9 种） | 1 套（9 种） | 消除双实现 |
| 前端单元测试 | 25 文件 / 416 用例 | 30 文件 / 391 用例 | 用例更聚焦（删除死代码测试，新增 60+ 针对性用例） |
| 代码净变化 | — | — | 190 个文件、+4972 / −14745（净 −9773 行） |

> 说明：删除的 416 用例中有相当比例是验证已删除死代码的测试；新增测试覆盖提取配置校验、
> 导出前校验、自动 ROI 算法、AI 双协议、批处理编排、存储迁移与 Rust 路径校验。

## 4. 架构与代码组织变更

### 4.1 目录结构对比

```text
重构前                                   重构后
src/                                     src/
├── components/  (56 个 .vue, 两代混存)    ├── components/  (8 个 .vue, 仅入口可达)
│   ├── layout/  ├── subtitle/            │   ├── layout/   TopToolbar / SettingsModal / UpdateModal
│   ├── video/   ├── batch/  ...          │   ├── subtitle/ SubtitleTimelineList
├── composables/ (26 个, 15 个无人引用)     │   └── video/    VideoPlayer / VideoCanvasOverlay
├── core/        (16 个, 含双管道)          ├── composables/ (5 个，均为用例编排)
├── services/                              ├── core/        领域层 + 唯一 barrel
├── stores/      (6 个, 含 id 冲突)         ├── services/    适配层 + barrel
├── utils/       (31 个, 半数为死代码)      ├── stores/      状态层 + barrel
└── types/                                 ├── utils/       无状态工具（含新增 legacyStorage）
                                           └── types/
```

删除的代表性冗余：`core/Pipeline.ts`（339 行，被 `PipelineEngine` 取代）、
`composables/useOCREngine.ts`（被 `OCREngineFactory` 取代）、`utils/file.ts`（被 `TauriBridge` 取代）、
`stores/{video,extraction,subtitle}.ts`、整棵 `components/{batch,tabs,card,timeline}` 候选树。

### 4.2 分层依赖方向（可执行约束）

```
components → composables → core / stores → services → src-tauri commands
                     ↘ utils（无状态，任意层可用）
```

- 跨层引用统一走 `@/core`、`@/stores`、`@/services` barrel，逐文件路径引用已清理；
- 领域层通过端口 `ExtractionStatePort` 与状态层交互，不 import 任何 Pinia Store；
- 新增 `scripts/reachability-audit.mjs`（`pnpm audit:reachability`）以入口为起点计算可达闭包，
  可持续发现新增死代码与越界依赖。

### 4.3 单一事实来源

| 状态 | 归属 | 重构前 | 重构后 |
| --- | --- | --- | --- |
| 字幕结果 / 视频 / ROI / 进度 | `subtitleStore` | 与 3 个重复 Store 共存，id 冲突 | 唯一 |
| 凭据 | `securityStore` | 唯一 | 唯一 |
| 提取参数（语言/采样/范围/阈值/降噪） | `extractionSettings` | 无（`useWorkspaceController` 硬编码 `chi_sim+eng`） | 新 Store，唯一且持久化 |

### 4.4 日志与错误处理

- 统一 `utils/logger`（模块 tag 分级日志）替代散落的 `console.*`，生产构建由 esbuild `drop: ['console']` 兜底；
- 开发调试句柄 `window.__subtitleStore` 仅在 `import.meta.env.DEV` 挂载；
- 错误抛出统一保留 `cause`（`new Error(msg, { cause })`），ESLint 新增 `preserve-caught-error` 校验；
- UI 侧统一走 `useNotification`，不再有静默失败路径。
