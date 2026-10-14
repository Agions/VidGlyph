# 更新日志 (Changelog)

所有项目变更都记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [0.0.1] - 2026-08-06

### Major Architecture Refactoring & SubLens Branding

- **全新项目重命名与品牌升级**：全面更名为 **SubLens**，重设全套矢量图标、品牌预览及桌面应用 App Icons。
- **5层解耦架构实施**：按 SOLID 原则划分为 Core Engine / API Service / UI Rendering / Config Manager / Utils 独立模块。
- **双模式 OCR 抽象**：`IOCREngineProvider` 支持离线本地提取（Tesseract/Native ONNX）与云端 API 模式（Gemini / OpenAI Vision）无缝切换。
- **8 点 ROI 手柄选区**：`VideoCanvasOverlay.vue` 提供 Canvas / SVG 叠加交互图层，支持 8 点手柄缩放与 0~1 坐标归一化计算。
- **本地凭据管理**：`securityStore.ts` 对 API Key 做本地可逆混淆并支持一键清除；该机制不等同于系统密钥链。
- **暗黑 Studio 影视 UI**：双栏主工作台布局，左侧视频预览 + 右侧字幕时间轴卡片与 SRT/VTT 导出。
- **GitHub 远程同步**：仓库名称同步为 `Agions/SubLens`，清理所有历史发布版本与标签，更新 Topics 与描述。
