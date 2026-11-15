# 阶段 0：基线收口记录

记录时间 2026-11-16 00:30 CST。分支 `feat/panel-v2`，HEAD `2884e9d`。本文件描述的是 **00:27 时工作区的快照**；那之后工作区里还有人在改（00:04 → 00:27 之间 15 个文件变了：`client.css`、`ui/*.css`、`ui/basic.tsx`、`toggle-group.tsx`、`choice-group.tsx`、`tag-input.tsx`、`agent-preset.tsx`、`form/theme/tokens.spec` 等），提交前请按第 4 节重跑一遍。

## 1. 未提交改动

- 已跟踪改动 74 个、删除 1 个（`src/client/controls.tsx`），合计 +3090 / −1679；未跟踪 53 个（`src/client/ui/` 整个新库、新页面与新测试、`docs/panel-v*` 计划、`docs/arch-compare.svg`、本阶段文件）。
- 根目录误建的 `git` 文件（内容是一次 `git status` 请求体）已不在工作区；`docs/stage0-commit.sh` 仍会兜底删除。
- `package.json` / `pnpm-lock.yaml` 新增 `axe-core` 4.14.0（`tests/a11y.spec.tsx` 用），必须和代码同一次提交。
- 拆两次提交：代码+依赖+测试+架构文档；计划审计+阶段 0 记录。`.hxoa/` 已在 `.gitignore`。

## 2. 三项检查（00:27 快照，干净拷贝上运行）

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `pnpm build` | 通过 |
| `vitest run` | **1382 过 / 14 败，共 1396，82 个文件** |

失败分两类：

- **环境/既有**（与本轮 UI 无关，干净检出同样失败）：`service-script.spec` 8（依赖本机进程/日志目录）、`sources.spec` 1（飞书事件消费）。
- **本轮在途**（阶段 1/2 的守卫测试先于实现写好，工作区正在改）：`tokens.spec` 3（组件层仍声明 `--hx-btn-focus` 等 9 个逐组件 focus token；有 token 被读但未定义）、`theme.spec` 1（有文字用了未过 AA 的 `label-dimmed`）、`docs.spec` 1（`007-architecture.md` 测试表漏 `tests/theme.spec.ts`）。
- 00:04 的上一个快照是 1379 过 / 12 败，当时还有 `styles.spec`（`dt-stack-list/-item/-order` 无组件使用）——已被修掉；`theme.spec` 当时全过。数字在跟着在途工作变，**这不是一条全绿的基线**。

结论：基线 = 「环境失败 9 条 + 在途守卫失败若干」。要拿全绿起点，二选一：(a) 先停在途工作，把 token/theme 守卫跑过再提交；(b) 照现状提交，把上面这份失败清单作为已知基线写进提交说明（`stage0-commit.sh` 采用 b，失败集合超出清单会提醒）。

## 3. 组件盘点

规则：`src/client/ui/` 是新库（`ui/index.ts` 统一出口，60 个导出）；旧 `controls.tsx` 已删，原 13 个组件迁入 ui/（表中「原 controls.tsx 迁入」），业务代码已无任何对它的引用，27 个业务文件全部从 `./ui/index.ts` 取。旧层 = `src/client/` 下各页面文件里手写的组件。

### 3.1 新库 ui/

