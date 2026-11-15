# 面板组件库 v1（`src/client/ui/`）

所有页面只从 `./ui/index.ts` 引组件；样式随 `UI_STYLES`（`theme.css` → `tokens.css` → `ui.css`）由 `PanelProvider` 注入，类名前缀 `hx-`。不引任何 `@deepseek-ai/*` 运行时包。单测：`tests/ui.spec.tsx`；样式守卫：`tests/tokens.spec.ts`；明暗对比度：`tests/theme.spec.ts`。

## 设计 token（三层）

| 层 | 名字 | 写在哪 | 可以引用 |
|---|---|---|---|
| 宿主 alias | `--dsw-alias-*`、`--dsw-elevation-*`、`--dsw-font-mono`、`--ds-font-family-code`、`--dsh-*` | DSH 宿主运行时注入 | — |
| 语义 token | 颜色 `--hx-c-*`（含派生的浅底/描边/表面色，如 `--hx-c-brand-soft`、`--hx-c-error-strong`）；刻度 `--hx-ui-*`：间距 `space-*`、圆角 `radius-*`、线宽 `border-*`、字号 `fs-*`、行高 `lh-*`、字重 `weight-*`、字距 `tracking-*`、时长 `dur-*`、层级 `z-*`、焦点 `focus-*`、阴影 `shadow-*`、线 `line*` | 颜色在 `theme.css`（唯一读宿主 alias、唯一写颜色值的地方，带明暗兜底色板 `--hx-fb-*`）；刻度在 `tokens.css` | 宿主 alias、兜底色板、其他语义 token |
| 组件 token | `--hx-btn-*`、`--hx-input-*`、`--hx-tab-*`、`--hx-table-*`……，以及 `--hx-tone`、`--hx-preset-*` | `tokens.css`，每个组件一行 | 只引语义 token |

规则（守卫强制）：
- 只有 `theme.css` 读宿主 alias；`ui.css`、`client.css` 和任何组件都不出现 `--dsw-*` / `--ds-*` / `--dsh-*`。
- 只有 `theme.css` / `tokens.css` 声明自定义属性、写颜色、写 `color-mix()`；规则表里颜色、间距、圆角、字号、行高、字重、字距、动效时长、焦点、阴影、z-index 一律引用 token。宽高等布局尺寸、透明度、transform 不在此列。
- `ui.css` 的组件读自己的组件 token（边框写成 `var(--hx-ui-border-hair) solid var(--hx-<组件>-border)`，线宽走刻度、颜色走组件），颜色一律不直接读 `--hx-c-*`；`client.css` 的页面样式读语义 token，以及页面专属的组件 token（`--hx-preset-*`、`--hx-pipeline-*`、`--hx-lane-*`、`--hx-skeleton-block`）。
- 焦点只有一种画法：全局 `:focus-visible` 读 `--hx-ui-focus-outline`（线宽 `--hx-ui-focus-width`、颜色 `--hx-ui-focus-color`、偏移 `--hx-ui-focus-offset*`），组件不另设 focus token，只能改偏移；输入框聚焦时边框变色走 `--hx-input-focus-border`。`tests/styles.spec.ts` 守画法，`tests/tokens.spec.ts` 守 token：不许出现组件 focus token 或 box-shadow 焦点环，声明的 focus token 必须有人用。
- 宿主的字体和窗口顶部留白（`--dsh-frame-top-clearance`）也只在 `theme.css` 读，转成 `--hx-c-font-*`、`--hx-c-frame-top-clearance`。
- 组件里的内联样式只能传布局数字和 `--dt-*` 数据（色相、列数、几何），不能传颜色或带单位的样式字符串；`Skeleton` 的 `radius` 只收刻度名（`'md'`、`'lg'`…）。
- 引用的 token 必须有定义，声明的组件 token 必须有人用。

改视觉：整体改一档刻度（比如全局小字号）改语义 token；只改一个组件（比如按钮高度）改它的组件 token；改某种浅底的浓度改 `theme.css` 里对应的派生色。新增组件：先在 `tokens.css` 加一行组件 token，再在 `ui.css` 写规则。

## 暗色与对比度

