# 阶段 0：基线收口记录

记录时间 2026-11-16 01:00 CST（替换 00:30 的版本）。分支 `feat/panel-v2`，HEAD `908923a`（00:29 提交，上一版阶段 0 记录说的两次提交已经合成这一次落地）。

## 1. 未提交改动（908923a 之后这一轮）

一组 a11y / 键盘的收尾，13 个文件，+96 / −33，`git diff` 从 00:47 到 01:00 没有再变：

- 页面：`app.tsx` 加「跳到主内容」链接（WCAG 2.4.1），`client.css` 加 `.dt-skip`，`locales.ts` 加 `skipToMain`。
- 组件：`ui/disclosure.tsx` 打开时 `aria-controls` 指向内容；`ui/tokens.css` 去掉共享的 `--hx-ui-focus-ring`、`--hx-ui-focus-inset`。
- 测试：axe 判定抽到 `tests/fixtures/axe.ts`（新），`tests/a11y-layers.spec.tsx`（新）检查每个浮层和复合控件的打开态；`keyboard.spec.tsx` 加跳转链接和 Alt+方向键给能力包排序；`fixtures/keyboard.ts` 从焦点区域继续 Tab；`ui.spec.tsx` 补用例。
- 文档：`007-architecture.md` 测试表补 `theme.spec.ts`、`a11y-layers.spec.tsx`；`010-keyboard.md` 补跳转链接和 `aria-controls`。
- 根目录 `git` 文件是误建的（一次 git 请求体），不进提交，`stage0-commit.sh` 会删掉它。

这一轮修掉了 1 条失败（`docs.spec` 的测试表），没有引入新失败：在 HEAD 上单跑 tokens/theme/docs/styles 是 5 败，加上这一轮是 4 败。

## 2. 三项检查（01:00 快照，镜像拷贝上 `pnpm install --frozen-lockfile` 后运行）

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过 |
| `LC_ALL=C pnpm exec vitest run` | **1392 过 / 13 败，共 1405，83 个文件** |

失败清单（这就是基线；`stage0-commit.sh` 会拿实际失败和它比，多一条就不提交）：

- 环境类 9 条，和 UI 无关：`service-script.spec` 8（本机进程、tmux、日志目录），`sources.spec` 1（飞书 consumer 的 stdout/stderr 顺序）。
- 守卫先于实现 4 条，属于阶段 1/2：
  - `tokens.spec` › 组件层读到 10 个没定义的 token：`--hx-input-adorn-hover-bg`、`--hx-listbox-empty-fg`、`--hx-chip-remove-hover-bg`、`--hx-tab-hover-fg`、`--hx-modal-error-fg`、`--hx-toast-action-hover-bg`、`--hx-pill-active-fg`、`--hx-segment-fg`、`--hx-segment-active-fg`（两处）。
  - `tokens.spec` › 焦点（2 条）：还声明着白名单外的 `--hx-c-focus`、`--hx-ui-focus-offset-tight`、`--hx-ui-focus-halo`、`--hx-ui-focus-halo-wide`。
  - `theme.spec` › 有文字仍用 `label-dimmed`（不过 AA）。

00:27 是 1382 过 / 14 败；差的那条就是第 1 节修掉的 `docs.spec`。

## 3. 组件盘点

### 3.1 结论

- 旧 `src/client/controls.tsx` 已在 908923a 删除，`src` 和 `tests` 里没有任何对它的引用。原来的 13 个组件（`Icon`、`Button`、`Tag`、`Pill`、`SegmentedTabs`→`PageTabs`、`SegmentedControl`、`Input`、`Switch`、`StateDot`、`Dot`、`DisclosureRow`、`Modal`、`InfoTip`）都已迁进 `ui/`。
- 新库 `ui/`：68 个导出，13 个从 controls.tsx 迁入，55 个是 ui/ 原生。28 个页面文件只通过 `./ui/index.ts` 引用。
- 旧层：页面文件里手写的 92 个导出（函数组件 67、hook 21、类 2、常量 2）。
- 同名两份，要在后续阶段收成一份：
  - `Field`：`ui/field.tsx`（agent-overlays、prompt-presets、repositories 用）和 `settings-kit.tsx`（deployment、eval、execution 用）→ 阶段 3。
  - `SaveBar`：`draft.tsx` 版被 7 个设置页用，`ui/basic.tsx` 版没人用 → 阶段 5 二选一。
  - `useDraft`：`draft.tsx` 版被页面用，`ui/hooks.ts` 版只有测试用 → 阶段 5。
