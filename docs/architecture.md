# 系统架构

本文描述 VidGlyph 当前实际运行路径、模块边界与依赖约束。

## 运行路径

```text
src/app.vue (组合根)
  ├─ TopToolbar  ── 导入视频 / 自动定位 / 开始或停止提取 / 模式切换
  ├─ VideoPlayer ── HTML5 播放 + VideoCanvasOverlay（8 点手柄 ROI 框选）
  └─ SubtitleTimelineList ── 搜索筛选 / AI 润色 / 导出
        │
        ├─ useWorkspaceController   提取编排、更新检查、演示数据
        ├─ useWorkspaceVideoImport  导入校验与状态重置（唯一入口）
        ├─ useAutoRoi               原生检测优先 + 本地像素算法兜底
        └─ useAiCorrection          批处理进度 / 并发 / 失败隔离 / 取消
              │
              ├─ Pinia：subtitleStore（会话）| securityStore（凭据）| extractionSettings（提取参数）
              │
              └─ core（领域层，无 Vue 依赖）
                    ├─ PipelineEngine     抽帧 + OCR + 进度/取消/汇总
                    ├─ ExtractionConfig   参数模型与校验（纯函数）
                    ├─ ExportValidator    导出前时间轴校验（纯函数）
                    ├─ AutoRoiDetector    字幕带定位算法（纯函数）
                    ├─ Exporter           多格式序列化
                    └─ AICorrector        Gemini / OpenAI 双协议润色
                          │
                          └─ services（适配器）：OCREngineFactory / TauriBridge / UpdaterService
                                │
                                └─ Tauri commands（Rust 原生能力）
```

## 模块职责

| 层 | 目录 | 职责 | 依赖约束 |
| --- | --- | --- | --- |
| 组合根 | `src/app.vue` | 装配组件、协调全局事件 | 只编排，不实现业务算法 |
| 用例编排 | `src/composables/` | 跨组件流程、生命周期、UI 状态 | 可依赖 core / stores / services |
| 状态 | `src/stores/` | 会话状态与配置的唯一事实来源 | 不依赖组件 |
| 领域 | `src/core/` | 提取管道、导出、校对、校验与算法 | **不依赖 Vue / Pinia / DOM** |
| 适配器 | `src/services/` | OCR 实现、Tauri IPC、更新服务 | 只依赖 utils |
| 工具 | `src/utils/` | 无状态纯函数（时间码、图像、检索） | 不依赖上层 |
| 原生端 | `src-tauri/src/commands/` | FFmpeg / 文件 / OCR / ROI / 系统能力 | 通过 `Result` 返回可读错误 |

跨层引用只允许通过各层 `index.ts` barrel：`@/core`、`@/stores`、`@/services`。

## 数据流与契约

1. **导入**：所有入口（点击 / 拖拽 / 原生对话框）统一走 `useWorkspaceVideoImport`，执行类型、体积与路径校验，并重置上一次会话状态。
2. **提取**：`useExtractionSettingsStore` 提供参数 → `validateExtractionOptions` 归一化 → `PipelineEngine` 抽帧 → OCR → 结果按 `minConfidence` 过滤 → 存入 `subtitleStore`，失败帧计入 `ExtractionRunSummary`。
3. **润色**：`useAiCorrection` 快照目标文本，按并发度调用 `AICorrector.correctOrThrow`，逐条成功即回写；失败保留明细，可单批重试；`AbortSignal` 贯穿到 fetch 实现取消。
4. **导出**：`validateSubtitleTimeline` 产出摘要 → `filterExportable` 剔除无效条目 → `core/Exporter` 序列化 → Tauri 原生保存（失败抛错，取消返回 null，均由 UI 明确反馈）。
5. **状态变更**：只有 Store 持有会话状态，组件与领域层不各自维护副本。

## Tauri 命令契约

| 命令 | 参数（JS 侧） | 返回 |
| --- | --- | --- |
| `get_video_metadata` | `path` | 时长 / 分辨率 / FPS / 编码 |
| `auto_detect_roi` | `videoPath, timestamp, videoWidth, videoHeight` | percent 坐标（桥接层归一化为 0~1） |
| `detect_scenes` | `videoPath, config{threshold, min_scene_length, frame_interval}` | `SceneChange[]` |
| `ocr_recognize` | `imagePath, lang, engine` | `OCRResult[]` |
| `save_file_dialog` / `open_file_dialog` | `title, defaultName, filters` | 绝对路径 |
| `write_text_file` / `read_text_file` | `path, content` | 写入结果 / 文件内容 |
| `check_system_dependencies` / `check_gpu_capability` | — | 环境能力 |

> 顶层参数为 camelCase（Tauri v2 约定），嵌套结构体字段沿用 Rust 侧 snake_case。路径校验只拦截「非绝对路径」与 `..` 遍历，不再限制目录白名单——导出到用户目录是主流程。

## 已知架构约束

- 核心算法保持无 Vue DOM 依赖，便于单元测试。
- 长任务必须具备进度、取消、成功与失败反馈。
- 所有视频导入入口共用同一验证与状态重置逻辑。
- 主工作台样式随应用本地打包，不依赖运行时 CDN。
- 同一业务状态只有一个 Store；Pinia id 全仓库唯一。
- 新增模块必须被入口可达，或显式登记在下方「待接线能力」中。

## 待接线能力（已测试、暂未接入 UI）

这些模块已具备单元测试但尚未有产品入口，属于路线图储备，新增 UI 时应直接接入而非重写：

| 模块 | 能力 | 接入位置建议 |
| --- | --- | --- |
| `core/SceneDetect.ts` | 场景切换检测（Rust `detect_scenes` 已就绪） | 按场景抽帧、跳过静止片段 |
| `core/Calibrator.ts` | 置信度校准 | 提取结果后处理 |
| `utils/image-kernel.ts` / `image-morph.ts` / `image-deskew.ts` | 图像形态学与去倾斜 | 已被 `image-preprocessor` 使用，可继续增强预处理 |
| `utils/detection.ts` | 空帧/场景滞回检测 | 跳过无字幕帧，降低 OCR 调用量 |
| `utils/lru-cache.ts` | LRU 缓存 | OCR 结果缓存 |
| `utils/time.ts` / `utils/confidence.ts` | 时间码与置信度分级 | 列表筛选与展示增强 |

死代码清理与分层收敛的完整记录见 [重构说明](/refactor-report)，阶段计划见 [项目改造计划](/refactor-plan)。