- 明暗切换：宿主在 `<body>` 上写 `data-ds-dark-theme` 时用暗色；宿主没声明主题来源（`<html>` 无 `data-ds-theme-source`）时跟随系统 `prefers-color-scheme`。宿主给了 `--dsw-alias-*` 就用宿主的，没给的落到 `theme.css` 里的 `--hx-fb-*` 兜底色板。暗色色板写了两份（`body[data-ds-dark-theme]` 和 `prefers-color-scheme` 里那份），必须逐字一致，守卫会比对。
- 目标：两套主题都达到 WCAG 2.x AA。正文 4.5:1；焦点环、开关轨道、勾选/单选框、状态点、流程图连线这类表意图形 3:1。禁用态不在要求内。
- 守卫 `tests/theme.spec.ts`：自己解析 `theme.css` / `tokens.css`（jsdom 不算颜色），宿主 alias 一律按缺省处理，`color-mix()` 和半透明底按真实叠加计算，再查三张网：
  1. 语义对：每个文字 token（primary / secondary / tertiary / caption）在每种底上（页面、三层卡片、模块底、浮层、悬停/按下/选中态）；每种状态色（品牌、链接、成功、警告、错误、业务、空闲）在普通底和自己的 12% 浅底上。
  2. 组件对：实底和它上面的字（主按钮、危险按钮及悬停、品牌实底、提示框、高亮、diff、编辑器选区/当前行/占位符标记），以及预设序号在 0–359 每个色相上的对比度。
  3. 扫描：`client.css` / `ui.css` 里同一条规则同时写了 `color` 和非透明 `background` 的，逐条在卡片底上算；规则里单独写的 `color` 只能是上面验过的 token。新加样式不用登记，自动进检查。
- 写颜色时：
  - 浅色文字不要放在 `--hx-c-brand-primary` / `--hx-c-state-error-primary` 实底上（暗色下这两个是浅色，白字只有 2.8:1）。带字的品牌实底用 `--hx-c-brand-fill` + `--hx-c-label-on-brand`，危险实底用 `--hx-c-danger-fill` + `--hx-c-label-on-danger`，悬停 `--hx-c-danger-hover`。
  - `--hx-c-label-dimmed` 只给装饰和禁用态，不能当文字色。占位符用 `--hx-c-label-caption`。
  - 需要 3:1 的线和框用 `--hx-c-control-edge`；`--hx-c-border-l2/l3/l4` 只是分隔线，不承担表意。
  - 预设色相：描边、浅底、色条用 `--hx-preset-tint*` / `--hx-preset-bar` / `--hx-preset-stripes`，带字的实底用 `--hx-preset-fill`（任何色相上白字都 ≥4.5:1）。
  - 代码编辑器的语法高亮按 CodeMirror 默认样式的色相映射到状态色 token（`highlightToken`），不直接用它写死的浅色主题颜色。
- 守卫管不到的：真实宿主的 `--dsw-alias-*` 取值（不在本仓库），需要在真 DSH 里亮/暗各截一次图核对。

| 组件 | 用途 | 键盘 / 可达性 |
|---|---|---|
| `Button` | `variant` primary/secondary/ghost/danger，`size` sm/md，`icon`，`busy` | busy 时不触发点击但保持可聚焦（保存时焦点不丢），`aria-busy` |
| `IconButton` | 纯图标按钮，`label` 必填 | `aria-label` + 原生 title |
| `Input` / `Textarea` / `Field` / `ControlGroup` | 输入、自增高文本框；Field = 标签+帮助+说明+错误+控件，ControlGroup = 多个控件共用一个标签 | 见下「表单原子」 |
| `RadioGroup` / `CheckboxGroup` | 一排可选按钮：单选 / 多选，`itemClassName`、`data` 给页面挂样式和标记 | 单选漫游焦点、跳过禁用；多选每项一个 Tab 停靠点 |
| `Select` | 按钮式下拉 | ↑↓/Home/End、Enter/Space 选、Esc 关、首字母跳转，选后焦点回按钮 |
| `Combobox` | 可搜索下拉，`allowCustom` 允许自定义值（模型名） | ARIA 1.2 combobox；Enter 选/提交，Esc 还原已提交值，Tab 提交 |
| `MultiSelect` | 有序多选 + 拖拽排序（A 线 prompt 预设） | 芯片可聚焦；Alt+←/→ 移位并朗读位置，Delete 删除，输入框空时 Backspace 跳到最后一个芯片 |
| `Switch` | 开关 | `role=switch` |
| `Tabs` / `TabPanel` | line / segmented 两种 | 漫游焦点 ←/→/Home/End，跳过禁用，自动关联 tabpanel |
| `PageTabs` / `FilterTabs` | 页面顶栏 / 列表筛选 | 同 Tabs：←/→ 选中并移动焦点，Home/End，首尾循环 |
| `SegmentedControl` | 少量选项单选（radiogroup） | ←/→ 与 ↑/↓ 都可选中，Home/End，首尾循环，只有选中项是 Tab 停靠点 |
| `Pill` / `DisclosureRow` | 开关式筛选 / 展开行 | Enter/Space；`aria-pressed` / `aria-expanded` |
| `InfoTip` | 帮助图标 | 键盘聚焦显示（仅 focus-visible），Esc 隐藏；文字同时是按钮的可访问名称 |
| `Card` | 标题/描述/操作/页脚，`interactive`、`selected` | — |
| `Drawer` | 右侧详情抽屉（列表→详情），`contentKey` 换内容时焦点回到抽屉 | 焦点陷阱、Esc 关、关后焦点回到触发行；触发行已不在时回到页面主区域 |
| `Modal` / `ConfirmDialog` | 对话框；确认框支持 async，执行中 busy，失败原地显示错误，危险操作默认聚焦“取消” | 焦点陷阱、Esc |
| `Popover` | 非模态浮层，`trigger` 渲染函数 | Esc / 点外部关闭，焦点回触发器 |
| `Tooltip` | 悬停 400ms / 键盘聚焦立即 | `aria-describedby`，Esc 只隐藏提示、不关闭外层对话框 |
| `ToastProvider` / `useToast()` | `show/success/error/dismiss`；同 `id` 替换（"保存中…"→"已保存"），错误不自动消失 | 普通 `role=status`，错误 `role=alert`，悬停/聚焦暂停计时 |
| `Badge` | `tone` neutral/brand/success/warning/danger/info/quiet，`dot` | — |
| `Skeleton` / `LoadingBlock` | 首屏骨架 | 骨架 `aria-hidden`，LoadingBlock 朗读一次 |
| `EmptyState` | 统一空状态（图标/标题/说明/操作），`compact` | — |
| `DataTable` | 排序（`aria-sort`）、跨列文本筛选、`height` + 超过 `virtualizeAt` 行时虚拟滚动 | 行漫游焦点 ↑↓/Home/End/PgUp/PgDn，Enter 打开 |
| `KeyValue` | 详情键值，1–3 列，空值显示 — | `dl/dt/dd` |
| `Kbd` | 快捷键 `keys={['⌘','S']}` | — |
| `SaveBar` | 统一的未保存吸底条 | 配合 `useSaveShortcut` |

