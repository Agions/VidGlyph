//! SubLens - Rust Tauri 后端命令层
//!
//! ## 模块结构
//!
//! | 模块 | 说明 |
//! |------|------|
//! | `types` | 共享数据类型（ROI） |
//! | `utils` | 工具函数（临时文件、UUID） |
//! | `video` | 视频元数据 + 帧提取 |
//! | `scene` | 场景检测（Rust 原生 FFmpeg） |
//! | `export` | 导出命令入口 + 公共类型 |
//! | `export_fmt` | 12 格式具体实现 |
//! | `ffmpeg` | FFmpeg / ffprobe 输出解析 |
//! | `file` | 文件操作（对话框、读写） |
//! | `system` | 系统依赖检查（ffmpeg、tesseract）|
//! | `ocr_engine` | Rust 原生 OCR 引擎（ort + ONNX）|
//! | `ocr_export` | OCR + Export Tauri 命令入口 |
//! | `errors` | 统一错误消息常量 |
//! | `auto_roi` | 自动 ROI 检测（Rust 原生 image crate）|
//! | `timestamp` | 时间戳格式化（SRT/VTT/ASS/SSA/SBV）|
//! | `gpu` | GPU 检测（ONNX Runtime 原生）|
pub mod auto_roi;
pub mod errors;
pub mod export_fmt;
pub mod ffmpeg;
pub mod file;
pub mod gpu;
pub mod ocr_engine;
pub mod ocr_export;
pub mod scene;
pub mod system;
pub mod timestamp;
pub mod types;
pub mod utils;
pub mod video;