- 页面没用到的 ui 组件：`Card`、`SaveBar`、`Spinner`、`Adornment`、`ConfirmDialog`、`Tooltip`（其余未用的是库内部工具或只给测试用）。
- 页面层没人引用的导出：`LiveIndicator`、`useOverlayLibrary`、`LiveClient`、`useLiveClient`。
- 没有任何测试引用的 ui 组件：`Badge`、`Tag`、`Card`、`Skeleton`、`LoadingBlock`、`SaveBar`、`Spinner`、`FilterTabs`、`Adornment`、`FieldRoot`、`FieldHead`、`Icon`、`InfoTip`、`StateDot`、`Dot`。
- 和 00:30 版相比：`DisclosureRow` 已有 `aria-controls`，`Pill` 进了 `a11y-layers.spec`；旧表里 `ui/` 内部引用重复列了两次，这版没有了。

### 表怎么来的

`node scripts/component-inventory.mjs`（`--json` 输出 JSON）。用 TypeScript AST 读 `src/client` 每个文件的导出和相对路径 import，`./ui/index.ts` 的再导出追到真正声明它的文件，「×n」是引用方文件里这个名字出现的次数（不算 import 那一行）。后续阶段重跑一次就能对比。

### 3.2 新库 `src/client/ui/`（68 个导出）

