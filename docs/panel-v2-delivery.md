# HX-superagent 面板重构 · 本轮完整交付（2026-11-14）

## 0. 结论
- 四项需求都已落进代码：预设自定义 + 多选叠加、前端实时性与交互、架构图定位编辑位置、监控台流转与调用链。组件库 v1 和审计文档也已就位。
- 验证（2026-11-14 03:3x 重新跑过）：`pnpm exec tsc --noEmit` 通过；`env LC_ALL=C pnpm exec vitest run` 共 72 个文件、1292 条测试全部通过；`pnpm build` 通过，只有 CJS 警告。
- 改动都在工作区根目录 `/home/hx/Loli/code/HXLoLis/components/HX-superagent`，共 55 个文件，+2949 / −70。**还没提交 git**，等你 review。工作区和我的镜像已做 md5 校验，内容一致。

## 1. 分工与各线结果
| 线 | 负责 | 结果 | 实际产出 |
|---|---|---|---|
| A [预设系统][全栈开发] / A-2 | 预设自定义、多选叠加 | A 线已关闭；A-2 投递时报 `conversation not found`（404），没有开工 | 由我直接实现，见第 2 节 |
| B [设计系统][前端开发] | 组件库、审计、视觉方向 | 邮件线失败，后来在工作区直接交付 | `src/client/ui/`、`docs/panel-v2-audit.md`、`docs/panel-v2-visual-direction.md`、`tests/ui.spec.tsx` |
| C [架构图][前端开发] | 架构图定位 | 没有产出 | 由我直接实现，见第 3 节 |
| D [监控台][全栈开发] | 实时流转、调用链 | 拒接 | 由我直接实现，见第 4 节 |
| E [验收][测试] | 验收 | 没有报告 | 由我补测试并跑全量验证，见第 7 节 |

各条邮件线都已关闭，现在没有在跑的线。所以“预设线做完”那一句没有附带交付物：预设部分实际是我写的，完整内容在下面第 2 节。

## 2. 预设线：Agent 预设可自定义、可多选叠加（能力包）
- **模型**：每个角色（评估 Session / 执行器）= 1 个 Agent 预设 + 有序叠加的 N 个能力包。能力包有两种作用：收窄工具（deny）和追加长期指令。叠加顺序决定指令的拼接顺序；重复的包会自动去重。
- **内置 4 个**：离线（no-web）、不派子 Agent（no-subagents）、谨慎改动（careful-review）、简洁回复（terse-replies）。
- **自定义**：在面板里可以新建、复制、编辑、删除能力包，也可以 JSON 导入导出。数据存在 KV 键 `settings-agent-overlays`，保存时会广播 settings 主题，其他打开的面板会实时刷新。
- **多选 UI**：评估页和执行页各有一条能力包条，支持多选、拖拽排序或 Alt+方向键排序。条下方实时显示该角色最终可用的工具，被收掉的工具划线，并标出是哪个包收的。
- **冲突校验**：执行器必须保留 read / bash / 写文件，主 Session 必须保留 read / bash。前端会提示，服务端 PUT 返回 409 并说明原因。只有面板（panel）有权修改这些设置（overlayGuard）。
- **接口**：`GET/PUT /agent-overlays`、`POST /agent-overlays/effective`（预览实际工具）。
- **生效位置**：`src/app/sessions.ts` 建 Session 时按能力包收窄工具，并在提示词里追加一段 `## Capability packs`。`src/policy.ts` 新增 `eval.overlays` / `executor.overlays`，默认为空，老配置无需迁移。
- **文件**：`src/app/agent-overlays.ts`（核心）、`src/client/agent-overlays.tsx`（UI），以及 `settings.ts`、`http.ts`、`api.ts`、`sessions.ts`、`policy.ts`、`kv.ts`、`core/errors.ts`、`client/locales.ts`（中英文案）、`client.css`、`eval.tsx`、`execution.tsx`。
- **测试**：`tests/agent-overlays.spec.ts`（5 条：解析、叠加、去重、冲突、有效工具），`tests/panel-execution.spec.tsx` 新增能力包 UI 用例，`tests/policy.spec.ts` 和 `panel-settings` 的期望已同步。
- **说明**：原有的 Prompt 预设本来就支持多选叠加，线上看不到是因为运行实例的构建旧了，重新 build 并重启即可。

