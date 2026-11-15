# HX-superagent 面板 v11 重构计划: 自定义多选预设 / 现代化交互 / 编排图 / 监控台

日期: 2026-11-15 18:10 CST · 工作区: /home/hx/Loli/code/HXLoLis/components/HX-superagent (未提交修改, 本轮只读, 未改任何源码)

## 0. 先说结论(读源码后的事实)

1. **你现在跑的很可能是旧前端.** `lib/client.js` 是旧构建: 源码里已有的 `PromptLayer`(预设页即改即存)、`VerdictStrip`(监控台状态行)、`liveAsOf`(数据截至 N 秒前)、`MultiSelect`(有序多选芯片)、`impactOf`(影响范围高亮) 在 `lib/client.js` 里一个都搜不到. 所以"不实时""不能多选"有一部分是旧包造成的. 第 0 阶段必须先重建确认.
2. **但即使是新源码, 你说的问题依然成立:**
   - "预设"被拆成三个互不相通的概念: DSH **底座预设**(agent preset, 单选 radio, 只能从 DSH 注册表里选, "自定义"只是手填一个已注册的 id)、**能力包**(capability packs/overlays, 可多选, 管工具和指令)、**提示词预设**(prompt presets, 可多选, 管 communication/scope/delivery/skills/parts). 三者分散在 预设 / Eval / Execution / Prompts 四个地方, 用户脑中只有一个"预设", 自然觉得"只能选它给的那几个".
   - 架构图(`pipeline-view.tsx` + `architecture.ts`)只是一排 5 个节点 + 下挂组件文字, 不能缩放, 不显示预设栈的层次, 编辑定位只到"块/字段/行"文字面包屑.
   - 监控台(`console.tsx`)有泳道、日志、调用链, 但泳道只显示"此刻", 没有时间轴; `ticket` 事件不带 id, 详情页无法精确订阅(见 `docs/panel-realtime.md` §8).
   - UI 组件库 `src/client/ui/` 功能齐全(可达性做得好), 廉价感来自视觉层: 间距/字号/圆角/阴影没有统一尺度, 卡片和表单密度高, 缺少动效和层级, 状态色只有小圆点.

## 1. 设计目标(可验收)

| # | 目标 | 验收 |
|---|---|---|
| G1 | 用户可以**自己写预设**, 给每个角色**叠加多个**, 排序, 并看到叠加后的最终结果和每一项出自哪个预设 | 新建一个预设 → 勾到 Executor 上 → 不刷新即在"生效结果"里看到它贡献的工具/指令/提示词段落, 并标注来源 |
| G2 | 配置时始终知道**正在编辑哪一步的哪一段** | 任意输入框获得焦点 ≤100ms 内, 编排图上对应节点+子组件高亮, 面包屑到"步骤 › 组件 › 预设层 › 段落 › 行", 下游受影响节点淡色标出 |
| G3 | 监控台能看到**调度在发生什么、过去 15 分钟发生了什么** | 两窗口测试: 一处触发 Ticket, 另一处 2s 内在图上看到流动、在时间轴泳道看到条块, 点击条块打开调用链 |
| G4 | 操作即时反馈, 状态所见即真 | 所有写操作乐观更新 + 失败回滚(沿用 `usePoll().mutate`); 每处保存提示生效时机(立即/下次会话/需重启) |
| G5 | 视觉现代化 | 新 token 体系落地, 截图评审通过; 明暗主题 AA 对比度测试(`tests/theme.spec.ts`)继续通过 |

## 2. 预设: 统一成"一个概念, 可自定义, 可叠加"

### 2.1 新模型