| 组件 | 文件 | 来历 | 被谁使用（src/client，×=次数） | 测试引用 | 键盘模型 |
|---|---|---|---|---|---|
| `Icon` | `ui/icon.tsx` | 原 controls.tsx 迁入 | agent-overlays.tsx×12、app.tsx×2、command.tsx×2、console.tsx×6、eval.tsx×6、execution.tsx、overview.tsx×4、pipeline-view.tsx、presets.tsx×2、prompt-assembly.tsx×2、prompt-presets.tsx×11、prompts.tsx×8、repositories.tsx×2、rows.tsx×2、settings-kit.tsx×4、source.tsx×4、tag-input.tsx、thread.tsx×3、ticket.tsx×2、widgets.tsx×11、ui/basic.tsx、ui/button.tsx、ui/datatable.tsx×2、ui/disclosure.tsx、ui/infotip.tsx、ui/multiselect.tsx×2、ui/select.tsx×3、ui/toast.tsx、ui/basic.tsx、ui/button.tsx、ui/datatable.tsx×2、ui/disclosure.tsx、ui/infotip.tsx、ui/multiselect.tsx×2、ui/select.tsx×3、ui/toast.tsx | — | — |
| `Button` | `ui/button.tsx` | 原 controls.tsx 迁入 | agent-overlays.tsx×13、agent-preset.tsx×2、app.tsx×3、console.tsx×4、draft.tsx×3、eval.tsx×7、execution.tsx、overview.tsx×4、presets.tsx、prompt-assembly.tsx×2、prompt-presets.tsx×15、prompts.tsx×10、repositories.tsx×3、rows.tsx、settings-kit.tsx×4、source.tsx、thread.tsx、ticket.tsx、trigger.tsx、widgets.tsx×9、ui/basic.tsx×2、ui/overlay.tsx×2、ui/basic.tsx×2、ui/overlay.tsx×2 | ui.spec.tsx×4 | 原生按钮 |
| `IconButton` | `ui/button.tsx` | ui/ 原生 | app.tsx、console.tsx、prompts.tsx、ui/overlay.tsx×2、ui/toast.tsx、ui/overlay.tsx×2、ui/toast.tsx | ui.spec.tsx | 原生按钮 + aria-label |
| `Spinner` | `ui/button.tsx` | ui/ 原生 | — | — | — |
| `Input` | `ui/field.tsx` | 原 controls.tsx 迁入 | agent-overlays.tsx×5、agent-preset.tsx、deployment.tsx、eval.tsx×2、execution.tsx×2、prompt-presets.tsx×4、prompts.tsx、repositories.tsx、settings-kit.tsx×3、ui/datatable.tsx、ui/datatable.tsx | form.spec.tsx×6 | 原生 |
| `Textarea` | `ui/field.tsx` | ui/ 原生 | eval.tsx、repositories.tsx | form.spec.tsx、ui.spec.tsx | 原生，自动增高 |
| `Field` | `ui/field.tsx` | ui/ 原生 | agent-overlays.tsx×6、prompt-presets.tsx×4、repositories.tsx×2 | form.spec.tsx×19 | 结构件（label/hint/error 连线） |
| `ControlGroup` | `ui/field.tsx` | ui/ 原生 | agent-overlays.tsx、deployment.tsx、eval.tsx、prompts.tsx、settings-kit.tsx | form.spec.tsx | 结构件（group + aria-labelledby） |
| `FormField` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx、prompts.tsx、settings-kit.tsx | form.spec.tsx×2 | 上下文：id、aria-describedby/invalid/required 透传 |
| `FieldRoot` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx、settings-kit.tsx | — | 结构件 |
| `FieldHead` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx、settings-kit.tsx | — | 结构件 |
| `Label` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx、settings-kit.tsx | form.spec.tsx | 结构件 |
| `FieldHint` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx | form.spec.tsx | 结构件 |
| `FieldError` | `ui/field.tsx` | ui/ 原生 | prompts.tsx | form.spec.tsx | 结构件 |
| `Adornment` | `ui/field.tsx` | ui/ 原生 | — | — | 结构件 |
| `useFieldControl` | `ui/field.tsx` | ui/ 原生 | agent-preset.tsx、code-editor.tsx、tag-input.tsx、ui/basic.tsx、ui/choice-group.tsx、ui/select.tsx×2、ui/toggle-group.tsx×3、ui/basic.tsx、ui/choice-group.tsx、ui/select.tsx×2、ui/toggle-group.tsx×3 | — | hook：控件接入字段上下文 |
| `useFormField` | `ui/field.tsx` | ui/ 原生 | ui/multiselect.tsx、ui/multiselect.tsx | — | hook |
| `RadioGroup` | `ui/toggle-group.tsx` | ui/ 原生 | agent-overlays.tsx | form.spec.tsx×4 | radiogroup，方向键选值 |
| `CheckboxGroup` | `ui/toggle-group.tsx` | ui/ 原生 | agent-overlays.tsx×2 | form.spec.tsx×2 | group + role=checkbox，Space 切换 |
| `Select` | `ui/select.tsx` | ui/ 原生 | eval.tsx×2、prompts.tsx、repositories.tsx、settings-kit.tsx×3 | form.spec.tsx×2、ui.spec.tsx×2 | ↑↓/Home/End/Enter/Space/Esc/首字母 |
| `Combobox` | `ui/select.tsx` | ui/ 原生 | settings-kit.tsx、ui/multiselect.tsx×2、ui/multiselect.tsx×2 | form.spec.tsx、ui.spec.tsx×2 | ARIA 1.2 combobox，Enter/Esc/Tab |
| `matchOption` | `ui/select.tsx` | ui/ 原生 | — | — | — |
| `MultiSelect` | `ui/multiselect.tsx` | ui/ 原生 | agent-overlays.tsx、prompt-presets.tsx | form.spec.tsx、ui.spec.tsx×3 | Alt+←/→ 移位、Delete、Backspace |
| `reorder` | `ui/multiselect.tsx` | ui/ 原生 | — | ui.spec.tsx×4 | — |
| `Switch` | `ui/basic.tsx` | 原 controls.tsx 迁入 | eval.tsx、execution.tsx、repositories.tsx、settings-kit.tsx、source.tsx | form.spec.tsx×2、ui.spec.tsx | role=switch |
| `Badge` | `ui/basic.tsx` | ui/ 原生 | prompt-assembly.tsx、prompts.tsx、rows.tsx、settings-kit.tsx、ticket.tsx、widgets.tsx | — | — |
| `Tag` | `ui/basic.tsx` | 原 controls.tsx 迁入 | agent-overlays.tsx×5、agent-preset.tsx×2、console.tsx×3、presets.tsx×2、prompt-presets.tsx×5、rows.tsx、source.tsx、thread.tsx×6、ticket.tsx×2 | — | — |
| `Kbd` | `ui/basic.tsx` | ui/ 原生 | command.tsx×5 | ui.spec.tsx | 按平台显示 ⌘/Ctrl |
| `Card` | `ui/basic.tsx` | ui/ 原生 | — | — | — |
| `KeyValue` | `ui/basic.tsx` | ui/ 原生 | widgets.tsx | ui.spec.tsx | dl/dt/dd |
| `Skeleton` | `ui/basic.tsx` | ui/ 原生 | widgets.tsx×3、ui/datatable.tsx、ui/datatable.tsx | — | aria-hidden |
| `LoadingBlock` | `ui/basic.tsx` | ui/ 原生 | widgets.tsx | — | 朗读一次 |
| `EmptyState` | `ui/basic.tsx` | ui/ 原生 | widgets.tsx×2 | ui.spec.tsx | — |
| `SaveBar` | `ui/basic.tsx` | ui/ 原生 | — | — | 配合 ⌘/Ctrl+S |
| `StateDot` | `ui/status.tsx` | 原 controls.tsx 迁入 | console.tsx×5、widgets.tsx | — | — |
| `Dot` | `ui/status.tsx` | 原 controls.tsx 迁入 | app.tsx、source.tsx、ticket.tsx×2 | — | role=img |
| `FilterTabs` | `ui/choice-group.tsx` | ui/ 原生 | eval.tsx、execution.tsx、trigger.tsx | — | tablist 漫游焦点 |
| `Pill` | `ui/choice-group.tsx` | 原 controls.tsx 迁入 | console.tsx×4 | — | aria-pressed，无方向键 |
| `PageTabs` | `ui/choice-group.tsx` | 原 controls.tsx 迁入 | app.tsx | — | tablist 漫游焦点 |
| `SegmentedControl` | `ui/choice-group.tsx` | 原 controls.tsx 迁入 | eval.tsx、prompt-assembly.tsx、prompt-presets.tsx、prompts.tsx、settings-kit.tsx | form.spec.tsx×3、ui.spec.tsx | radiogroup，方向键选值 |
| `DisclosureRow` | `ui/disclosure.tsx` | 原 controls.tsx 迁入 | eval.tsx、execution.tsx、settings-kit.tsx、source.tsx×3、thread.tsx、ticket.tsx | — | Enter/Space，aria-expanded（无 aria-controls） |
| `InfoTip` | `ui/infotip.tsx` | 原 controls.tsx 迁入 | agent-preset.tsx、eval.tsx×4、execution.tsx×2、presets.tsx、settings-kit.tsx、source.tsx、widgets.tsx×2、ui/field.tsx、ui/field.tsx | — | Esc 关闭 |
| `Tabs` | `ui/tabs.tsx` | ui/ 原生 | eval.tsx、filtered.tsx、prompt-presets.tsx、prompts.tsx | ui.spec.tsx×2 | 漫游焦点 ←/→/Home/End |
| `TabPanel` | `ui/tabs.tsx` | ui/ 原生 | eval.tsx、prompts.tsx | ui.spec.tsx×2 | 随 Tabs |
| `Modal` | `ui/overlay.tsx` | 原 controls.tsx 迁入 | agent-overlays.tsx×2、app.tsx、command.tsx、prompt-presets.tsx×2 | controls.spec.tsx×2、ui.spec.tsx×2 | 焦点陷阱、Esc |
| `ConfirmDialog` | `ui/overlay.tsx` | ui/ 原生 | — | ui.spec.tsx | 焦点陷阱、Esc |
| `Drawer` | `ui/overlay.tsx` | ui/ 原生 | app.tsx、filtered.tsx | ui.spec.tsx×2 | 焦点陷阱、Esc、焦点归还 |
| `Popover` | `ui/overlay.tsx` | ui/ 原生 | widgets.tsx | ui.spec.tsx | Esc/点外部、焦点归还 |
| `Tooltip` | `ui/overlay.tsx` | ui/ 原生 | — | ui.spec.tsx×2 | 聚焦即显、Esc |
| `ToastProvider` | `ui/toast.tsx` | ui/ 原生 | provider.tsx | ui.spec.tsx | status/alert，悬停暂停 |
| `useToast` | `ui/toast.tsx` | ui/ 原生 | provider.tsx | ui.spec.tsx×2 | — |
| `DataTable` | `ui/datatable.tsx` | ui/ 原生 | filtered.tsx×2 | ui.spec.tsx×2 | 行漫游 ↑↓/Home/End/PgUp/PgDn/Enter |
| `viewRows` | `ui/datatable.tsx` | ui/ 原生 | — | ui.spec.tsx×4 | — |
| `compareValues` | `ui/datatable.tsx` | ui/ 原生 | — | — | — |
| `useOptimistic` | `ui/hooks.ts` | ui/ 原生 | — | ui.spec.tsx×2 | — |
| `useSaveShortcut` | `ui/hooks.ts` | ui/ 原生 | — | — | — |
| `useDraft` | `ui/hooks.ts` | ui/ 原生 | — | ui.spec.tsx×3 | — |
| `cx` | `ui/util.ts` | ui/ 原生 | ui/basic.tsx×4、ui/button.tsx×3、ui/choice-group.tsx×2、ui/datatable.tsx、ui/field.tsx×7、ui/overlay.tsx×2、ui/select.tsx、ui/status.tsx×4、ui/tabs.tsx×2、ui/toggle-group.tsx×2、ui/basic.tsx×4、ui/button.tsx×3、ui/choice-group.tsx×2、ui/datatable.tsx、ui/field.tsx×7、ui/overlay.tsx×2、ui/select.tsx、ui/status.tsx×4、ui/tabs.tsx×2、ui/toggle-group.tsx×2 | — | — |
| `returnFocus` | `ui/util.ts` | ui/ 原生 | — | — | — |
| `FOCUS_FALLBACK` | `ui/util.ts` | ui/ 原生 | app.tsx | ui.spec.tsx | — |