## 3. 架构图：精确显示正在编辑哪一步的哪一段
- 设置页顶部的流程图升级成架构图。五个步骤下面列出各自的组成项：每个 Source 实例、Policy 规则、准入表、两个角色各自的模型 / Agent 预设 / 能力包 / 提示词、执行器并发、执行环境。数据来自真实配置，保存后实时更新（`src/client/architecture.ts`）。
- 聚焦任何字段、提示词段落或能力包时，对应的步骤和组成项会同时高亮，下方显示面包屑：“正在编辑 › 步骤 › 区块 › 字段 › 行号”（`PipelineFocus.part`）。
- 点击组成项会跳到对应的设置分组，滚动到位并聚焦。
- 文件：`pipeline.ts`、`pipeline-view.tsx`、`architecture.ts`、`settings.tsx`、`settings-kit.tsx`（新增 `useSettingsMaybe`），以及 `source.tsx`、`eval.tsx`、`execution.tsx`、`prompts.tsx`（`data-pipeline-part` 标记）。
- 测试：`tests/panel-settings.spec.tsx` 新增组成项和定位的断言。

## 4. 监控台：实时看到调度的外部流转和工单调用链
- **后端**：`src/app/live.ts` 新增 `stage` 主题和 `STAGE_NODES` / `stageOf`。`runtime.ts` 在 Engine 的每个领域事件里调用 `live.stage`，覆盖收到消息、开始评估、作出决定、开工单、执行器开工 / 收工、工单结束等，并标注所在步骤。
- **流转动效**：工作经过哪一步，那一步节点就会脉冲，进入它的连线也会流动（`pipeline-view.tsx`）。
- **调用链（TicketTrace）**：点执行槽位的工单名，或日志行上的追踪按钮，就会展开这张工单的完整调用链：流转步骤、每次工具调用、每个回合，按时间排列，并标出步骤之间的耗时（按事件自带的时间戳计算）。新事件实时追加（`console.tsx`）。
- 测试：`tests/live.spec.ts`（stage）、`tests/panel-console.spec.tsx`（流动和调用链，3 条）。

## 5. 实时性与交互
- Agent 预设目录、模型目录、Prompt 预设库、能力包库原来只加载一次，现在会订阅 settings / health / prompts 主题，并依赖重启计数，随保存和重启自动刷新，出错时可以一键重试（`agent-preset.tsx`、`settings-kit.tsx`、`prompt-presets.tsx`）。
- 设置页的 settings 只读一次，由架构图和各分组共享。

## 6. 组件库与设计（B 线交付）
- `src/client/ui/`：basic、button、datatable、field、hooks、icon、multiselect、overlay（Drawer / Dialog）、select（Combobox）、tabs、toast、ui.css、util、README。`provider.tsx` 已注入 `UI_STYLES` 和 `ToastProvider`。
- `docs/panel-v2-audit.md`：交互审计清单，按 P0 / P1 / P2 分级。
- `docs/panel-v2-visual-direction.md`：视觉方向。
- `tests/ui.spec.tsx`：组件库测试。

