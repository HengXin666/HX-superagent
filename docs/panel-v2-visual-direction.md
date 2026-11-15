# 视觉方向（hx-ui 组件库）

> 2026-11-15 更新：token 已改为三层（宿主 alias → 语义 `--hx-c-*` / `--hx-ui-*` → 组件 `--hx-<组件>-*`），定义在 `src/client/ui/theme.css` 与 `tokens.css`，规则与改法见 `src/client/ui/README.md`「设计 token（三层）」，守卫是 `tests/tokens.spec.ts`。本文下面关于「token 定义在 ui.css」「颜色只引用 `--dsw-alias-*`」的描述已过时，以 README 为准。


目标：密集、安静、可扫读的运维面板。层级靠字重、留白和描边来区分，不靠色块。颜色**只**使用 DSH 的 `--dsw-alias-*` 别名 token；新库自己只声明尺寸、圆角、时长这类非颜色变量（前缀 `--hx-ui-*`），定义在 `src/client/ui/ui.css`。

## 1. 字号层级

| Token | 字号 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| `--hx-ui-text-display` | 22 / 30 | 700 | Drawer 或整页标题（Ticket/Thread 名），每屏最多一个 |
| `--hx-ui-text-title` | 17 / 24 | 700 | 面板标题、Card/块标题（取代现在 16/500、20/500 的混用） |
| `--hx-ui-text-section` | 15 / 22 | 600 | 分区标题（Section、状态头） |
| `--hx-ui-text-label` | 14 / 20 | 500 | 行标题、按钮、Tabs、字段标签 |
| `--hx-ui-text-body` | 13 / 20 | 400 | 正文、Hint、表格单元格、输入框文字 |
| `--hx-ui-text-caption` | 12 / 18 | 400 | 元信息、时间、计数、Badge |
| 等宽 `--hx-ui-font-mono` | 继承所在层级的字号（id、命令用 caption 12/18，代码块用 body 13/20） | 400 | id、路径、命令、prompt 文本 |

- 数字列一律加 `font-variant-numeric: tabular-nums`。
- 颜色层级：`label-primary` 用于标题和正文，`label-secondary` 用于次要正文和分区标题，`label-tertiary`/`label-caption` 用于元信息，`label-dimmed` 用于占位符。
- 去掉 `.dt-title` 的渐变文字（`client.css:13`），标题用纯色 `label-primary`。

## 2. 间距（以 4px 为基）

`--hx-ui-space-1` 4、`-2` 8、`-3` 12、`-4` 16、`-5` 20、`-6` 24、`-8` 32、`-10` 40。

- 行内元素之间：4–8。行内边距：8（紧凑）或 12（默认）。Card 内边距 16。Card 之间、Section 之间 24。页面顶部区域 32/40。
- 不再出现 18、10、6 这类不在刻度上的值（现有 `.dt-block` 的 18、`.dt-row` 的 10 统一改为 16、8/12）。

## 3. 圆角

`--hx-ui-radius-sm` 6（Badge、行内 code、Kbd）· `-md` 8（Input、Select、Button-sm、表格行、Tooltip）· `-lg` 12（Card、Popover、Toast、DataTable 外框）· `-xl` 16（Drawer 内侧角、Modal）· `-pill` 999（Pill/Tabs-pill、Switch、头像点）。

规则：嵌套元素的圆角不大于外层圆角减去内边距。现在 `.dt-modal` 的 24、`.dt-btn` 的 18 都收敛到上述刻度。

## 4. 阴影与层级

- `--hx-ui-shadow-card`：`0 1px 2px color-mix(in srgb, var(--dsw-alias-bg-mask-1) 35%, transparent)`，只用于浮在页面上的 Card 和 DataTable 的固定表头；普通 Card 以 `border-l3` 描边为主。
- `--hx-ui-shadow-pop`：`var(--dsw-elevation-prominent)`，用于 Popover、Drawer、Toast、命令面板。
- z 轴：`--hx-ui-z-drawer` 40 < `-popover` 50 < `-tooltip` 60 < `-toast` 70。取代现在零散的 1/2/3/5/1000/1100。Drawer 内弹出的 Popover 自然处于其上方。
- 禁止在阴影或颜色里硬编码 `#000`/`#fff`（现有 `client.css:192,229,415`），一律改为 `color-mix` 加 alias。