```ts
// src/app/presets.ts (新)
Preset = {
  id, name, description, color?,             // 用户可建/复制/导入/导出
  roles: ('orchestrator'|'worker')[],        // 可用于哪些角色
  base?: string,                             // 可选: DSH 底座 agent preset id
  tools?: { deny: string[]; allow: string[] },  // 原能力包
  instructions?: string,                     // 原能力包
  prompt?: { mode: 'append'|'replace'; communication?; scope?; delivery?; skills?; overrides? }, // 原提示词预设
  model?: string,                            // 可选: 角色模型(可选, 待确认)
}
RoleStack = { orchestrator: string[]; worker: string[] }   // 每个角色一条有序预设链
```

- 叠加规则(从上到下, 后者覆盖前者), 每一项都记录来源:
  - `base`: 链上**最后一个**写了 base 的预设生效(DSH 一个 Session 只能有一个底座); 都没写则用角色默认(router / worker).
  - `tools`: 按顺序应用 deny/allow, 后者决定冲突; 仍执行 `REQUIRED_TOOLS` 校验, 不满足则拒绝保存并说明是哪一层拿走的.
  - `instructions`: 依次拼接, 每段带预设名标题.
  - `prompt`: 沿用现有 `applyPresets()` 语义(append/replace, sources 记录).
- 纯函数 `resolveStack(role, stack, library) → { base, tools, instructions, promptConfig, sources, conflicts }`, 前后端共用, 前端实时预览, 后端是唯一真相.

### 2.2 关于"自定义底座"(需你确认的约束)

DSH 的 agent preset 是 profile 里注册的, 插件面板**不能凭空造一个 DSH 底座**. 方案: 自定义预设可以"指定底座 id"(从注册表下拉 + 手填), 但"自定义"的实质内容放在 工具/指令/提示词 层. 对用户而言这就是"我自己建的预设", 与内置预设完全平级, 不再出现"只能选它给的".
若你希望面板能真正注册新的 DSH 底座, 需要先查 dsh-agent 的 registry 是否支持运行时 `register()`, 作为 2.6 的可选项.

### 2.3 迁移(无损)

- `KV.prompts.presets` 中每个提示词预设 → 一个只含 `prompt` 的 Preset.
- 每个 overlay(能力包) → 一个只含 `tools/instructions` 的 Preset.
- `eval.agentPreset` / `executor.agentPreset` → 如果不是默认值, 生成一个只含 `base` 的 Preset 放在链首.
- 新链 = [底座预设?] + overlays(按原顺序) + promptConfig.presets(按原顺序), 两个角色各一条.
- `src/app/migration.ts` 已有迁移框架, 新增一步, 旧 API(`GET/PUT prompt-presets`, `agent-overlays`)保留一个版本做兼容读.

### 2.4 交互

- 设置里只保留一个 **"预设"** 页, 左右两栏: 左边 主会话 / Executor 两条预设链(芯片可拖拽, Alt+方向键排序, 删除可撤销), 右边 "生效结果"(底座、最终工具清单 带删除线和来源、指令、提示词各段 带来源色带).
- "+ 添加预设" 打开带搜索的多选面板(已有 `PresetPicker` 改造), 勾选顺序即叠加顺序, 不兼容当前角色的显示原因.
- 预设库: 新建 / 从当前配置另存为预设 / 复制内置 / 导入导出 JSON(合并已有 import 逻辑). 编辑器按 Tab 分 基本 | 底座 | 工具 | 指令 | 提示词, 右侧实时预览"套上它以后会变成什么".
- 改链立即保存(沿用 v10 的即改即存 + 失败回滚), 保存后提示 "新会话生效" 或 "下一次请求生效".

### 2.5 涉及文件

- 新: `src/app/presets.ts`, `src/client/presets/` (stack.tsx, library.tsx, editor.tsx, resolved.tsx)
- 改: `src/app/agent-overlays.ts`, `src/app/prompt-presets.ts`(变成兼容层), `src/app/sessions.ts`(创建 Session 时读 `resolveStack`), `src/app/prompts.ts`, `src/app/settings.ts`, `src/app/migration.ts`, `src/app/http.ts`/`api.ts`(新增 `GET/PUT presets`, `GET presets/resolved?role=`), `src/client/presets.tsx`, `agent-preset.tsx`, `agent-overlays.tsx`, `prompt-presets.tsx`, `locales.ts`
- 测试: `tests/presets-unified.spec.ts`(叠加规则、冲突、REQUIRED_TOOLS、迁移往返), `tests/presets-ui.spec.tsx`