| Component | Kind | File | Origin | Used by (src/client, ×uses) | Tests |
|---|---|---|---|---|---|
| `Switch` | function | `ui/basic.tsx` | moved from controls.tsx | eval.tsx, execution.tsx, repositories.tsx, settings-kit.tsx, source.tsx | a11y-layers.spec.tsx, form.spec.tsx×2, ui.spec.tsx |
| `Badge` | function | `ui/basic.tsx` | ui/ native | prompt-assembly.tsx, prompts.tsx, rows.tsx, settings-kit.tsx, ticket.tsx, widgets.tsx | — |
| `Tag` | function | `ui/basic.tsx` | moved from controls.tsx | agent-overlays.tsx×5, agent-preset.tsx×2, console.tsx×3, presets.tsx×2, prompt-presets.tsx×5, rows.tsx, source.tsx, thread.tsx×6, ticket.tsx×2 | — |
| `Kbd` | function | `ui/basic.tsx` | ui/ native | command.tsx×5 | ui.spec.tsx |
| `Card` | function | `ui/basic.tsx` | ui/ native | — | — |
| `KeyValue` | function | `ui/basic.tsx` | ui/ native | widgets.tsx | ui.spec.tsx |
| `Skeleton` | function | `ui/basic.tsx` | ui/ native | ui/datatable.tsx, widgets.tsx×3 | — |
| `LoadingBlock` | function | `ui/basic.tsx` | ui/ native | widgets.tsx | — |
| `EmptyState` | function | `ui/basic.tsx` | ui/ native | widgets.tsx×2 | a11y-layers.spec.tsx, ui.spec.tsx |
| `SaveBar` | function | `ui/basic.tsx` | ui/ native | — | — |
| `Spinner` | function | `ui/button.tsx` | ui/ native | — | — |
| `Button` | const | `ui/button.tsx` | moved from controls.tsx | agent-overlays.tsx×13, agent-preset.tsx×2, app.tsx×3, console.tsx×4, draft.tsx×3, eval.tsx×7, execution.tsx, overview.tsx×4, presets.tsx, prompt-assembly.tsx×2, prompt-presets.tsx×15, prompts.tsx×10, repositories.tsx×3, rows.tsx, settings-kit.tsx×4, source.tsx, thread.tsx, ticket.tsx, trigger.tsx, ui/basic.tsx×2, ui/overlay.tsx×2, widgets.tsx×9 | ui.spec.tsx×4 |
| `IconButton` | const | `ui/button.tsx` | ui/ native | app.tsx, console.tsx, prompts.tsx, ui/overlay.tsx×2, ui/toast.tsx | ui.spec.tsx |
| `FilterTabs` | function | `ui/choice-group.tsx` | ui/ native | eval.tsx, execution.tsx, trigger.tsx | — |
| `Pill` | function | `ui/choice-group.tsx` | moved from controls.tsx | console.tsx×4 | a11y-layers.spec.tsx, ui.spec.tsx |
| `PageTabs` | function | `ui/choice-group.tsx` | moved from controls.tsx | app.tsx | controls.spec.tsx |
| `SegmentedControl` | function | `ui/choice-group.tsx` | moved from controls.tsx | eval.tsx, prompt-assembly.tsx, prompt-presets.tsx, prompts.tsx, settings-kit.tsx | a11y-layers.spec.tsx, form.spec.tsx×3, ui.spec.tsx |
| `compareValues` | function | `ui/datatable.tsx` | ui/ native | — | — |
| `viewRows` | function | `ui/datatable.tsx` | ui/ native | — | ui.spec.tsx×3 |
| `DataTable` | function | `ui/datatable.tsx` | ui/ native | filtered.tsx×2 | a11y-layers.spec.tsx, ui.spec.tsx×2 |
| `DisclosureRow` | function | `ui/disclosure.tsx` | moved from controls.tsx | eval.tsx, execution.tsx, settings-kit.tsx, source.tsx×3, thread.tsx, ticket.tsx | a11y-layers.spec.tsx, ui.spec.tsx |
| `useFormField` | hook | `ui/field.tsx` | ui/ native | ui/multiselect.tsx | — |
| `FormField` | function | `ui/field.tsx` | ui/ native | agent-preset.tsx, prompts.tsx, settings-kit.tsx | form.spec.tsx×2 |
| `useFieldControl` | hook | `ui/field.tsx` | ui/ native | agent-preset.tsx, code-editor.tsx, tag-input.tsx, ui/basic.tsx, ui/choice-group.tsx, ui/select.tsx×2, ui/toggle-group.tsx×2 | — |
| `Label` | function | `ui/field.tsx` | ui/ native | agent-preset.tsx, settings-kit.tsx | form.spec.tsx |
| `FieldHint` | function | `ui/field.tsx` | ui/ native | agent-preset.tsx | form.spec.tsx |
| `FieldError` | function | `ui/field.tsx` | ui/ native | prompts.tsx | form.spec.tsx |
| `Adornment` | function | `ui/field.tsx` | ui/ native | — | — |
| `Field` | function | `ui/field.tsx` | ui/ native | agent-overlays.tsx×6, prompt-presets.tsx×4, repositories.tsx×2, settings-kit.tsx×2 | form.spec.tsx×19 |
| `FieldRoot` | function | `ui/field.tsx` | ui/ native | agent-preset.tsx, settings-kit.tsx | — |
| `FieldHead` | function | `ui/field.tsx` | ui/ native | agent-preset.tsx, settings-kit.tsx | — |
| `ControlGroup` | function | `ui/field.tsx` | ui/ native | agent-overlays.tsx, deployment.tsx, eval.tsx, prompts.tsx, settings-kit.tsx | form.spec.tsx |
| `Input` | const | `ui/field.tsx` | moved from controls.tsx | agent-overlays.tsx×5, agent-preset.tsx, deployment.tsx, eval.tsx×2, execution.tsx×2, prompt-presets.tsx×4, prompts.tsx, repositories.tsx, settings-kit.tsx×3, ui/datatable.tsx | form.spec.tsx×6 |
| `Textarea` | const | `ui/field.tsx` | ui/ native | eval.tsx, repositories.tsx | form.spec.tsx, ui.spec.tsx |
| `useOptimistic` | hook | `ui/hooks.ts` | ui/ native | — | ui.spec.tsx |
| `useSaveShortcut` | hook | `ui/hooks.ts` | ui/ native | — | — |
| `useDraft` | hook | `ui/hooks.ts` | ui/ native | — | ui.spec.tsx×2 |
| `Icon` | function | `ui/icon.tsx` | moved from controls.tsx | agent-overlays.tsx×12, app.tsx×2, command.tsx×2, console.tsx×6, eval.tsx×6, execution.tsx, overview.tsx×4, pipeline-view.tsx, presets.tsx×2, prompt-assembly.tsx×2, prompt-presets.tsx×11, prompts.tsx×8, repositories.tsx×2, rows.tsx×2, settings-kit.tsx×4, source.tsx×4, tag-input.tsx, thread.tsx×3, ticket.tsx×2, ui/basic.tsx, ui/button.tsx, ui/datatable.tsx×2, ui/disclosure.tsx, ui/infotip.tsx, ui/multiselect.tsx×2, ui/select.tsx×3, ui/toast.tsx, widgets.tsx×11 | — |
| `InfoTip` | function | `ui/infotip.tsx` | moved from controls.tsx | agent-preset.tsx, eval.tsx×4, execution.tsx×2, presets.tsx, settings-kit.tsx, source.tsx, ui/field.tsx, widgets.tsx×2 | — |
| `reorder` | function | `ui/multiselect.tsx` | ui/ native | — | ui.spec.tsx×3 |
| `MultiSelect` | function | `ui/multiselect.tsx` | ui/ native | agent-overlays.tsx, prompt-presets.tsx | a11y-layers.spec.tsx, form.spec.tsx, ui.spec.tsx×3 |
| `Modal` | function | `ui/overlay.tsx` | moved from controls.tsx | agent-overlays.tsx×2, app.tsx, command.tsx, prompt-presets.tsx×2 | a11y-layers.spec.tsx, controls.spec.tsx×2, ui.spec.tsx×2 |
| `ConfirmDialog` | function | `ui/overlay.tsx` | ui/ native | — | a11y-layers.spec.tsx, ui.spec.tsx |
| `Drawer` | function | `ui/overlay.tsx` | ui/ native | app.tsx, filtered.tsx | a11y-layers.spec.tsx, ui.spec.tsx×2 |
| `Popover` | function | `ui/overlay.tsx` | ui/ native | widgets.tsx | a11y-layers.spec.tsx, ui.spec.tsx |
| `Tooltip` | function | `ui/overlay.tsx` | ui/ native | — | a11y-layers.spec.tsx, ui.spec.tsx×2 |
| `matchOption` | function | `ui/select.tsx` | ui/ native | — | — |
| `Select` | function | `ui/select.tsx` | ui/ native | eval.tsx×2, prompts.tsx, repositories.tsx, settings-kit.tsx×3 | a11y-layers.spec.tsx, form.spec.tsx×2, ui.spec.tsx×2 |
| `Combobox` | function | `ui/select.tsx` | ui/ native | settings-kit.tsx, ui/multiselect.tsx | a11y-layers.spec.tsx, form.spec.tsx, ui.spec.tsx×2 |
| `StateDot` | function | `ui/status.tsx` | moved from controls.tsx | console.tsx×5, widgets.tsx | — |
| `Dot` | function | `ui/status.tsx` | moved from controls.tsx | app.tsx, source.tsx, ticket.tsx×2 | — |
| `Tabs` | function | `ui/tabs.tsx` | ui/ native | eval.tsx, filtered.tsx, prompt-presets.tsx, prompts.tsx | a11y-layers.spec.tsx, ui.spec.tsx×2 |
| `TabPanel` | function | `ui/tabs.tsx` | ui/ native | eval.tsx, prompts.tsx | a11y-layers.spec.tsx, ui.spec.tsx×2 |
| `ToastProvider` | function | `ui/toast.tsx` | ui/ native | provider.tsx | ui.spec.tsx |
| `useToast` | hook | `ui/toast.tsx` | ui/ native | provider.tsx | ui.spec.tsx×2 |
| `RadioGroup` | function | `ui/toggle-group.tsx` | ui/ native | agent-overlays.tsx | form.spec.tsx×4 |
| `CheckboxGroup` | function | `ui/toggle-group.tsx` | ui/ native | agent-overlays.tsx×2 | form.spec.tsx×2 |
| `cx` | const | `ui/util.ts` | ui/ native | ui/basic.tsx×4, ui/button.tsx×3, ui/choice-group.tsx×2, ui/datatable.tsx, ui/field.tsx×7, ui/overlay.tsx×2, ui/select.tsx, ui/status.tsx×4, ui/tabs.tsx×2, ui/toggle-group.tsx×2 | — |
| `focusables` | function | `ui/util.ts` | ui/ native | — | — |
| `trapTab` | function | `ui/util.ts` | ui/ native | — | — |
| `useLatest` | hook | `ui/util.ts` | ui/ native | ui/hooks.ts×2, ui/overlay.tsx | — |
| `FOCUS_FALLBACK` | const | `ui/util.ts` | ui/ native | app.tsx | ui.spec.tsx |
| `returnFocus` | function | `ui/util.ts` | ui/ native | — | — |
| `useDialogFocus` | hook | `ui/util.ts` | ui/ native | ui/overlay.tsx×2 | — |
| `useOutside` | hook | `ui/util.ts` | ui/ native | ui/overlay.tsx, ui/select.tsx×2 | — |
| `place` | function | `ui/util.ts` | ui/ native | ui/infotip.tsx | — |
| `useFloating` | hook | `ui/util.ts` | ui/ native | ui/overlay.tsx×2, ui/select.tsx×2 | — |
| `stepIndex` | function | `ui/util.ts` | ui/ native | ui/choice-group.tsx, ui/select.tsx×3, ui/tabs.tsx, ui/toggle-group.tsx | — |

