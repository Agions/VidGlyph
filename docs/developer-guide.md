# 开发者指南

欢迎为 VidGlyph 贡献代码！本文档涵盖环境搭建、代码规范、测试和发布流程。

---

## 环境搭建

### 前置要求

| 工具 | 版本 | 安装方式 |
|:-----|:-----|:---------|
| Node.js | 18+ | [官网下载](https://nodejs.org/) |
| pnpm | 9+ | `npm install -g pnpm` |
| Rust | 1.82+ | [rustup](https://rustup.rs/) |
| FFmpeg | 6+ | 系统包管理器 |
| Git | 任意 | [官网下载](https://git-scm.com/) |

### 克隆仓库

```bash
git clone https://github.com/Agions/VidGlyph.git
cd vidglyph
```

### 安装依赖

```bash
# 前端依赖
pnpm install

# Rust 依赖
cd src-tauri
cargo fetch
cd ..
```

### 启动开发环境

```bash
pnpm tauri dev
```

---

## 项目结构

```
vidglyph/
├── src/
│   ├── app.vue                 # 组合根：装配组件与全局事件
│   ├── components/
│   │   ├── common/toast.vue    # 全局通知
│   │   ├── layout/             # TopToolbar / SettingsModal / UpdateModal
│   │   ├── subtitle/           # SubtitleTimelineList（结果列表 + 导出）
│   │   └── video/              # VideoPlayer / VideoCanvasOverlay（ROI 框选）
│   ├── composables/            # 用例编排：workspace / videoImport / aiCorrection / autoRoi / notification
│   ├── core/                   # 领域层：PipelineEngine、Exporter、AICorrector、校验与算法
│   │   ├── index.ts            # 领域层唯一对外 barrel
│   │   ├── ExtractionConfig.ts # 提取参数模型与校验（纯函数）
│   │   ├── ExportValidator.ts  # 导出前时间轴校验（纯函数）
│   │   └── AutoRoiDetector.ts  # 字幕带自动定位算法（纯函数）
│   ├── services/               # 基础设施适配：TauriBridge、UpdaterService、ocr/*
│   ├── stores/                 # Pinia：subtitle / security / extractionSettings
│   ├── utils/                  # 无状态工具与算法原语
│   └── types/                  # 领域类型（SubtitleItem / ROI / ExportFormat）
├── src-tauri/
│   ├── src/commands/           # Tauri 命令层（file / video / ocr_export / scene / auto_roi / gpu / system）
│   └── src/lib.rs              # 命令注册与启动
├── scripts/                    # 仓库维护脚本（可达性审计等）
├── docs/                       # 在线文档
└── package.json
```

### 模块依赖方向（禁止反向依赖）

```
components → composables → core / stores → services → src-tauri commands
                     ↘ utils（无状态，可被任意层使用）
```

- 组件不直接调用 Tauri IPC，统一经 `services/tauriBridge`。
- 领域层（`core/`）不依赖 Vue 与 Pinia，只通过端口（`ExtractionStatePort`）与状态层通信。
- 跨层引用只能走各层 `index.ts` barrel，禁止深入子文件路径。

---

## 代码规范

### 前端 (TypeScript + Vue)

- **类型检查**：`pnpm type-check`（`vue-tsc --noEmit`）零错误
- **Lint**：`pnpm lint` 零错误
- **测试**：`pnpm test` 全部通过；新增行为或修复回归时同步补充测试
- **组件语法**：使用 `<script setup lang="ts">`，组件文件名 PascalCase
- **类型**：避免 `any`，使用 `unknown` + 类型守卫
- **Composable**：使用 `use` 前缀，返回响应式对象；同一业务状态只允许一个 Store 作为事实来源
- **日志**：统一使用 `utils/logger`（带模块 tag），禁止裸 `console.log` 进入生产路径

### 后端 (Rust)

- **格式化**：`pnpm format:rust`（`cargo fmt`）
- **静态检查**：`pnpm lint:rust`（`cargo fmt --check` + `cargo clippy -D warnings`）
- **测试**：`pnpm test:rust`（`cargo test`）全部通过
- **错误处理**：返回 `Result<_, String>` 并携带可读上下文，避免 `unwrap()`
- **异步 I/O**：使用 `tokio::fs` 和 `tokio::process::Command`
- **命令契约**：顶层参数 camelCase，嵌套结构体字段与 Rust 侧保持 snake_case；改动签名后必须同步 `services/tauriBridge.ts`

### 可用脚本一览

| 脚本 | 作用 | 输出 |
|:-----|:-----|:-----|
| `pnpm dev` / `pnpm dev:tauri` | 前端热更新 / 桌面联调 | 开发服务器日志 |
| `pnpm check` | 前端质量门禁：type-check → lint → test | 退出码 0 即通过 |
| `pnpm check:all` | 前端 + Rust 全量门禁 | 退出码 0 即通过 |
| `pnpm build` / `pnpm build:tauri` | 前端产物 / 桌面安装包 | `dist/`、`src-tauri/target/release/bundle` |
| `pnpm test:coverage` | 覆盖率报告 | `coverage/lcov.info` |
| `pnpm audit:reachability` | 模块可达性审计（识别死代码） | 可达/不可达文件清单 |
| `pnpm depcheck` | 未使用依赖审计 | 依赖清单 |

### 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增批量导出功能
fix: 修复空帧导致的 OCR 崩溃
refactor: 提取图像处理工具模块
docs: 更新架构文档
test: 添加 Pipeline 阶段测试
```

---

## 测试

### 前端测试

```bash
pnpm test              # 运行全部测试
pnpm test:watch        # 监听模式
pnpm test:coverage     # 覆盖率报告
```

**测试规范：**
- 测试文件与源码同目录：`Pipeline.test.ts` 测试 `Pipeline.ts`
- 新增功能需附带单元测试
- 核心层和工具层要求 100% 函数覆盖

### 后端测试

```bash
cd src-tauri
cargo test
```

---

## 调试

### 前端调试

- Vue DevTools：浏览器插件，检查组件状态
- 日志：`console.log` / `console.warn` / `console.error`
- 网络：浏览器 DevTools Network 面板

### 后端调试

```bash
# 启用 debug 日志
RUST_LOG=debug pnpm tauri dev

# 查看 Tauri 事件
RUST_LOG=tauri=debug pnpm tauri dev
```

---

## 构建

### 开发构建

```bash
pnpm dev          # 仅前端（浏览器调试，自动 ROI 走本地像素算法）
pnpm dev:tauri    # 桌面联调（原生 OCR / ROI / 文件对话框可用）
```

### 生产构建

```bash
pnpm build:tauri  # 桌面安装包
pnpm build        # 仅前端静态产物
```

产物位置：

| 目标 | 路径 |
|:-----|:-----|
| 前端静态资源 | `dist/` |
| 桌面安装包 | `src-tauri/target/release/bundle/` |
| 覆盖率报告 | `coverage/` |

---

## 流程规范（输入 / 输出 / 执行标准）

| 环节 | 输入 | 执行 | 输出 | 执行标准 |
|:-----|:-----|:-----|:-----|:---------|
| 开发 | 需求 / 缺陷单 | 特性分支 + Conventional Commits | 可运行代码 + 单元测试 | `pnpm check` 通过；新增行为必须有测试 |
| 代码评审 | PR diff | 双人评审（架构 + 业务） | 评审意见 / 合并 | 无越层依赖；无新增重复实现；关键路径有错误处理 |
| 持续集成 | push / PR | `.github/workflows/ci.yml` 三作业并行 | 流水线结论 + 覆盖率产物 | 质量门禁、Rust 测试、桌面构建全部成功 |
| 构建 | 合并后的 main | `pnpm build:tauri` | 多平台安装包 | 构建日志无警告；安装包可启动 |
| 发布 | 版本 Tag | `.github/workflows/release.yml` | GitHub Release + `latest.json` | 更新清单与签名与 `tauri.conf.json` 公钥匹配 |
| 追溯 | 发布产物 | 提交历史 + CHANGELOG + 流水线记录 | 版本变更说明 | 每个产物可回溯到具体 commit 与流水线运行 |

---

## 发布

### 版本号

遵循 [Semantic Versioning](https://semver.org/)：
- `MAJOR.MINOR.PATCH`
- Breaking change → MAJOR
- 新功能 → MINOR
- Bug 修复 → PATCH

### 发布流程

1. 更新 `CHANGELOG.md`
2. 更新 `package.json` 版本号
3. 提交并推送
4. 创建 GitHub Release
5. CI 自动构建多平台安装包

---

## 贡献流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

**PR 要求（合并前必须全部勾选）：**

- [ ] `pnpm check` 全绿（type-check + lint + 单测）
- [ ] 改动 Rust 时 `pnpm lint:rust` 与 `pnpm test:rust` 全绿
- [ ] 新增功能附带单元测试；修复缺陷附带回归测试
- [ ] 新增模块已登记到对应层 `index.ts`，无越层 import
- [ ] 改动 Tauri 命令签名时同步更新 `services/tauriBridge.ts` 与文档
- [ ] 关键流程（导入 / 提取 / 导出 / 更新）的行为变更写进 `docs/refactor-report.md` 或 CHANGELOG
- [ ] PR 标题遵循 Conventional Commits

---

## 架构原则

- **分层架构**：组件 → 组合式函数 → 核心逻辑 → 工具函数
- **零 DOM 依赖**：核心层纯算法，可独立测试
- **单一职责**：每个模块只做一件事
- **可测试性**：核心逻辑 100% 单元测试覆盖
- **性能优先**：rAF 节流、LRU 缓存、响应式绕过
