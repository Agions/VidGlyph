# 项目改造计划

## 审计结论

| 维度 | 现状 | 优先级 |
| --- | --- | --- |
| 可维护性 | 主入口曾同时承担演示数据、更新、提取和错误处理；存在双轨 Store/组件 | P0 |
| 可扩展性 | OCR 工厂和 Tauri 命令边界较好，但工作流未形成稳定用例层 | P0 |
| 用户友好 | 长任务有进度但原先无法取消；错误大量使用 `alert` 或仅写控制台 | P0 |
| 功能完整性 | 演示海报会遮挡后续导入的视频；异常时播放位置可能不恢复 | P0 |
| 可访问性 | 设置弹窗缺少 dialog 语义、Escape 关闭和初始焦点 | P1 |
| 工程质量 | 单元测试覆盖较广，但基线类型检查曾失败，文档测试数已过期 | P1 |
| 发布安全 | 界面样式依赖 Tailwind CDN，离线桌面环境存在退化风险 | P0 |

## 实施阶段

### 第一阶段：稳定主工作流（已完成）

- 将应用级流程迁移到 `useWorkspaceController`。
- 统一点击与拖拽两种视频导入路径。
- 提取支持取消，并在成功、空结果、取消和失败时给出通知。
- 无论提取成功或失败，都恢复视频原时间和播放状态。
- 修复演示海报遮挡新导入视频的问题。
- 修复 TypeScript 基线错误，新增视频格式测试。

### 第二阶段：收敛双轨架构

- [x] 用导入图确认 `stores/video.ts`、`stores/extraction.ts`、`stores/subtitle.ts` 的真实消费者。它们只服务于未接入入口的小写组件树；当前工作台使用 `subtitleStore.ts` 与 PascalCase 组件。
- [x] 为 Pipeline 建立 `ExtractionUseCase`、状态端口和 OCR 解析端口，隔离 Pinia Store 与具体 OCR 工厂，并补充成功、取消和配置错误测试。
- 分批迁移小写组件或删除未使用路径，每批均保留行为测试。
- 统一命名规则，组件使用 PascalCase，Composable 使用 `useXxx`。

验收标准：同一业务状态只有一个事实来源；无循环依赖；核心用例可替换 OCR 适配器测试。

### 第三阶段：完善专业工作流（已完成）

- [x] 增加提取范围、采样间隔和语言配置的工作区入口（工具栏快捷设置 + 全局设置弹窗双向同步）。
- [x] 自动 ROI 接入真实 Rust 命令，并修复检测范围与水平边界算法。
- [x] AI 校正支持批次进度、单条/批量失败重试、取消与模型协议适配。
- [x] 导出前提供格式、编码和时间轴校验摘要（重叠/乱序/异常区间诊断胶囊）。

验收标准：所有长任务可取消、可重试、可定位错误；配置可保存并可恢复默认值。全部达标。

### 第四阶段：离线发布与安全（进行中）

- [x] 使用本地工作区工具样式替代 `cdn.tailwindcss.com`。
- [x] 移除远程字体运行时依赖，改用系统字体栈。
- [x] 审核 Tauri capability：权限仅绑定 `main` 窗口；asset protocol 初始 scope 为空，文件对话框会在用户选中后由 Tauri 动态授权具体路径；移除未使用的 shell/opener 原生插件与 shell 权限。
- [x] 在 CI 加入 `type-check`、`lint`、前端测试、文档构建、完整 Rust test/clippy 和生产构建。

验收标准：断网可完整启动和使用离线功能；生产包不加载运行时代码 CDN；权限审计有记录。

## 资料依据

- Vue 官方 Composables 指南：https://vuejs.org/guide/reusability/composables
- Vue 官方状态管理指南：https://vuejs.org/guide/scaling-up/state-management
- Tauri 2 Capabilities：https://v2.tauri.app/security/capabilities/
- Tauri 2 Permissions：https://v2.tauri.app/security/permissions/
- WAI-ARIA Dialog Pattern：https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Nielsen Norman Group 可用性启发式：https://www.nngroup.com/articles/ten-usability-heuristics/