### 3.3 旧层：页面文件里手写的组件与 hook（92 个导出）

| Component | Kind | File | Origin | Used by (src/client, ×uses) | Tests |
|---|---|---|---|---|---|
| `usePause` | hook | `actions.tsx` | page layer | command.tsx, eval.tsx, execution.tsx, overview.tsx | — |
| `useDeferredRemoval` | hook | `actions.tsx` | page layer | overview.tsx | — |
| `useOverlayLibrary` | hook | `agent-overlays.tsx` | page layer | — | — |
| `AgentOverlayField` | function | `agent-overlays.tsx` | page layer | eval.tsx, execution.tsx, presets.tsx×2 | — |
| `AgentPresetField` | function | `agent-preset.tsx` | page layer | eval.tsx, execution.tsx, presets.tsx×2 | — |
| `ApiError` | class | `api.ts` | page layer | draft.tsx×2, thread.tsx, ticket.tsx | client.spec.tsx×2 |
| `usePoll` | hook | `api.ts` | page layer | architecture.ts×3, console.tsx, eval.tsx, execution.tsx, filtered.tsx, overview.tsx, presets.tsx, prompt-assembly.tsx, provider.tsx, settings-kit.tsx, source.tsx, thread.tsx, ticket.tsx, trigger.tsx | client.spec.tsx, panel-realtime.spec.tsx |
| `LiveIndicator` | function | `app.tsx` | page layer | — | — |
| `App` | function | `app.tsx` | page layer | index.tsx | fixtures/panel.tsx |
| `useArchitectureParts` | hook | `architecture.ts` | page layer | settings.tsx | — |
| `CodeEditor` | const | `code-editor.tsx` | page layer | agent-overlays.tsx, execution.tsx, prompt-assembly.tsx×2, prompt-presets.tsx, prompts.tsx×2 | code-editor.spec.tsx×4 |
| `CommandPalette` | function | `command.tsx` | page layer | app.tsx | — |
| `ConsolePage` | function | `console.tsx` | page layer | app.tsx | — |
| `usePageForm` | hook | `deployment.tsx` | page layer | index.tsx | fixtures/panel.tsx |
| `DeploymentPage` | function | `deployment.tsx` | page layer | settings.tsx | — |
| `PluginConfig` | function | `deployment.tsx` | page layer | index.tsx | panel-deployment.spec.tsx |
| `useDraft` | hook | `draft.tsx` | page layer | deployment.tsx, prompts.tsx, repositories.tsx, settings-kit.tsx | — |
| `useDraftGroups` | hook | `draft.tsx` | page layer | settings.tsx | — |
| `SaveAll` | function | `draft.tsx` | page layer | settings.tsx | — |
| `SaveBar` | function | `draft.tsx` | page layer | deployment.tsx, eval.tsx×2, execution.tsx, presets.tsx×2, prompts.tsx, repositories.tsx, source.tsx | — |
| `EvalStatus` | function | `eval.tsx` | page layer | app.tsx | — |
| `EvalSettings` | function | `eval.tsx` | page layer | settings.tsx | — |
| `ExecutionStatus` | function | `execution.tsx` | page layer | app.tsx | — |
| `ExecutionSettings` | function | `execution.tsx` | page layer | settings.tsx | — |
| `FilteredTable` | function | `filtered.tsx` | page layer | source.tsx | — |
| `DroppedTable` | function | `filtered.tsx` | page layer | source.tsx | — |
| `KeptOutDrawer` | function | `filtered.tsx` | page layer | overview.tsx | — |
| `LiveClient` | class | `live.ts` | page layer | — | — |
| `LiveContext` | const | `live.ts` | page layer | api.ts, provider.tsx×2 | — |
| `useLiveClient` | hook | `live.ts` | page layer | — | — |
| `useLiveStatus` | hook | `live.ts` | page layer | app.tsx, console.tsx | — |
| `useLive` | hook | `live.ts` | page layer | agent-overlays.tsx, agent-preset.tsx, console.tsx, prompt-assembly.tsx, prompt-presets.tsx, prompts.tsx, settings-kit.tsx×2 | — |
| `OverviewPage` | function | `overview.tsx` | page layer | app.tsx | — |
| `PipelineFocusProvider` | function | `pipeline-view.tsx` | page layer | settings.tsx | — |
| `useReportFocus` | hook | `pipeline-view.tsx` | page layer | agent-overlays.tsx, prompts.tsx×2 | — |
| `FocusTracker` | function | `pipeline-view.tsx` | page layer | settings.tsx | — |
| `PipelineMap` | function | `pipeline-view.tsx` | page layer | console.tsx, settings.tsx | — |
| `PresetsSettings` | function | `presets.tsx` | page layer | settings.tsx | — |
| `useAssembly` | hook | `prompt-assembly.tsx` | page layer | prompts.tsx | — |
| `usePackLibrary` | hook | `prompt-assembly.tsx` | page layer | prompts.tsx | — |
| `PromptAssembly` | function | `prompt-assembly.tsx` | page layer | prompts.tsx | — |
| `PresetLayerEditor` | function | `prompt-assembly.tsx` | page layer | prompts.tsx | — |
| `PackLayerEditor` | function | `prompt-assembly.tsx` | page layer | prompts.tsx | — |
| `usePresetLibrary` | hook | `prompt-presets.tsx` | page layer | presets.tsx, prompts.tsx×2 | — |
| `PresetSwatch` | function | `prompt-presets.tsx` | page layer | prompts.tsx | — |
| `PromptPresetBar` | function | `prompt-presets.tsx` | page layer | presets.tsx, prompts.tsx | — |
| `PromptsPage` | function | `prompts.tsx` | page layer | settings.tsx | — |
| `usePanel` | hook | `provider.tsx` | page layer | actions.tsx×2, agent-overlays.tsx×8, agent-preset.tsx, app.tsx×5, architecture.ts, command.tsx, console.tsx×7, deployment.tsx×2, draft.tsx×3, eval.tsx×6, execution.tsx×3, filtered.tsx×3, overview.tsx×2, pipeline-view.tsx, presets.tsx×4, prompt-assembly.tsx×6, prompt-presets.tsx×5, prompts.tsx×9, repositories.tsx, rows.tsx×6, settings-kit.tsx×6, settings.tsx, source.tsx×5, thread.tsx×3, ticket.tsx×4, trigger.tsx, widgets.tsx×11 | — |
| `usePanelData` | hook | `provider.tsx` | page layer | actions.tsx, agent-preset.tsx, app.tsx×2, command.tsx, deployment.tsx, overview.tsx, prompts.tsx, repositories.tsx, settings-kit.tsx×2, source.tsx×3, widgets.tsx | — |
| `useAction` | hook | `provider.tsx` | page layer | actions.tsx, agent-overlays.tsx, eval.tsx, overview.tsx, prompt-assembly.tsx×2, prompt-presets.tsx, prompts.tsx×2, rows.tsx, settings-kit.tsx, thread.tsx, ticket.tsx, widgets.tsx | — |
| `PanelProvider` | function | `provider.tsx` | page layer | app.tsx, deployment.tsx | — |
| `RepositoryTable` | function | `repositories.tsx` | page layer | source.tsx | — |
| `TicketLine` | function | `rows.tsx` | page layer | execution.tsx×2, overview.tsx, thread.tsx | — |
| `ThreadLine` | function | `rows.tsx` | page layer | ticket.tsx, trigger.tsx | — |
| `DecisionLine` | function | `rows.tsx` | page layer | eval.tsx, thread.tsx | — |
| `Earlier` | function | `rows.tsx` | page layer | thread.tsx, ticket.tsx | — |
| `useSettings` | hook | `settings-kit.tsx` | page layer | eval.tsx×2, execution.tsx, presets.tsx×2, repositories.tsx, source.tsx×2 | — |
| `useSettingsMaybe` | hook | `settings-kit.tsx` | page layer | architecture.ts | — |
| `SettingsProvider` | function | `settings-kit.tsx` | page layer | settings.tsx×2 | — |
| `useBlockDraft` | hook | `settings-kit.tsx` | page layer | eval.tsx×2, execution.tsx, presets.tsx×2, source.tsx | — |
| `Fields` | function | `settings-kit.tsx` | page layer | deployment.tsx, eval.tsx×2, execution.tsx, presets.tsx×2, source.tsx | panel-settings.spec.tsx |
| `Field` | function | `settings-kit.tsx` | page layer | deployment.tsx, eval.tsx×3, execution.tsx×4 | — |
| `ModelField` | function | `settings-kit.tsx` | page layer | eval.tsx, execution.tsx | — |
| `ConfigHistory` | function | `settings-kit.tsx` | page layer | eval.tsx, execution.tsx, source.tsx | — |
| `SourceField` | function | `settings-kit.tsx` | page layer | eval.tsx, source.tsx | — |
| `SettingsPage` | function | `settings.tsx` | page layer | app.tsx | — |
| `SourceSettings` | function | `source.tsx` | page layer | settings.tsx | — |
| `SourceStatus` | function | `source.tsx` | page layer | app.tsx | — |
| `TagInput` | function | `tag-input.tsx` | page layer | agent-overlays.tsx, execution.tsx | form.spec.tsx×3 |
| `ThreadPage` | function | `thread.tsx` | page layer | app.tsx | — |
| `TicketPage` | function | `ticket.tsx` | page layer | app.tsx | — |
| `TriggerStatus` | function | `trigger.tsx` | page layer | app.tsx | — |
| `When` | function | `widgets.tsx` | page layer | rows.tsx×4, thread.tsx, ticket.tsx×2 | — |
| `SetupMessage` | function | `widgets.tsx` | page layer | deployment.tsx, overview.tsx, source.tsx×3 | — |
| `Section` | function | `widgets.tsx` | page layer | deployment.tsx×3, eval.tsx×5, execution.tsx, overview.tsx×4, presets.tsx, thread.tsx×3, ticket.tsx×3 | — |
| `Hint` | function | `widgets.tsx` | page layer | agent-overlays.tsx×5, console.tsx×3, deployment.tsx×3, eval.tsx×2, execution.tsx×2, overview.tsx×2, presets.tsx, prompt-assembly.tsx×5, prompt-presets.tsx×3, prompts.tsx×11, repositories.tsx, settings-kit.tsx×6, source.tsx×2, thread.tsx×3, ticket.tsx×7, trigger.tsx | — |
| `LabelValue` | function | `widgets.tsx` | page layer | eval.tsx×2, execution.tsx×2, rows.tsx×3, source.tsx×3, ticket.tsx×3 | — |
| `KeyValues` | function | `widgets.tsx` | page layer | deployment.tsx, ticket.tsx×2 | — |
| `Empty` | function | `widgets.tsx` | page layer | agent-overlays.tsx, console.tsx, eval.tsx×2, execution.tsx, overview.tsx, prompt-presets.tsx, settings-kit.tsx, trigger.tsx | — |
| `MarkdownLite` | function | `widgets.tsx` | page layer | ticket.tsx×2 | — |
| `ClampText` | function | `widgets.tsx` | page layer | thread.tsx | — |
| `ConfirmButton` | function | `widgets.tsx` | page layer | console.tsx, prompt-presets.tsx, rows.tsx, thread.tsx, ticket.tsx | — |
| `SessionButton` | function | `widgets.tsx` | page layer | console.tsx, rows.tsx, ticket.tsx×2 | — |
| `ExternalLink` | function | `widgets.tsx` | page layer | ticket.tsx | — |
| `ActionLink` | function | `widgets.tsx` | page layer | rows.tsx, thread.tsx, ticket.tsx×2 | — |
| `StageMark` | function | `widgets.tsx` | page layer | rows.tsx×3, ticket.tsx | — |
| `LoadState` | function | `widgets.tsx` | page layer | app.tsx×2, console.tsx, eval.tsx, execution.tsx, filtered.tsx, overview.tsx×2, prompt-assembly.tsx, prompts.tsx×2, settings-kit.tsx×2, source.tsx, thread.tsx×2, ticket.tsx×2, trigger.tsx | — |
| `ListRegion` | function | `widgets.tsx` | page layer | eval.tsx, execution.tsx, trigger.tsx | — |
| `LoadMore` | function | `widgets.tsx` | page layer | eval.tsx, execution.tsx, trigger.tsx | — |
| `StatusHead` | function | `widgets.tsx` | page layer | console.tsx×2, eval.tsx, execution.tsx, source.tsx, trigger.tsx | — |
| `PageHead` | function | `widgets.tsx` | page layer | thread.tsx×2, ticket.tsx×2 | — |
| `CheckSetupButton` | function | `widgets.tsx` | page layer | deployment.tsx, overview.tsx, source.tsx | — |