在页面里未被使用的导出：`Spinner`、`Adornment`、`useFormField`、`Card`、`SaveBar`、`ConfirmDialog`、`Tooltip`，以及工具函数 `matchOption`/`reorder`/`viewRows`/`compareValues`/`useOptimistic`/`useSaveShortcut`/`useDraft`/`cx`/`returnFocus`（多为库内部自用或仅测试用）。

### 3.2 旧层（页面里手写的组件）

| 组件 | 文件 | 被谁使用（src/client） | 测试引用 |
|---|---|---|---|
| `AgentOverlayField` | `agent-overlays.tsx` | eval.tsx、execution.tsx、presets.tsx×2 | — |
| `AgentPresetField` | `agent-preset.tsx` | eval.tsx、execution.tsx、presets.tsx×2 | — |
| `LiveIndicator` | `app.tsx` | — | — |
| `App` | `app.tsx` | index.tsx | fixtures/panel.tsx |
| `CodeEditor` | `code-editor.tsx` | agent-overlays.tsx、execution.tsx、prompt-assembly.tsx×2、prompt-presets.tsx、prompts.tsx×2 | code-editor.spec.tsx×4 |
| `CommandPalette` | `command.tsx` | app.tsx | — |
| `ConsolePage` | `console.tsx` | app.tsx | — |
| `DeploymentPage` | `deployment.tsx` | settings.tsx | — |
| `PluginConfig` | `deployment.tsx` | index.tsx | panel-deployment.spec.tsx |
| `SaveAll` | `draft.tsx` | settings.tsx | — |
| `SaveBar` | `draft.tsx` | deployment.tsx、eval.tsx×2、execution.tsx、presets.tsx×2、prompts.tsx、repositories.tsx、source.tsx | — |
| `EvalStatus` | `eval.tsx` | app.tsx | — |
| `EvalSettings` | `eval.tsx` | settings.tsx | — |
| `ExecutionStatus` | `execution.tsx` | app.tsx | — |
| `ExecutionSettings` | `execution.tsx` | settings.tsx | — |
| `FilteredTable` | `filtered.tsx` | source.tsx | — |
| `DroppedTable` | `filtered.tsx` | source.tsx | — |
| `KeptOutDrawer` | `filtered.tsx` | overview.tsx | — |
| `LiveContext` | `live.ts` | api.ts、provider.tsx×2 | — |
| `OverviewPage` | `overview.tsx` | app.tsx | — |
| `PipelineFocusProvider` | `pipeline-view.tsx` | settings.tsx | — |
| `FocusTracker` | `pipeline-view.tsx` | settings.tsx | — |
| `PipelineMap` | `pipeline-view.tsx` | console.tsx、settings.tsx | — |
| `PresetsSettings` | `presets.tsx` | settings.tsx | — |
| `PromptAssembly` | `prompt-assembly.tsx` | prompts.tsx | — |
| `PresetLayerEditor` | `prompt-assembly.tsx` | prompts.tsx | — |
| `PackLayerEditor` | `prompt-assembly.tsx` | prompts.tsx | — |
| `PresetSwatch` | `prompt-presets.tsx` | prompts.tsx | — |
| `PromptPresetBar` | `prompt-presets.tsx` | presets.tsx、prompts.tsx | — |
| `PromptsPage` | `prompts.tsx` | settings.tsx | — |
| `PanelProvider` | `provider.tsx` | app.tsx、deployment.tsx | — |
| `RepositoryTable` | `repositories.tsx` | source.tsx | — |
| `TicketLine` | `rows.tsx` | execution.tsx×2、overview.tsx、thread.tsx | — |
| `ThreadLine` | `rows.tsx` | ticket.tsx、trigger.tsx | — |
| `DecisionLine` | `rows.tsx` | eval.tsx、thread.tsx | — |
| `Earlier` | `rows.tsx` | thread.tsx、ticket.tsx | — |
| `SettingsProvider` | `settings-kit.tsx` | settings.tsx×2 | — |
| `Fields` | `settings-kit.tsx` | deployment.tsx、eval.tsx×2、execution.tsx、presets.tsx×2、source.tsx | panel-settings.spec.tsx |
| `Field` | `settings-kit.tsx` | deployment.tsx、eval.tsx×3、execution.tsx×4 | — |
| `ModelField` | `settings-kit.tsx` | eval.tsx、execution.tsx | — |
| `ConfigHistory` | `settings-kit.tsx` | eval.tsx、execution.tsx、source.tsx | — |
| `SourceField` | `settings-kit.tsx` | eval.tsx、source.tsx | — |
| `SettingsPage` | `settings.tsx` | app.tsx | — |
| `SourceSettings` | `source.tsx` | settings.tsx | — |
| `SourceStatus` | `source.tsx` | app.tsx | — |
| `TagInput` | `tag-input.tsx` | agent-overlays.tsx、execution.tsx | form.spec.tsx×3 |
| `ThreadPage` | `thread.tsx` | app.tsx | — |
| `TicketPage` | `ticket.tsx` | app.tsx | — |
| `TriggerStatus` | `trigger.tsx` | app.tsx | — |
| `When` | `widgets.tsx` | rows.tsx×4、thread.tsx、ticket.tsx×2 | — |
| `SetupMessage` | `widgets.tsx` | deployment.tsx、overview.tsx、source.tsx×3 | — |
| `Section` | `widgets.tsx` | deployment.tsx×3、eval.tsx×5、execution.tsx、overview.tsx×4、presets.tsx、thread.tsx×3、ticket.tsx×3 | — |
| `Hint` | `widgets.tsx` | agent-overlays.tsx×5、console.tsx×3、deployment.tsx×3、eval.tsx×2、execution.tsx×2、overview.tsx×2、presets.tsx、prompt-assembly.tsx×5、prompt-presets.tsx×3、prompts.tsx×11、repositories.tsx、settings-kit.tsx×6、source.tsx×2、thread.tsx×3、ticket.tsx×7、trigger.tsx | — |
| `LabelValue` | `widgets.tsx` | eval.tsx×2、execution.tsx×2、rows.tsx×3、source.tsx×3、ticket.tsx×3 | — |
| `KeyValues` | `widgets.tsx` | deployment.tsx、ticket.tsx×2 | — |
| `Empty` | `widgets.tsx` | agent-overlays.tsx、console.tsx、eval.tsx×2、execution.tsx、overview.tsx、prompt-presets.tsx、settings-kit.tsx、trigger.tsx | — |
| `MarkdownLite` | `widgets.tsx` | ticket.tsx×2 | — |
| `ClampText` | `widgets.tsx` | thread.tsx | — |
| `ConfirmButton` | `widgets.tsx` | console.tsx、prompt-presets.tsx、rows.tsx、thread.tsx、ticket.tsx | — |
| `SessionButton` | `widgets.tsx` | console.tsx、rows.tsx、ticket.tsx×2 | — |
| `ExternalLink` | `widgets.tsx` | ticket.tsx | — |
| `ActionLink` | `widgets.tsx` | rows.tsx、thread.tsx、ticket.tsx×2 | — |
| `StageMark` | `widgets.tsx` | rows.tsx×3、ticket.tsx | — |
| `LoadState` | `widgets.tsx` | app.tsx×2、console.tsx、eval.tsx、execution.tsx、filtered.tsx、overview.tsx×2、prompt-assembly.tsx、prompts.tsx×2、settings-kit.tsx×2、source.tsx、thread.tsx×2、ticket.tsx×2、trigger.tsx | — |
| `ListRegion` | `widgets.tsx` | eval.tsx、execution.tsx、trigger.tsx | — |
| `LoadMore` | `widgets.tsx` | eval.tsx、execution.tsx、trigger.tsx | — |
| `StatusHead` | `widgets.tsx` | console.tsx×2、eval.tsx、execution.tsx、source.tsx、trigger.tsx | — |
| `PageHead` | `widgets.tsx` | thread.tsx×2、ticket.tsx×2 | — |
| `CheckSetupButton` | `widgets.tsx` | deployment.tsx、overview.tsx、source.tsx | — |

