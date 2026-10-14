# OCR 引擎与双模式设计

SubLens 支持离线与云端 API 双模式 OCR 引擎，解耦架构设计允许随时无缝切换。

---

## 双模式说明

### 1. 离线模式 (Local Engine)
- 基于 Tesseract.js 与 Native ONNX 引擎。
- 100% 本地运行，无需任何网络连接，彻底保障隐私。
- 支持 CJK 智能降噪与标点转换。

### 2. 云端 API 模式 (Cloud Vision Engine)
- 基于大语言视觉模型 (Gemini 1.5 Flash / OpenAI Vision / 自定义 API Endpoint)。
- 高精度识别复杂背景、艺术字体与模糊硬字幕。
- 密钥仅在本地进行可逆混淆保存，不等同于系统密钥链；识别时会发送给所配置的云端 API。