## 5. 动效

| Token | 值 | 用途 |
| --- | --- | --- |
| `--hx-ui-dur-fast` | 120ms | hover/press、颜色、焦点环 |
| `--hx-ui-dur-base` | 180ms | Popover、Tooltip、Switch、Tabs 指示条、行的乐观状态切换 |
| `--hx-ui-dur-slow` | 260ms | Drawer 进出、Toast 进入、深链目标的一次性高亮 |
| `--hx-ui-ease` | `cubic-bezier(.2,0,0,1)` | 全部统一（取消现有的回弹曲线 `cubic-bezier(.3,1.4,.5,1)` 等） |

- 只对 `opacity`、`transform`、颜色、`box-shadow` 做动画；不对 height/width 做动画（折叠类直接切换，或用 `grid-template-rows` 过渡）。
- `prefers-reduced-motion: reduce` 下三个时长全部为 0ms；Skeleton 的扫光和 spinner 停在静态帧，状态改用文字或 `aria-busy` 表达。

## 6. 密度

- 控件高度：`--hx-ui-h-sm` 28（表格行内、工具栏、筛选），`--hx-ui-h-md` 32（表单默认）。不再出现 34/36（现有 `.dt-input`/`.dt-select`/`.dt-tab`）。
- DataTable 行高：紧凑 32，默认 40；列表卡片行最少两行，即 label + caption。
- 点击目标不小于 28×28；触屏（`hover: none`）下 IconButton 的命中区域通过伪元素扩到 40。

## 7. 焦点

- （已被取代：焦点现在只用 outline `--hx-ui-focus-outline`，`--hx-ui-focus-ring` 已删除，见 `src/client/ui/README.md`「设计 token」。以下为当时的方案。）唯一的焦点样式：`box-shadow: var(--hx-ui-focus-ring)`，即 `0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent)`，只在 `:focus-visible` 时出现。输入类控件额外把边框改为 `--dsw-alias-brand-primary`。
- 整行可点的列表行，焦点环画在行上（用 `::after` 伪元素的 inset 0），不画在内部按钮上。
- 已有 box-shadow 的元素：把焦点环与原阴影用逗号叠加，不要覆盖。

## 8. 颜色使用（只用 alias）

| 角色 | Token |
| --- | --- |
| 页面底 / 一级面 / 浮层面 | `bg-base` / `bg-layer-1` / `bg-layer-2`（`bg-layer-3` 只用于浮层内再嵌套的一层） |
| 弱底（代码块、Tabs 轨道） | `bg-module-platform` |
| 骨架 | `bg-skeleton`（取代现在自绘的渐变） |
| 描边 | `border-l2`（分隔线）、`border-l3`（Card、表格）、`border-l4`（输入框） |
| 交互底 | `interactive-bg-hover`、`interactive-bg-active`、`interactive-bg-hover-danger` |
| 品牌 / 链接 | `brand-primary`、`link` |
| 状态 | `state-success-primary`、`state-warn-primary`、`state-error-primary`、`state-business-primary`（info）、`state-idle-primary` |
| 按钮 | `button-primary-fill` / `button-primary-hover`，前景色 `label-primary-foreground` |
| 遮罩 / Tooltip / Toast 底 | `bg-mask-1` / `tooltip-bg` / `toast-bg`；其上的文字用 `label-primary-inverted` |

- 浅色底（Badge、Banner、高亮）：`color-mix(in srgb, var(--dsw-alias-state-*-primary) 10–16%, transparent)`，文字仍用对应的 `*-primary`，或 `state-warn-label`。
- 危险按钮：底色为 `state-error-primary`，hover 时底色为 `interactive-bg-hover-danger`。

## 9. 暗色模式

不维护第二套色板：所有颜色都引用 alias token，DSH 切换主题时这些 token 会随之翻转。浅色底一律用 `color-mix(… alias …, transparent)`，这样在两种主题下比例都成立。禁止硬编码颜色值、`rgba()` 和 `#000/#fff`。阴影透明度来自 `bg-mask-1`，所以在暗色下会自动变深。Preset 色相（`--dt-hue`）如需保留，只能作为 `color-mix` 的混入成分，并与 `label-primary` 混合以保证对比度。

## 10. 可直接粘贴的 CSS