### 3.3 重复与要在后续阶段处理的点

- `SaveBar`：`draft.tsx` 版被 7 个设置页使用，`ui/` 版无人用——阶段 5 二选一。
- 两个 `Field`：`ui/field.tsx`（新表单原子）与 `settings-kit.tsx` 的 `Field`——阶段 3 合并。
- 旧层手写的 `Hint`、`Section`、`LabelValue`、`LoadState`、`Empty`、`ConfirmButton` 与 ui 的 `InfoTip`/`Card`/`KeyValue`/`LoadingBlock`/`ConfirmDialog` 职责重叠。
- 无障碍缺口：`Pill` 只有 `aria-pressed`；`DisclosureRow` 无 `aria-controls`。
- 样式：`client.css` 与 `ui/ui.css` 并存；`--hx-ui-*` token 已大量使用，逐组件 focus token 正在收敛（见 tokens.spec）。

## 4. 亮暗对照截图

`docs/stage0-{settings,execution,console}-{light,dark}.png`，1440 宽整页。做法：把 `lib/client.js` 挂进 jsdom，用测试夹具数据渲染，导出 HTML 后用 Chromium 截图；暗色 = `body[data-ds-dark-theme]`。

局限：不在真实 DSH 宿主里（宿主颜色走 `theme.css` 回退值）、数据是假的、字体是 Noto Sans CJK。要做阶段 1/2 的像素级对比，需在真实宿主里按同样 6 个视图重拍一次替换这些图。

## 5. 提交

在仓库根目录：`sh docs/stage0-commit.sh`。它会删误建文件 → tsc → build → vitest（失败集合超出第 2 节清单会提示）→ 询问 y/N → 两次提交 → `git status --short` 应为空。