## 3. 信息架构与交互重构(按用户意图)

把 7 个 Tab 按"我来这里想干嘛"重组成 4 个工作区:

| 新工作区 | 用户意图 | 吸收的现有页面 |
|---|---|---|
| **待办** (默认首页) | 有什么要我处理? | Overview 的问题行 + 等人的 Ticket; 每行就地操作(重试/停止/批准/打开会话), 不跳页 |
| **编排** | 系统怎么搭的? 我要改哪里? | Settings 全部 + 架构图, 合成"画布 + 检查器"一个界面 (见 §4) |
| **监控台** | 现在在跑什么? 卡在哪? | Console (见 §5) |
| **记录** | 某件事从头到尾怎么走的? | Source / Trigger / Eval / Execution 的历史列表, 统一成一个可筛选时间线 + 右侧抽屉 |

通用交互规则:
- 一个全局"变更托盘"代替每块一个保存条: 底部显示"3 处未保存", 展开看逐项 diff, 一次应用或逐项丢弃; 每项标注生效方式(立即 / 下次会话 / 需重启). ⌘S 保存全部.
- 所有列表行: 悬停出现主操作, 右键/`…` 出次操作, 操作乐观更新.
- ⌘K 命令面板扩展为"跳到任意配置项"(例如输入"blocked commands"直接定位到 Executor 节点的那个字段并聚焦).
- 键盘: `g d/b/m/r` 切工作区, `[`/`]` 在画布节点间移动, `Esc` 关检查器.

## 4. 编排画布: 架构图 / 调用关系图 + 编辑定位

### 4.1 布局
左 60% 画布, 右 40% 检查器(可拖宽). 画布两种视图切换:

1. **架构视图(静态)**: 节点 = Source 实例(每个 GitHub/飞书/QQ 实例单独一个) → Policy 规则组 → Admission → 主会话 → Executor 槽位组 → Replies/Outbox; 边 = 消息流, 另有 Executor → 主会话 的回报虚线. 主会话和 Executor 节点可展开成子图: 模型 / 预设链(每层一个小卡片, 用预设颜色) / 提示词组装 / 工具集 / 环境.
2. **提示词组装视图**: 某个角色的最终提示词按阅读顺序画成竖向分层条(内置段 / 团队段 / 每个预设写的段 / skills), 宽度≈字数, 颜色=来源. 点哪段, 右侧打开那段的编辑器.

### 4.2 双向定位(核心诉求)
- 点节点/子卡片 → 检查器打开对应表单并聚焦首字段.
- 在检查器里聚焦任意字段或在代码编辑器里移动光标 → 画布对应节点描边高亮, 所在子卡片发光, 顶部面包屑 `Executor › 预设链 › #2 review-only › 指令 › L12`, 下游受影响节点(复用 `impactOf`)淡色并标"影响".
- 未保存修改的节点右上角显示小圆点徽标, 悬停看 diff 摘要.
- 有问题的节点(Source 掉线、模型不可用、工具集不合法)直接在节点上显示警告, 点开就是修复入口.

### 4.3 实现
- 依赖: 推荐 `@xyflow/react`(MIT, 缩放/平移/小地图/自定义节点) + `elkjs`(自动分层布局). 备选: 保持自绘 SVG + 简单分层算法, 零依赖但开发量 +3 天. (需你确认)
- 复用: `pipeline.ts`(STEPS/EDGES/impactOf/BLOCK_NODES), `pipeline-view.tsx` 的 `focusOf/FocusTracker`, `architecture.ts` 的组件读取; 把 `data-pipeline-*` 标注扩展为 `data-node / data-part / data-layer`.
- 新文件: `src/client/canvas/` (graph.tsx, nodes.tsx, layout.ts, inspector.tsx, breadcrumb.tsx, prompt-stack-view.tsx)