```css
/* src/client/ui/ui.css — hx-ui tokens. 颜色只引用 --dsw-alias-*（以及 DSH 的 elevation）。 */
:where(.hx-ui-root, :root) {
  /* spacing (4px base) */
  --hx-ui-space-1: 4px;  --hx-ui-space-2: 8px;  --hx-ui-space-3: 12px; --hx-ui-space-4: 16px;
  --hx-ui-space-5: 20px; --hx-ui-space-6: 24px; --hx-ui-space-8: 32px; --hx-ui-space-10: 40px;
  /* radius */
  --hx-ui-radius-sm: 6px; --hx-ui-radius-md: 8px; --hx-ui-radius-lg: 12px; --hx-ui-radius-xl: 16px; --hx-ui-radius-pill: 999px;
  /* type: weight size/line-height family（family 取 DSH 宿主变量，缺省回退系统字体） */
  --hx-ui-font-mono: var(--dsw-font-mono, var(--ds-font-family-code, ui-monospace, Menlo, monospace));
  --hx-ui-text-caption: 400 12px/18px var(--dsh-font-family-text, system-ui, sans-serif);
  --hx-ui-text-body:    400 13px/20px var(--dsh-font-family-text, system-ui, sans-serif);
  --hx-ui-text-label:   500 14px/20px var(--dsh-font-family-text, system-ui, sans-serif);
  --hx-ui-text-section: 600 15px/22px var(--dsh-font-family-text, system-ui, sans-serif);
  --hx-ui-text-title:   700 17px/24px var(--dsh-font-family-text, system-ui, sans-serif);
  --hx-ui-text-display: 700 22px/30px var(--dsh-font-family-text, system-ui, sans-serif);
  /* motion */
  --hx-ui-dur-fast: 120ms; --hx-ui-dur-base: 180ms; --hx-ui-dur-slow: 260ms;
  --hx-ui-ease: cubic-bezier(.2, 0, 0, 1);
  /* elevation */
  --hx-ui-shadow-card: 0 1px 2px color-mix(in srgb, var(--dsw-alias-bg-mask-1) 35%, transparent);
  --hx-ui-shadow-pop: var(--dsw-elevation-prominent);
  /* focus */
  --hx-ui-focus-ring: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
  /* density */
  --hx-ui-h-sm: 28px; --hx-ui-h-md: 32px;
  /* stacking */
  --hx-ui-z-drawer: 40; --hx-ui-z-popover: 50; --hx-ui-z-tooltip: 60; --hx-ui-z-toast: 70;
}
@media (prefers-reduced-motion: reduce) {
  :where(.hx-ui-root, :root) { --hx-ui-dur-fast: 0ms; --hx-ui-dur-base: 0ms; --hx-ui-dur-slow: 0ms; }
}
/* 用法示例 */
:where(.hx-ui-root) :focus-visible { outline: none; box-shadow: var(--hx-ui-focus-ring); }
```

## 11. alias token 清单与来源

完整清单见 `/workspace/work/out/alias-tokens.txt`（41 个）。

- 其中 34 个出现在 DSH 自己的客户端包里（`node_modules/@deepseek-ai/dsh-client-ui-{layout,workspace,plugin-manager}`、`dsh-client-locale` 的 `lib/client.js`）。
- 另外 7 个只出现在本仓库的 `client.css` 中：`bg-mask-1`、`button-ghost-active-border`、`button-ghost-active-fill`、`interactive-bg-active`、`state-idle-primary`、`toast-bg`、`tooltip-bg`。
- 已安装的包里**没有任何 token 的定义**（检索 `--dsw-alias-label-primary:` 结果为空），定义由 DSH 宿主在运行时注入。因此这 7 个只有本仓库引用的 token，尤其是 `--hx-ui-shadow-card` 依赖的 `bg-mask-1`，建议在 DevTools 的 Computed 面板里确认确实解析为非空值；若为空，退回 `--dsw-elevation-soft`。
- 非颜色的 DSH 变量（`--dsw-elevation-prominent`、`--dsw-font-mono`、`--ds-font-family-code`、`--dsh-font-family-text`）只在上面的映射中使用。DSH 自己还有 `--dsw-radius-*` 和 `--dsw-focus-ring-*`；本库按约定使用自己的 `--hx-ui-radius-*` 和 `--hx-ui-focus-ring`，不引用它们。