表单原子（`field.tsx`）：一个字段 = `FormField` 上下文 + 原子。上下文给出 id、label id、说明/错误 id 和 `invalid/required/disabled/readOnly`，所有控件（Input、Textarea、Select、Combobox、MultiSelect、Switch、SegmentedControl、RadioGroup、CheckboxGroup、TagInput、CodeEditor）用 `useFieldControl` 读它，所以连线全仓一致：
- 原子：`Label`（可标注的控件是 `<label for>`，复合控件是被 `aria-labelledby` 引用的 span；必填星号 `aria-hidden`）、`FieldHint`（说明）、`FieldError`（`role=alert`，出现时替换说明并让控件 `aria-invalid`）、`Adornment`（输入框前后缀，不进可访问名称）、`FieldHead`（标签行：标签+帮助+徽标）、`FieldRoot`（根元素；分组字段时是 `role=group`）。
- `Field` 是这些原子的固定排法；页面需要别的排法时自己组合原子，不要手写 `<label>` 或 `dt-field-head`（`tests/form.spec.tsx` 守卫）。
- 控件自己的 `label` 与字段标签相同时只保留字段标签（不重复朗读）；说得更多时（如「列 · 行」）保留自己的 `aria-label`。
- `ControlGroup`（`FormField group`）：一个标签下有几个控件，根是命名的组并由说明描述，组内控件各自命名、不抢字段 id。
- 流程图定位读控件的可访问名称（`aria-label` → `aria-labelledby` → `<label>`），再退到字段的 `.hx-field-label`；`dt-field`、`dt-switch-row`、`data-pipeline-*` 仍是页面钩子。

```tsx
<Field label={t('name')} hint={t('nameHint')} error={error} required><Input value={name} onChange={…} /></Field>
<ControlGroup label={t('base')} hint={t('baseHint')}><RadioGroup label={t('base')} …/><Input aria-label={t('other')} …/></ControlGroup>
<FormField label={t('commands')}><FieldRoot><FieldHead><Label>{t('commands')}</Label><InfoTip …/></FieldHead><TagInput label={t('commands')} …/></FieldRoot></FormField>
```

Hooks：
- `useDraft(server)`：本地草稿叠在 live 值上；干净时自动跟随 live 刷新，脏时保留编辑并给出 `stale`；`commit(saved)` 保存成功后收起保存条、不重载、不跳页。
- `useOptimistic(value)`：`apply(next, commit)` 先改本地，失败回滚并抛出（调用方用 `useToast().error` 提示）。
- `useSaveShortcut(dirty, save)`：⌘/Ctrl+S。

示例：

```tsx
const { draft, setDraft, dirty, stale, reset, commit } = useDraft(settings)
useSaveShortcut(dirty, save)
<SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} labels={{ unsaved: t('unsaved'), save: t('save'), reset: t('discard') }} />

<DataTable label={t('tickets')} rows={tickets} rowKey={r => r.id} columns={cols} height={520}
  onRowClick={r => setOpen(r.id)} selectedKey={open} filter={{ label: t('filter'), placeholder: t('filter') }}
  empty={<EmptyState title={t('noTickets')} compact />} />
<Drawer open={!!open} onClose={() => setOpen(undefined)} title={…} closeLabel={t('close')}>…</Drawer>
```

每个组件的完整键盘模型、统一焦点环和焦点归还规则见 [docs/010-keyboard.md](../../../docs/010-keyboard.md)；新增组件要在那张表里加一行。焦点环只由 `ui.css` 顶部那一条规则画，组件不要自己画。

新增组件需求：在本项目对话里直接提，我加到这里并补测试。