## 5. 监控台: 实时看调度

### 5.1 布局(从上到下)
1. **一句话状态**(已有 `verdictOf`, 保留): 最坏的问题优先.
2. **KPI 条**: 运行中/槽位上限、排队、等人、待发送回复、近 1h 吞吐(带迷你折线).
3. **实时流动图**: 与编排画布同一张图(只读模式), 每个 `stage` 事件在对应边上走一个粒子, 节点上显示实时计数和处理中数量; 点节点 → 下方日志按该步骤过滤.
4. **时间轴泳道(新)**: 横轴最近 15 分钟(可拖到 1h), 每个 Executor 槽位和主会话一条泳道, 每个 Ticket 是一个条块(颜色=阶段), 条块里的刻度=工具调用; 当前时刻竖线实时右移. 点条块 → 右侧抽屉打开调用链(已有 `TicketTrace`)+ 打开会话 / 停止.
5. **事件日志**: 已有, 增加 按 Ticket 聚合 / 只看错误 / 暂停 / 导出.
6. **健康**: Source 与服务健康, 只在有问题时展开.

### 5.2 后端补缺
- `ticket` 等主题载荷带 `id`(目前无载荷, `docs/panel-realtime.md` §8 已记录), 让详情页和泳道精确刷新.
- 新增 `GET console/timeline?since=` 返回窗口内的 assignment 起止和工具调用摘要, 首屏回填泳道(否则刷新后时间轴是空的); 数据来自已有 `stage`/`activity`, 服务端保留最近 1h 环形缓冲(`src/app/live.ts`).
- `activity` 高频事件服务端 100ms 合并.

## 6. 视觉现代化(设计系统 v2)

不换框架, 在 `src/client/ui/` 内升级, 保留现有组件 API 和可达性测试:
- Token: 4px 间距网格; 字号 12/13/14/16/20/24; 圆角 6/10/14; 三档阴影; 动效 120/200/320ms + `prefers-reduced-motion`; 状态色从"小圆点"升级为 浅底色块 + 图标 + 文字.
- 组件: 新增 `Inspector`(右侧可调宽面板)、`ChangeTray`(全局变更托盘)、`Timeline`、`Sparkline`、`NodeCard`、`Breadcrumb`、`StackChip`(带颜色带的可拖芯片)、`Kbd` 提示; 升级 `Card`/`Tabs`/`Select`/`Toast` 视觉.
- 密度: 舒适 / 紧凑 两档, 记在本地.
- 空状态/加载: 骨架屏按真实布局, 空状态给下一步按钮.
- 每个阶段结束出明暗两套截图, 放 `docs/panel-v11-shots/` 供评审.

## 7. 分阶段执行

| 阶段 | 内容 | 预计 | 验收 |
|---|---|---|---|
| P0 | 重建并确认新包: `LC_ALL=C pnpm check`, 重载 profile(Docker 用 `--build`), 浏览器看到监控台状态行和预设页"底座预设/预设"命名 | 0.5 天 | 你先看一眼新包, 再决定 P2/P3 细节 |
| P1 | 统一预设: 模型、resolveStack、迁移、API、预设页 | 3 天 | G1; 迁移往返测试通过; 旧数据无损 |
| P2 | 设计系统 v2 + 信息架构四工作区 + 变更托盘 | 3 天 | G4、G5 |
| P3 | 编排画布 + 双向定位 + 提示词组装视图 | 4 天 | G2 |
| P4 | 监控台: 时间轴泳道、流动图、后端补缺 | 3 天 | G3 |
| P5 | 文档(005-panel.md 重写、007 架构表)、全量测试、截图 | 1 天 | `pnpm check` 失败集合 ⊆ 基线(已知: environment.spec 本地化、feishu 消费者时序) |