## 4. 亮暗对照截图

`docs/stage0-{settings,execution,console}-{light,dark}.png`，1440 宽，整页。01:00 用当前工作树（含第 1 节的改动）重拍，替换了 00:27 的那组。

复现：

```sh
pnpm exec vitest run --config scripts/panel-shots.vitest.config.mjs   # 用测试夹具的假服务渲染三页，HTML 写到 .artifacts/panel-shots
python3 scripts/panel-shots.py                                         # Chromium 截图，写回 docs/
```

- 渲染走 `src/`（和 `lib/` 同一份源码）。jsdom 不加载 `?raw` 样式，所以截图脚本按发布顺序把 `ui/theme.css`、`ui/tokens.css`、`ui/ui.css`、`client.css` 放回去。暗色是宿主的标记 `body[data-ds-dark-theme]`。
- 局限：没有真实 DSH 宿主，颜色全部是 `theme.css` 的回退值；数据是假的；字体是 Noto Sans CJK；监控台里的时间和计时随运行时刻变，像素对比时要忽略这几处。要做阶段 1/2 的像素级对比，最好在真实宿主里按这 6 个视图再拍一次。

**截图里看到的问题：监控台时间轴没有样式。** `console.tsx` 用了 11 个 `.dt-timeline-*` 类（`-axis`、`-bar`、`-grid`、`-gridline`、`-name`、`-now`、`-row`、`-scale`、`-tick`、`-track`），可是 `client.css` 里（HEAD 和工作树都是）只有 `.dt-timeline` 一条规则。所以刻度挤成一行文字，泳道条看不见。`.hark/plan.md` 第三轮记录说已经补回，实际不在。这是现状，阶段 0 不修，记在这里：阶段 1 补的时候按 token 规范写。

## 5. 提交

在仓库根目录 `sh docs/stage0-commit.sh`：删误建文件 → tsc → build → vitest（失败集合超出第 2 节清单就停）→ 两次提交（这一轮的 a11y 改动；阶段 0 记录、脚本和截图）→ `git status --short` 应该是空的。