## 7. 验证
| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm exec tsc --noEmit` | 通过 |
| 全量测试 | `env LC_ALL=C pnpm exec vitest run` | 72 个文件 / 1292 条全部通过 |
| 构建 | `pnpm build` | 通过（仅 CJS 警告） |
| 文档 | `tests/docs.spec` | 6 条通过 |

注意：`environment.spec` 需要在 `LC_ALL=C` 下运行。

## 8. 没做完 / 下一步
1. X-1、SRC-1 以及两批组件迁移已在第 10 节完成；其余组件和审计项见第 10 节末尾。
2. 能力包已经可以授予 DSH 已注册的工具（见第 10 节），但不能新增 DSH 没注册的工具。要真正新建 DSH 级的 Agent 预设，需要 DSH 注册表支持运行时注册，或者改 `cordis.patch.yml` 后重启。
3. 还没在真实 DSH 实例上做端到端点测，也没有截图。上线前请在测试实例上执行 `pnpm build` 并重启，然后检查能力包、架构图、监控台这三处。

## 9. 改动文件清单（相对工作区根）
| 文件 | 行数 |
|---|---|
| `docs/005-panel.md` | +4 / −3 |
| `docs/007-architecture.md` | +9 / −0 |
| `docs/panel-v2-audit.md` | +168 / −0 |
| `docs/panel-v2-visual-direction.md` | +131 / −0 |
| `src/app/agent-overlays.ts` | +132 / −0 |
| `src/app/api.ts` | +5 / −0 |
| `src/app/http.ts` | +16 / −2 |
| `src/app/live.ts` | +32 / −2 |
| `src/app/runtime.ts` | +1 / −0 |
| `src/app/sessions.ts` | +23 / −5 |
| `src/app/settings.ts` | +12 / −2 |
| `src/client/agent-overlays.tsx` | +285 / −0 |
| `src/client/agent-preset.tsx` | +9 / −4 |
| `src/client/architecture.ts` | +46 / −0 |
| `src/client/client.css` | +43 / −2 |
| `src/client/console.tsx` | +77 / −9 |
| `src/client/eval.tsx` | +6 / −4 |
| `src/client/execution.tsx` | +7 / −5 |
| `src/client/live.ts` | +2 / −2 |
| `src/client/locales.ts` | +60 / −0 |
| `src/client/pipeline-view.tsx` | +42 / −11 |
| `src/client/pipeline.ts` | +3 / −1 |
| `src/client/prompt-presets.tsx` | +3 / −0 |
| `src/client/prompts.tsx` | +2 / −2 |
| `src/client/provider.tsx` | +3 / −1 |
| `src/client/settings-kit.tsx` | +5 / −1 |
| `src/client/settings.tsx` | +16 / −6 |
| `src/client/source.tsx` | +1 / −1 |
| `src/client/ui/README.md` | +47 / −0 |
| `src/client/ui/basic.tsx` | +96 / −0 |
| `src/client/ui/button.tsx` | +46 / −0 |
| `src/client/ui/datatable.tsx` | +140 / −0 |
| `src/client/ui/field.tsx` | +47 / −0 |
| `src/client/ui/hooks.ts` | +57 / −0 |
| `src/client/ui/icon.tsx` | +50 / −0 |
| `src/client/ui/index.ts` | +14 / −0 |
| `src/client/ui/multiselect.tsx` | +78 / −0 |
| `src/client/ui/overlay.tsx` | +135 / −0 |
| `src/client/ui/select.tsx` | +160 / −0 |
| `src/client/ui/tabs.tsx` | +41 / −0 |
| `src/client/ui/toast.tsx` | +67 / −0 |
| `src/client/ui/ui.css` | +229 / −0 |
| `src/client/ui/util.ts` | +117 / −0 |
| `src/core/errors.ts` | +6 / −0 |
| `src/kv.ts` | +3 / −0 |
| `src/policy.ts` | +7 / −0 |
| `tests/agent-overlays.spec.ts` | +53 / −0 |
| `tests/controls.spec.tsx` | +2 / −1 |
| `tests/fixtures/panel-server.ts` | +19 / −1 |
| `tests/live.spec.ts` | +14 / −1 |
| `tests/panel-console.spec.tsx` | +26 / −0 |
| `tests/panel-execution.spec.tsx` | +16 / −0 |
| `tests/panel-settings.spec.tsx` | +12 / −2 |
| `tests/policy.spec.ts` | +2 / −2 |
| `tests/ui.spec.tsx` | +322 / −0 |

文档同步：`docs/005-panel.md`（新增 Console 调用链 / 流动、Architecture map、Capability packs 三节和 stage 说明）、`docs/007-architecture.md`（新增模块行）。本报告：`docs/panel-v2-delivery.md`。

## 10. 追加轮（2026-11-14 03:5x）：统一保存、抽屉、组件库迁移、能力包授予工具
每一步都跑过远端 `tsc --noEmit` 和全量 vitest，通过后单独提交 git。
| 步骤 | 提交 | 内容 |
|---|---|---|
| SRC-1 | e199af4 | GitHub 仓库表改用 `useDraft` + 共享 `SaveBar`：草稿存在 sessionStorage，离开页面前提示，新行用临时 id，并发保存时合并 |
| X-1 | 12c6e97 | 列表进入详情改为右侧抽屉（`Location.drawer`、`DetailDrawer`）。宽度 ≥900px 时 Ticket / Thread 在抽屉中打开；Escape 或返回键先关闭抽屉；“Open as a full page” 可整页展开 |
| 迁移第一批 | 46cdabc | Button、Switch、Modal、Toast、Confirm、LoadState（支持重试）换成 `ui/` 组件，删除旧的 `.dt-btn/.dt-switch/.dt-modal/.dt-toast` |
| 迁移第二批 | 8ff4437 / f626ae9 / e10eeb4 | Tag 换成 Badge，KeyValues 换成 KeyValue，新增 Empty；eval、prompt-presets、prompts 的子标签改用 `ui/tabs`；原生 `<select>` 全部换成基于 `ui/select` 的 `Choice` |
| 能力包缺口 | 见 git log 最新一条 | 能力包新增 `allow` 字段，可以授予 DSH 已注册的工具（MCP / 插件工具）。多个包按顺序叠加，后面的包可以覆盖前面的结果；未注册的工具名不会生效，界面上有提示。界面增加“授予的工具”输入框、有效工具中标绿显示新增工具、链条芯片显示 +N；`sessions.ts` 的主 Session 和执行器都按最终工具集收放权限 |

验证：72 个文件 / 1295 条测试全部通过（新增 3 条），tsc 通过。

本轮之后还没做的：`DataTable`、`Combobox` 模型三级联动（SET-10）、`MultiSelect` 替换拖拽（PRM-4）、`Popover` 确认（SET-9 / THR-2）、`Skeleton`（X-11）、命令面板合并搜索（X-13 / CMD-1），以及 `docs/panel-v2-audit.md` 里其余 P0/P1 项。这些都还没有在真实 DSH 实例上做端到端点测。