写回规则沿用 v10: 在镜像里改, 写回前逐文件比对基准版本, 不一致进冲突清单, 绝不覆盖你的未提交修改.

## 8. 风险

- DSH 底座只能用注册表里的(见 2.2), 若你需要面板注册新底座要先验证 dsh-agent API.
- 新增 `@xyflow/react`+`elkjs` 会让 `lib/client.js`(现 1.78MB)增加约 200KB.
- 统一预设改动 Session 创建路径(`sessions.ts`), 需要一次实机回归: 主会话等待保护、Executor 工具裁剪不能变弱.
- 工作区未提交修改多, 用户并行编辑同一文件会进冲突清单.

## 9. 需要你拍板的两件事

1. 编排画布用 `@xyflow/react + elkjs`(推荐), 还是零依赖自绘?
2. 预设统一后, "底座"保持"从 DSH 注册表选 + 手填 id"可以接受吗? 还是要我先调研面板能否注册新底座?

你回复后我从 P0 开始动手.

## 2026-11-15 进度（第一轮落地）
- 选型拍板：画布零依赖 SVG（不加包）；底座仍只认 DSH 注册的预设，自定义预设可带 base，链中最后一个带 base 的开着的预设决定底座，角色跑不了的底座报 overlayBase 拒绝。
- 已写回：预设 base 字段 + 底座单选 + 新建预设按钮；架构图按层画出预设链（同色、缩进、点哪层跳哪层）并显示实际底座；监控台时间轴泳道（5/15/60 分钟，每 Ticket 一道，点道打开调用链）；swimlanes 与 base 的测试；lib/ 已用当前 src 重建。
- 全量测试：基线 1302 过 / 10 败，现在 1308 过 / 10 败，无新增失败（10 个为原有失败，如 styles 的 dt-stack-* 未用类）。
- 下一步：Ticket 事件实时推送（后端 touch 带 id）、画布节点拖拽/缩放、设计 token 统一整理、原有 10 个失败。

## 2026-11-15 进度（第二轮：运行态验收收口）
- 运行态真跑：`pnpm build` 重建 lib → `tests/built-panel.spec.tsx` 用 `__ModuleLoader__` 垫片 + 真 React 18 + 模拟面板服务（tests/fixtures/panel-server）加载 `lib/client.js`，逐页挂载：总览、来源、触发、评估、执行、监控台，设置 6 组（来源/评估/执行/预设/提示词/部署）全部渲染出内容，控制台错误 0。截图另交（Chromium 渲染页面 HTML 快照，CSS 用垫片设计 token）。
- 运行态查出并修复的 3 个问题：时间轴丢弃时间戳略晚于 now 的事件（改为夹到 now）；主 Session 道被误标“已追踪”（只有 ticketId 相符的道才标）；链中预设有问题时底座仍显示为生效（改为“预设底座未生效”，overlaysBaseBlocked）。
- 新增测试：built-panel.spec.tsx（3 个）、runtime.spec 新增“Executor 按最后一个带 base 的能力包建 Session，底座被拒时保留设置值”。007 架构测试表已补行。
- 全量测试：基线 1302 过 / 10 败 → 1313 过 / 10 败，无新增失败；typecheck 通过。
- 已写回（逐文件比对版本，无冲突）：16 个 src/tests/docs 文件、tests/built-panel.spec.tsx（hxoa 不能建目录，所以放在 tests/ 根下）、lib/ 全部 16 个产物（分段 cat 校验与本地构建逐字节一致）。
- 未验证：没在真实 DSH 宿主/真浏览器里跑；截图用垫片 CSS 与假数据（总览里的 socket closed / 评估超时是假数据告警）。lib/ 下有一个旧产物 kind-CFGCx49A.d.ts 不再被引用，未删。
- 下一步：Ticket 实时推送、画布拖拽/缩放、设计 token 整理、原有 10 个失败。
