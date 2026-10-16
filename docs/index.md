---
layout: home

hero:
  name: VidGlyph
  text: 专业视频硬字幕提取与蒸馏工具
  tagline: 从视频画面中蒸馏提炼字幕文本，支持离线与云端双模式。基于 Tauri + Vue 3 + TypeScript 构建。
  image:
    src: /logo.svg
    alt: VidGlyph
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 架构文档
      link: /architecture
    - theme: alt
      text: GitHub
      link: https://github.com/Agions/VidGlyph

features:
  - icon: ⚡
    title: 双模式 OCR 引擎
    details: 支持离线模式（Tesseract / Native ONNX）与云端 API 模式（Gemini / OpenAI Vision），无缝切换
  - icon: 🎯
    title: 8 点手柄区域框选
    details: 视频预览图层上交互式拖拽、缩放框选硬字幕 ROI 选区，坐标归一化 (0~1)
  - icon: 🔒
    title: 本地凭据管理
    details: API Key 仅做本地可逆混淆并支持一键清除；共享设备请勿保存长期密钥
  - icon: 🎬
    title: 暗黑 Studio UI
    details: 沉浸式影视后期风格双栏界面，左侧视频框选预览 + 右侧时间轴字幕卡片列表
  - icon: 📦
    title: 多格式实时导出
    details: 支持一键导出为 SRT、VTT、TXT、JSON 等多种专业字幕与文本格式
  - icon: 🛡️
    title: 模块化 5 层架构
    details: 严格按照 SOLID 原则分层设计（Core / Services / UI / Config / Utils），完全解耦并具备完整的 TS 类型定义
---

## 项目概览

| 指标 | 数据 |
|:-----|:-----|
| 质量基线 | TypeScript、ESLint、Vitest 与 Rust 测试全通过 |
| 导出格式 | SRT / VTT / TXT / JSON |
| 架构设计 | 5 层解耦抽象与依赖倒置 |
| 技术栈 | Tauri 2.x + Vue 3.5 + TypeScript 5.x |

---

## 快速链接

- [📖 快速开始](/guide/getting-started) — 安装与运行
- [🏗️ 架构文档](/architecture) — 系统设计
- [👨‍💻 开发者指南](/developer-guide) — 贡献代码
- [📚 API 参考](/api/pipeline) — 核心模块 API
- [📝 更新日志](/changelog) — 版本变更
