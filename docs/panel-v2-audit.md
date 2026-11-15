# dsh-superagent 面板交互审计清单

> 范围：`src/client/` 全部页面与分区（Overview、Source、Trigger/Thread、Eval、Execution/Ticket、Console、Settings 下的 Source/Eval/Execution/Prompts/Deployment、Agent preset 选择器、Prompt presets、Repositories、命令面板、页头搜索）。
> 依据：本地只读副本 `/workspace/work/repo/src/client/*`（与远端 `src/client` 行数逐一核对一致），以及远端 `src/app/live.ts`、`src/app/store.ts`、`src/app/api.ts`、`src/app/http.ts`。行号均为**各文件自身**的行号。
> 组件名统一指计划中的组件库：Button、IconButton、Input、Textarea、Select/Combobox、MultiSelect（可拖拽排序）、Switch、Tabs、Card、Drawer（右侧详情抽屉）、Popover、Tooltip、Toast、Badge、Skeleton、EmptyState、DataTable（排序/筛选/虚拟滚动）、KeyValue、Kbd。

## 0. 实时数据现状与订阅建议

**实时通道**：`LiveClient`（`live.ts:15-90`）以 SSE 读 `GET events`，断线后指数退避（1s→30s）重连，并按 `since` 续读；主机已丢失该段事件时下发 `reset`，所有订阅者都会收到。主题只有 9 个（远端 `src/app/live.ts:8`）：`trigger | thread | ticket | decision | outbox | settings | prompts | activity | health`。其中前 7 个由 Store 写入触发（`src/app/store.ts:47` `StoreTopic`，`src/app/runtime.ts:226` 转发）；`activity` 是每次工具调用、轮次起止和模型回话；`health` 是主机健康状态。

**轮询**：`usePoll`（`api.ts:81`）默认 `intervalMs = 5000`。连上 live 后降为 `LIVE_INTERVAL = 60_000`（`api.ts:65`、`api.ts:100`），事件到达后等待 `LIVE_SETTLE = 120ms` 再重拉。断线期间**每个挂载的视图各自**按 5s 轮询，标签页隐藏时 ×6。另有几处特殊节奏：重启期间 `GET state` 每 1s 一次（`provider.tsx:102`），Console 显式传 5000（`console.tsx:46`），Plugin Manager 页传 `interval={10_000}`（`deployment.tsx:97`）。

**一次性加载（不随任何事件刷新）**：`GET agent-presets`（`agent-preset.tsx:21`）、`GET models`（`settings-kit.tsx:76`）、`GET prompts`（`prompts.tsx:28-29`）、`GET prompt-presets`（`prompt-presets.tsx:27-29`）、`GET policy/history`（`settings-kit.tsx:131`，只在展开时和 revision 变化时拉取）。

| 视图 | 现在订阅的主题 | 建议订阅的主题 | 说明 |
| --- | --- | --- | --- |
| 全局 `GET state`（`provider.tsx:102-103`） | ticket, settings, health | ticket, settings, health（不变） | 顶部负载、paused、setup 都来自它 |
| Overview `GET overview`（`overview.tsx:64`） | trigger, thread, ticket, decision, outbox, settings, health | 不变 | — |
| Source 状态 `GET sources`（`source.tsx:154`） | trigger, thread, settings, health, outbox | 不变 | — |
| Trigger 列表 `GET threads`（`trigger.tsx:13-14`） | thread, trigger, decision | **加 ticket** | 行内“扇出到”只显示 `state === 'open'` 的 Ticket（`rows.tsx:53`），Ticket 结束后该行不会更新 |
| Thread 详情 `GET threads/:key`（`thread.tsx:75-76`） | thread, trigger, decision, ticket | 不变；但要按 `key` 过滤（见 X-5） | — |
| Eval 列表 `GET decisions`（`eval.tsx:19-20`） | decision, trigger | **加 ticket** | 行标题优先用 `ticketTitle`（`rows.tsx:91`） |
| Execution 列表 `GET tickets`（`execution.tsx:22-23`） | ticket, outbox | 不变 | — |
| Ticket 详情 `GET tickets/:id`（`ticket.tsx:110`） | ticket, outbox, **activity** | ticket、outbox；activity **只收 `data.ticketId === id` 或 `data.sessionId` 属于本 Ticket 的事件** | 见 TK-1 |
| Console `GET console/snapshot`（`console.tsx:46-47`） | ticket, trigger, decision, outbox, settings, health；日志另订阅 `*` | 不变；只把 5000 的兜底轮询限定在页面可见时 | — |
| Settings `GET settings`（`settings-kit.tsx:26`） | settings, health | 不变；Provider 要提到分组切换之上（见 SET-1） | — |
| Agent preset 目录 | 无 | settings、health、reset，并把 `restarts` 加入依赖 | 预设注册表随插件和重启变化；该接口还返回 `selected`（`src/app/http.ts:245-248`） |
| 模型目录 `GET models` | 无 | health、reset，并把 `restarts` 加入依赖 | 提供商配置变化后要重启才生效 |
| Prompts `GET prompts` | 无 | **prompts**、reset | 主题存在，但没有任何视图订阅它（见 PRM-1） |
| Prompt preset 库 | 无 | **prompts**、reset | 同上 |
| 设置历史 `GET policy/history` | 无（靠 revision 变化） | settings（展开时） | — |
| Deployment | DSH `ConfigForm.subscribe`（`deployment.tsx:27-28`） | 不变 | — |

**落地建议**：在组件库之下加一个共享查询缓存，形如 `useQuery(key, load, { live: topics, filter })`。它负责：同一 key 只发一次请求；对 `reset` 统一失效；按事件 `data` 过滤；全局只保留一个 60s 校验定时器；断线兜底的 5s 轮询只对可见页面生效。下文多处“改法”都依赖它。

---

## 1. 跨页面（X）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| X-1 | 列表进详情是**整页替换**。`TicketLine` 标题调用 `navigate({ page:'execution', id })`（`rows.tsx:21`），`ThreadLine`（`rows.tsx:60`）、`DecisionLine`（`rows.tsx:84-85`）、搜索结果（`app.tsx:76,85,88,95`）、Ticket 内的 Input/Trigger 链接（`ticket.tsx:20,83`）同理。`Pages` 按 `route.id` 整页渲染 `TicketPage`/`ThreadPage`（`app.tsx:174,178`）。列表的 `limit` 是组件内 state（`trigger.tsx:12`、`execution.tsx:21`、`eval.tsx:18`），点“返回”（`widgets.tsx:132`）后列表重新挂载：已“加载更多”的条目和滚动位置都丢失，只剩 20/30 条，还要从顶部重新找 | 扫一眼详情再回到列表里同一个位置，继续往下处理 | 详情改为 **Drawer（右侧）**，叠加在列表之上。路由加 overlay 参数，如 `{ page:'execution', query:{filter}, drawer:{ticket:id} }`，列表保持挂载。Drawer 内可以连续跳转（Ticket→Thread→Ticket），用面包屑和返回键在 Drawer 内回退，Esc 关闭后焦点回到原来那一行。Drawer 头部给一个 IconButton“在整页打开”，供窄屏和深链使用；面板宽度不足约 900px 时退化为整页 | **P0** |
| X-2 | 筛选切换时**短暂显示上一个筛选的数据**。`usePoll` 跨依赖变化保留上次成功值（`api.ts:81` 注释：*Preserves the last successful value across dependency changes*），各列表又只在 `!data` 时显示加载态（`trigger.tsx:23-25`、`execution.tsx:49-52`、`eval.tsx:35-37`）。于是新 Pill 已高亮，下方列出的仍是旧筛选的结果，没有任何提示 | 点了筛选就看到对应的结果，或者至少明确知道正在加载 | 用 DataTable 的 `loading` 叠层：保留旧行，降低不透明度并加 `aria-busy`，表头显示一条细 Skeleton 进度条；数据的 key 带上筛选参数，旧数据只用作占位、不可交互 | P1 |
| X-3 | 侧边目录**只加载一次**：Agent preset（`agent-preset.tsx:21`）、模型（`settings-kit.tsx:76`）、Prompt preset 库（`prompt-presets.tsx:27-29`）。三者既不订阅任何主题，也不依赖 `restarts`，所以重启（`provider.tsx:104-107` 中 `restarts+1`）或插件变更之后，选项仍是旧的。加载失败只显示一行红字，没有重试入口。Eval 和 Execution 两个 `AgentPresetField` 各自请求一次 | 选项和主机实际可用的保持一致；出错时能一键重试 | 统一改用共享查询缓存，订阅见第 0 节表格。出错时显示 EmptyState（tone=error）加一个“重试”Button；同一目录只请求一次 | **P0** |
| X-4 | 断线兜底轮询**按视图各自计时**。每个 `usePoll` 有独立定时器（`api.ts:100-120`），断线时 Overview、`GET state`、Settings、列表各自每 5s 请求一次；Console 显式 5000（`console.tsx:46`）；Plugin Manager 页另起一个 `PanelProvider`（`deployment.tsx:97`），会再建一个 `LiveClient`（`provider.tsx:87`），也就是多一条 SSE 连接 | 断线时数据仍按节奏更新，同时不压垮主机 | 共享查询缓存：同一 key 去重；断线时只对当前可见页面做 5s 轮询，其余标记为过期，回到前台时再拉。`LiveClient` 做成模块级单例，所有 Provider 共用 | P1 |
| X-5 | **事件不按实体过滤**。`usePoll` 收到任一订阅主题都会重拉（`api.ts:95-97`）。Thread 详情订阅 `ticket`，于是任何 Ticket 变化都会重拉当前 Thread 的前 50 条时间线（`thread.tsx:75-76`）；Ticket 详情订阅 `activity`，见 TK-1 | 只有和我在看的东西有关的变化才刷新 | `useQuery` 支持 `filter(event)`，按 `event.data` 中的 `ticketId`/`sessionId`/`thread` 过滤；没有 data 的 Store 事件保持现状（整主题失效） | P1 |
| X-6 | **瞬时错误会顶开页面**。很多视图在已有数据时仍渲染 `{error && <LoadState error/>}`，即一段红字插在内容顶部：`overview.tsx:74`、`ticket.tsx:136`、`thread.tsx:131`、`settings-kit.tsx:29`、`app.tsx:187`。重连期间每次轮询失败都会推挤布局，与 005 文档原则 6“一次性网络错误不足以打扰”相悖 | 数据旧了要知道，但页面不能跳 | 已有数据时不再插红字。页头 LiveIndicator 旁显示 Badge“数据可能过期 · 12s 前”，悬停用 Tooltip 给出错误原文；连续失败 3 次以上，才在页面顶部一个**固定占位**的 Banner 里提示，并给“重试”Button | P1 |
| X-7 | **Toast 不分类型**。`Toast`（`provider.tsx:66-71`）只有一种样式，统一 `role="status"`，3s 后开始淡出，不能关闭，也不能带操作。`useAction` 把所有失败都送进 Toast（`provider.tsx:53`），所以 stop/retry/requeue 的失败原因 4 秒后就消失；成功与失败外观相同 | 失败要看得见、能重试；可撤销的操作要能撤销 | Toast 增加 `tone`（success/info/error）。error 用 `role="alert"`，不自动消失，带关闭 IconButton；支持 `action`（“重试”/“撤销”）。跟某个字段有关的错误留在字段旁的内联提示里，不进 Toast | P1 |
| X-8 | **确认策略不一致**。`ConfirmButton` 的确认按钮固定是 `variant="primary"`（`widgets.tsx:86`），“停止”这种不可逆操作（`rows.tsx:40`、`ticket.tsx:192-196`、`console.tsx:178`）也是主色。可重试、无害的 Retry 反而要确认（`rows.tsx:36`、`ticket.tsx:131`）。暂停/恢复在 Execution（`execution.tsx:39`）和 Overview（`overview.tsx:36-38`）要弹窗确认，命令面板却直接执行（`command.tsx:24,43`）。删除团队 Prompt preset 会立即永久保存，没有确认（`prompt-presets.tsx:215-217`）。导入同 id 的 preset 会静默覆盖（`prompt-presets.tsx:179`） | 危险操作拦一下，可逆操作别打扰 | 统一规则：**不可逆**（停止 Ticket、取消订阅、删除 preset、导入覆盖）用锚在按钮上的 Popover 确认，确认键用 Button `tone="danger"`；**可逆**（暂停/恢复、Retry、Requeue、Dismiss）直接执行，再弹带“撤销”的 Toast。所有入口（页面、行内、命令面板、Console）共用同一个 action 定义，保证行为一致 | P1 |
| X-9 | **没有乐观更新**。暂停（`execution.tsx:26`）、行内 stop/retry（`rows.tsx:15` 的 `after` 先等请求、再等 reload）、Requeue/Dismiss（`overview.tsx:50-53`）、取消订阅（`thread.tsx:124-128`）都要等“请求→120ms settle→重拉”走完界面才变化。`ConfirmButton` 在这期间保持弹窗打开（`widgets.tsx:87`） | 点了立刻看到结果 | 通过共享缓存打乐观补丁：行状态立即改（例如 Badge 变“停止中”），Button 显示 loading；失败时回滚，并弹 error Toast 带“重试” | P1 |
| X-10 | **空状态不统一**。有的用通用 `t('none')`（`eval.tsx:37`、`execution.tsx:52`、`console.tsx:134`、`command.tsx:70`），有的有专门文案：`threadsNone`（`trigger.tsx:25`）、`needsYouNone`（`overview.tsx:78`）、`rulesEmpty`（`eval.tsx:174`）、`consoleLogEmpty`（`console.tsx:126`）。全部是一行灰字，没有下一步动作 | 列表为空时知道为什么、下一步该做什么 | 统一用 EmptyState（icon、title、description、action）。例如 Execution 当前筛选为空时提供“查看全部”；Rules 为空时提供“添加规则”；Source 未配置时提供“去设置”；Console 断线时提供“重连”状态说明 | P1 |
| X-11 | **首屏加载态不贴合布局**。`LoadState`（`widgets.tsx:108-115`）不论页面形状都是 3 条线加“加载中”文字；Execution 和 Settings 在 `state` 未到时只显示纯文本 `t('loading')`（`app.tsx:168,179-181`），没有骨架。只有 Console（`console.tsx:195-200`）和 Agent preset（`agent-preset.tsx:41-43`）有贴合布局的骨架 | 首屏不跳、不闪 | 每种布局一个 Skeleton 预设：列表行、Card、KeyValue、Tabs 加表格。Execution/Settings 不再等 `state` 才渲染页面骨架，`state` 只用于填数 | P1 |
| X-12 | **Tabs/分段控件语义错误、键盘不完整**。`dt-subtabs` 有 `role="tab"`，但没有 roving tabindex、方向键和 `aria-controls`（`eval.tsx:177-181`、`prompts.tsx:66-67`、`prompt-presets.tsx:253-255`）。`SegmentedControl` 用 tablist/tab 来表示“选一个值”（`controls.tsx:113-125`，用于接受模式、对比基准、preset 模式），读屏会误报为页签。互斥的筛选 Pill 只用了 `aria-pressed`（`controls.tsx:68`） | 键盘和读屏用户能正常切换 | Tabs 组件统一处理 tablist、roving tabindex、←/→/Home/End、`aria-controls`；SegmentedControl 改为 `role="radiogroup"`；筛选改用 Tabs 的 `variant="pill"`，带计数 Badge | P1 |
| X-13 | **页头搜索不能用键盘挑选结果**。结果只是一串 button（`app.tsx:71-102`），没有 ↑/↓，不满 2 个字符不搜（`app.tsx:150`），在外部按下指针就关闭（`app.tsx:126`），选中后整页跳转。页头同时还有命令面板触发器（`app.tsx:144`）：两个输入框，各管一半 | 一个入口：输入，方向键选，回车打开 | 合并进命令面板，用 Combobox/listbox：页面和设置分组是“命令”，Ticket/Thread/Trigger 是“结果”分组；↑/↓ 选择，回车在 Drawer 中打开；页头只保留一个触发器，带 Kbd 提示 | P1 |
| X-14 | **焦点环有三套**：`.dt-open:focus-visible::after` 是 2px outline（`client.css:37`）；输入框和 select 是 3px 16% 阴影（`client.css:81,220`）；`.dt-info` 又是另一种 outline（`client.css:93`） | 键盘焦点一眼可见，并且处处一致 | 全部改用 `--hx-ui-focus-ring`（见视觉方向文档），组件库统一用 `:focus-visible` | P2 |
| X-15 | `Kbd` 文案硬编码为 `⌘K`（`command.tsx:57`），Windows/Linux 上实际是 Ctrl+K；`/` 快捷键没有任何可见提示 | 看得到自己平台上正确的快捷键 | 用 Kbd 组件按平台渲染 ⌘/Ctrl；命令面板底部列出 `/`、Esc、↑/↓ | P2 |
| X-16 | Overview 的问题行以数组下标作 key（`overview.tsx:81`），每行 `useAction` 的忙碌状态绑在下标上。live 刷新使列表增删时，忙碌和禁用状态会落到别的行上 | 我点的那一行才变灰 | key 改为 `kind + (triggerId \| decisionId \| source.id …)` | P2 |

## 2. Overview（OV）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| OV-1 | “24 小时已过滤”数字链接到整个 Source 页（`overview.tsx:88`）。Source 页上过滤明细分散在**每个 Source 行里一个默认折叠的 DisclosureRow**中（`source.tsx:131-141`），用户落地后还得逐个找、逐个展开。“已丢弃”同理（`overview.tsx:91`→`source.tsx:146`） | 点数字直接看到那些条目 | 数字点开一个 Drawer，里面是 DataTable，列为来源、发送者、预览、原因、时间，可按原因筛选；数量与 Overview 计数一致（原则 5） | P1 |
| OV-2 | 问题行的标题按钮与行内“去设置”按钮指向同一路由：`no-source` 和 `no-allowed`（`overview.tsx:31-34`）的 `row(..., settingsRoute(x), ..., go(..., settingsRoute(x)))` 是两个相同的入口 | 一行一个明确动作 | 标题不再可点，只保留 Button（有图标、有文案）；其余问题类型统一为“标题 + 主动作 Button + 次动作 IconButton” | P2 |
| OV-3 | Requeue 和 Dismiss 共用同一个 `post` 忙碌状态（`overview.tsx:13,50-53`）。点完后行保持原样，直到 overview 重拉；Dismiss 不可逆，却没有确认，也没有撤销 | 处理完的问题立刻消失，误点能撤回 | 乐观移除该行，弹 Toast“已忽略 · 撤销”（撤销期内延迟提交，或调用反向接口）；两个按钮各有自己的 loading | P1 |

## 3. Source（SRC）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| SRC-1 | **仓库表的保存流程自成一套**。`RepositoryTable` 不用 `useBlockDraft`/`SaveBar`，而是自己用 `rows` state 和内联按钮（`repositories.tsx:135-140`）。保存时（`repositories.tsx:68-81`）忽略响应里的 `restarting`（远端 `src/app/api.ts:45` 声明了 `restarting: boolean`），既不调用 `restart()`，也不弹“已保存”Toast；草稿不进 sessionStorage，也没有 beforeunload 保护（对比 `draft.tsx:150-156`）；409 只显示原始错误，不做三方合并；编辑期间远端的 settings 变化被本地 `rows` 盖住 | 增删仓库跟其他设置块一样：存得住、看得见反馈，重启有提示 | 改用 `useBlockDraft('instances:github', …)` 和统一的 SaveBar。`restarting` 为真时走 `restart()`，并在 SaveBar 里提示“将中断 N 个运行中的 Assignment”；表格用 DataTable 的可编辑行，每行 key 用 `id` 或临时 uuid（现在新行用下标 `new-${index}`，见 `repositories.tsx:101`） | **P0** |
| SRC-2 | 同一个动作有三个入口：卡片头“添加仓库”滚动到表格（`source.tsx:46-48`），表格头主按钮“添加仓库”（`repositories.tsx:94-95`），表格底部“添加一行”（`repositories.tsx:114-115`）；状态页还有一个“添加仓库”链接，会跳到设置（`source.tsx:142-145`） | 一个清楚的添加入口 | 只保留表格头一个 Button，点击后新增一行并聚焦其 Input；批量粘贴收进 Popover（Textarea 加“解析”）；卡片头和状态页的链接去掉，或改为指向表格锚点 | P2 |
| SRC-3 | Source 启用开关是草稿的一部分（`source.tsx:44-45`）：拨了还要再点保存，开关本身看不出“未生效”；会触发重启的字段，只在 SaveBar 的状态文字里提示（`source.tsx:60-61`） | 开关的状态要么已生效，要么一眼看出未保存 | 保留统一草稿模型（不改为立即生效，避免与 revision 冲突），但有未保存改动的字段旁显示 Badge“未保存”；会触发重启的字段在标签旁显示 Badge“需重启”，并配 Tooltip | P2 |
| SRC-4 | 过滤列表和丢弃回复是嵌在行里的无界 `<ul>`（`source.tsx:76-100,131-141`），没有排序和分页；丢弃条目的链接整页跳走（`source.tsx:94`） | 快速判断哪些消息为什么被挡 | 改为 Drawer 加 DataTable（按原因和时间筛选排序，虚拟滚动）；条目点开后在同一个 Drawer 内进入 Ticket/Thread | P1 |
| SRC-5 | 设置深链 `?source=x` 只调用 `scrollIntoView`（`source.tsx:68`），不聚焦也不高亮，键盘焦点仍停在 Tab 上 | 跳过来就知道是哪一张卡 | 滚动后聚焦卡片标题（`tabIndex=-1`），并给 Card 一次 `--hx-ui-dur-slow` 的高亮描边 | P2 |
| SRC-6 | 选择类字段用原生 `<select>`（`settings-kit.tsx:199,206,259`）。群聊/仓库标签较多时无法搜索，暗色下的弹出层由浏览器绘制，不跟 token。`RowsField` 的行以下标作 key（`settings-kit.tsx:232`），删除中间一行后，后面各行的输入状态会错位；删除没有撤销（`settings-kit.tsx:236`）；超过 6 行时折叠成一段以逗号连接的文字（`settings-kit.tsx:227-230`） | 在长列表里找到目标；删错能撤回 | Select/Combobox（可搜索、键盘可达）；RowsField 改为 DataTable 可编辑行，key 用 `row[key.key]` 或临时 id；删除后弹 Toast 撤销；折叠态改为“共 N 项 · 展开”加前几项 Badge | P1 |

## 4. Trigger 与 Thread 详情（TRG / THR）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| TRG-1 | Thread 列表不订阅 `ticket`（`trigger.tsx:13-14`），而行内“扇出到”依赖 Ticket 的 open 状态（`rows.tsx:53-55`），Ticket 结束后最多 60s 才更新 | 列表上的 Ticket 状态是真的 | live 加 `ticket` | P2 |
| TRG-2 | 筛选 Pill 不显示数量（`trigger.tsx:20-21`），“加载更多”通过把 `limit` 增加 20 后**整表重拉**（`trigger.tsx:26`）；之后每次 live 事件都重拉全部 N 条 | 知道每个筛选下有多少；长列表滚动顺畅 | Tabs 加计数 Badge（服务端返回计数）；DataTable 用游标分页加虚拟滚动，live 事件只刷新首页并合并 | P2 |
| THR-1 | 时间线上所有 Trigger 共用一个 `requeue` useAction（`thread.tsx:113`）：一个在跑时，其他行全部禁用，并且重入保护会吞掉点击。Requeue 按钮平时 `opacity:0`，只在悬停或 focus-visible 时出现（`client.css:67-68`），键盘用户 Tab 到之前看不见 | 对哪一条重排就只影响那一条；功能可被发现 | 每行独立的 action 状态；Requeue 改为行尾常驻的 IconButton，配 Tooltip“重新评估” | P2 |
| THR-2 | 取消订阅放在页面最底部的“危险区”（`thread.tsx:170-175`），前面是完整的时间线，可能长达数百条，必须先滚到底 | 随时能取消订阅 | Drawer 头部放“更多”IconButton，弹出 Popover 菜单，其中“取消订阅”二次确认（Popover，danger） | P1 |

## 5. Eval（EV）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| EV-1 | “仅 24 小时”只在 URL 带 `window` 时出现，而且只能**关掉**（`eval.tsx:33`），在 Eval 页内无法打开 | 在本页自由切换时间范围 | 筛选栏右侧常驻 Select（全部 / 24 小时 / 7 天），和决策类型 Tabs 并列 | P1 |
| EV-2 | 暂停横幅只给一个跳到 Execution 的链接（`eval.tsx:25-28`），恢复要多一次跳转加一次确认 | 就地恢复 | 横幅内直接放“恢复处理”Button，调用共享的 pause action（可逆，执行后弹撤销 Toast） | P2 |
| EV-3 | 列表不订阅 `ticket`（`eval.tsx:19-20`），行标题的 `ticketTitle` 和跳转目标可能过时 | — | live 加 `ticket` | P2 |

## 6. Execution 与 Ticket 详情（EX / TK）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| EX-1 | 暂停/恢复是“outline 按钮 → 弹窗确认 → 等 POST → 等 `GET state`”（`execution.tsx:26,39-41`），状态行只有一段文字 | 一下切换，马上看到 | 页头放 Switch“处理中”，乐观更新 `state.paused`，弹 Toast“已暂停 · 撤销”；Console 和命令面板复用同一个 action（见 X-8） | P1 |
| TK-1 | Ticket 详情订阅 `activity`（`ticket.tsx:110`）。每次工具调用都会触发 activity，Console 自己的注释都说它*streams too often to reload for*（`console.tsx:45`）。结果是**任何 Session 的任何工具调用**都会让所有打开的 Ticket 详情重拉 `GET tickets/:id` | 只在本 Ticket 相关变化时刷新 | 订阅 activity 时按 `data.ticketId === id` 过滤；或者不订阅 activity，把“当前在做什么”单独从 live 流就地渲染（复用 Console 的 Lane 组件） | P1 |
| TK-2 | 重试在页头（`ticket.tsx:131`），停止在页面底部危险区（`ticket.tsx:192-196`），中间隔着授权详情、Inputs、Threads 和一串折叠项 | 主要操作集中在一处 | Drawer 头部操作区放 Retry（Button）、打开 Session（Button）、更多（IconButton→Popover：停止，danger 确认）；底部危险区删除 | P1 |
| TK-3 | 标识符和执行目录用 `KeyValues`（`ticket.tsx:185-190`），不能复制；各个 `Details` 每次进入都重置为折叠（`ticket.tsx:40-45`） | 方便复制 id 和路径；折叠偏好保留 | KeyValue 组件支持 `copyable`（IconButton 加 Tooltip“已复制”）；Disclosure 的开合状态按区块名记在 sessionStorage | P2 |

## 7. Console（CON）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| CON-1 | 事件日志最多 400 行（`console.tsx:26`），不做虚拟化，每个事件整表重渲染（`console.tsx:62,125`）。暂停期间 `held.current` **无上限地**累积（`console.tsx:61`） | 高频时也不卡；暂停很久不爆内存 | DataTable 虚拟滚动（固定行高）；`held` 限制为 `LOG_LIMIT`，超出部分显示 Badge“+N 已丢弃” | P1 |
| CON-2 | Lane 的名字是纯文本（`console.tsx:166`），要看对应 Ticket 只能去 Execution 页翻 | 从正在跑的工作直接看到详情 | Lane 标题可点，在 Drawer 中打开该 Ticket；“停止”改为 IconButton 加 Popover 确认（danger） | P1 |
| CON-3 | 每个 Lane 各开一个 1s `setInterval`（`console.tsx:36-39`）；导出按钮用的是 `external` 图标（`console.tsx:116`）；9 个主题 Pill 加一个只能移除的节点 Pill（`console.tsx:120-123`），无法多选 | — | 用单一全局 ticker（页面不可见时暂停）；导出用 download 图标；主题筛选改为 MultiSelect，节点筛选作为其中的一组预设 | P2 |

## 8. Settings 外壳与通用设置块（SET）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| SET-1 | **切换设置分组会整页闪一次**。每个 case 各自包一层 `<SettingsProvider>`（`settings.tsx:20-22`），外层又是 `PipelineFocusProvider key={group}`（`settings.tsx:31`）。分组一切换，Provider 重新挂载，`GET settings` 重新请求，`if (!data) return <LoadState/>`（`settings-kit.tsx:27`）把整个分组替换成骨架；流水线地图的焦点轨迹也被清空 | 在 Source、Eval、Execution 之间来回切换时是瞬时的 | `SettingsProvider` 提到 `SettingsPage` 外层，只建一次；去掉按 group 的 key；分组内容用 Tabs 的 `keepMounted` 或缓存渲染 | P1 |
| SET-2 | `SettingsPage key={state.masterId}`（`app.tsx:180`）：一旦 masterId 变化（例如保存会重启的字段后，主 Session 重建），整个设置页重新挂载，滚动回顶，折叠状态重置，其他块的草稿从 sessionStorage 恢复并被标记为“已恢复”（`draft.tsx:139-141`）；草稿 key 也含 masterId（`settings-kit.tsx:37`），旧草稿成了孤儿 | 保存后留在原地，焦点不丢 | 去掉 `key`；草稿 key 改用稳定的 profile 标识，或者 masterId 变化时迁移草稿；保存后恢复焦点的逻辑（`settings-kit.tsx:44-55`）保留 | P1 |
| SET-3 | 设置导航（`settings.tsx:32-36`）看不出哪个分组有未保存草稿；草稿保存在 sessionStorage，切走之后容易忘 | 离开前知道哪里没存 | 导航项加 Badge 圆点（未保存）；离开分组时如有草稿，不拦截，只在 Toast 里提示“Eval 有未保存修改” | P1 |
| SET-4 | “放弃”没有确认，也没有撤销（`draft.tsx:206`）；Prompts 的放弃还会重拉（`prompts.tsx:75`）。长段 prompt 改动一键就清空 | 误点能找回 | 放弃后弹 Toast“已放弃 · 撤销”，把被丢弃的草稿在内存里保留 10s | P1 |
| SET-5 | 同一页有两套 SaveBar：Eval 页的 Policy 和 Eval 设置是两个 form，各有一个 sticky SaveBar（`eval.tsx:157,200`），两边都改要分两次保存，两个 bar 在底部叠在一起 | 一次保存本页所有改动 | 保留按块的 revision，但页面级 SaveBar 汇总“2 个块有改动 · 全部保存”，依次提交；任一块冲突时就地展开该块的错误 | P1 |
| SET-6 | 保存反馈出现两次：Toast“已保存”（`settings-kit.tsx:39`），同时 SaveBar 在 `awaitingRevision` 阶段显示“已保存”（`draft.tsx:124`）；随后 SaveBar 消失，焦点转到整个块容器（设为 `tabIndex=-1`，见 `draft.tsx:197`），表单块上出现一个大焦点框 | 安静、确定的保存确认 | 只保留一种反馈：SaveBar 在原位置显示 Badge“已保存 ✓”约 1.5s 后收起，不再弹 Toast；焦点回到触发保存的按钮之前所在的字段（`Fields` 已经记录了它） | P2 |
| SET-7 | “立即同步”在草稿有改动时**看起来可用**，点了只弹一条 Toast“请先保存”（`eval.tsx:78-80`） | 知道为什么不能点 | 有草稿时 Button 禁用，并用 Tooltip 说明；或者改成“保存并同步”的组合动作 | P1 |
| SET-8 | 准入表每行最多 3 个原生 select（`eval.tsx:112-115`），窄屏横向溢出；警告图标在固定槽位里（`eval.tsx:116-117`） | 在窄屏也能看清并修改 | DataTable 首列固定、横向滚动；单元格用 Select；警告用 Badge(warn) 加 Tooltip | P2 |
| SET-9 | 删除规则立即生效，没有撤销（`eval.tsx:173`）；规则启用 Switch 浮在 DisclosureRow 外（`eval.tsx:66-67`），与标题行不对齐 | 删错能撤回；开关和标题对齐 | 删除后弹撤销 Toast；规则行改为 Card 头部，包含名称、启用 Switch、更多（复制/删除）的 Popover | P2 |
| SET-10 | 模型字段是三个自由 Input 加 `<datalist>`（`settings-kit.tsx:84-102`）：可选项不明显，provider→model→effort 没有联动校验；目录只加载一次（X-3） | 从可用模型里选，出错前就拦住 | 三级联动 Combobox（provider→model→effort），首项为“继承默认（显示默认值）”；不在目录中的值显示 Badge(warn)“未在目录中” | P1 |

## 9. Agent preset 选择器（AP）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| AP-1 | 目录只在挂载时请求一次（`agent-preset.tsx:21`），不订阅任何主题，不随重启刷新，出错时没有重试；服务端响应里还带 `selected`（远端 `src/app/http.ts:245-248`），在页面上也会过时 | 看到 DSH 当前真正提供的预设 | 共享查询，订阅 settings、health、reset，依赖 `restarts`；出错时显示 EmptyState 加“重试”；Eval 与 Execution 两处共用同一份缓存 | **P0** |
| AP-2 | 自定义 id 回车后直接写入草稿（`agent-preset.tsx:63-68`）。注册表里没有的 id 会被合成为一张“对 worker 和 orchestrator 都兼容”的卡（`agent-preset.tsx:23-25`），实际是否兼容无从知道 | 填错的 id 不要被当作有效项 | 用 Combobox 的自由输入；未知 id 的卡显示 Badge(warn)“未在注册表中 · 兼容性未知”，而不是声称兼容 | P2 |

## 10. Prompts 与 Prompt presets（PRM）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| PRM-1 | **`GET prompts` 只加载一次**（`prompts.tsx:26-31`），不订阅 `prompts` 主题，尽管该主题存在（远端 `src/app/store.ts:47`）。别人或另一个标签页保存后，本页的“已保存”基线、历史列表、`sessions` 都是旧的，直到自己保存撞上 409 才重拉（`draft.tsx:168-169`）。preset 库同样如此（`prompt-presets.tsx:27-29`） | 协作编辑时及时看到别人的改动，在编辑过程中合并，而不是保存时才失败 | 共享查询订阅 `prompts`、reset；revision 变化时走现有的 `revisionArrived` 三方合并（`draft.tsx:95-106`），SaveBar 显示“已合并 rN”；preset 库同步订阅 | **P0** |
| PRM-2 | 完整 prompt 视图在 `!preview \|\| error` 时**整块**替换为 LoadState（`prompts.tsx:271`），一次预览失败就看不到任何内容。各视图按条件渲染（`prompts.tsx:69-73`），切回“完整”时组件重新挂载，目标角色和对比基准的选择丢失，还要重新合成一次 | 预览失败时还看得到上一版；切换视图时保留选择 | Tabs 的 `keepMounted`；出错时保留旧预览（变暗），头部显示 Badge(error) 加“重试”IconButton；`target`/`compare` 状态提到 `PromptsEditor` | P1 |
| PRM-3 | 删除 skill（`prompts.tsx:194-195`）和“重置为默认”（`prompts.tsx:196-198`）立即改写草稿，没有确认；删除后选中项跳到 `communication`，导航焦点丢失 | 误删可撤回；选中项停在相邻的条目上 | 删除后弹撤销 Toast；选中项移到相邻的 skill，焦点放到该导航项 | P1 |
| PRM-4 | preset 链上，焦点在 chip 时按 **Backspace/Delete 就移除**（`prompt-presets.tsx:63`），没有撤销。拖拽排序用原生 HTML5 DnD（`prompt-presets.tsx:65,80-84`）：没有插入位置指示，触屏不可用，键盘 Alt+方向键移动后也没有读屏播报 | 安全地调整顺序 | 改用 MultiSelect（可拖拽排序）：拖拽手柄、插入线、指针和键盘传感器、`aria-live` 播报“已移到第 n 位”；移除只能通过 chip 上的 IconButton，并弹撤销 Toast | P1 |
| PRM-5 | preset 库：删除团队 preset 立即保存（`prompt-presets.tsx:215-217`），没有确认；导入同 id 静默覆盖（`prompt-presets.tsx:179`）；编辑器在同一个 Modal 内替换列表（`prompt-presets.tsx:185-188`），返回后列表滚动位置丢失 | 管理 preset 不怕误操作 | 库改为 Drawer（列表与编辑并排，或用二级 Drawer）；删除用 Popover 确认(danger)；导入前先预览“新增 N / 覆盖 M”，确认后再保存 | P1 |
| PRM-6 | Prompt 组成条的各段只有原生 `title` 提示（`prompts.tsx:169-172`），按字数比例分配宽度时，短的段很难点中，键盘和触屏也看不到提示 | 知道每段是什么，并能点中 | 每段设最小宽度（`--hx-ui-space-2`）；用 Tooltip 组件（悬停和聚焦都触发）；条形之外附一个可聚焦的段落列表 | P2 |

## 11. Deployment 与命令面板（DEP / CMD）

| ID | 现状 | 用户意图 | 改法 | 优先级 |
| --- | --- | --- | --- | --- |
| DEP-1 | 不可编辑时，三个限值 Input 只是 `disabled`（`deployment.tsx:53`），原因只在分区顶部一行 Hint（`deployment.tsx:49-51,70`）；SaveBar 整个隐藏（`deployment.tsx:82`），和其他块的“只读”呈现不同 | 知道为什么不能改、去哪里改 | 只读时用 KeyValue 展示数值，分区头部加 Badge“只读”和 Tooltip 说明原因（memory 模式 / 未就绪）；可编辑时用统一的 SaveBar | P2 |
| CMD-1 | 命令面板只有页面、设置分组、主 Session 和暂停（`command.tsx:35-45`），找不到具体的 Ticket/Thread；暂停不经确认，与页面上的行为不同（见 X-8） | ⌘K 能直达任何对象 | 与 X-13 合并：命令和搜索结果放在同一个 Combobox 里；动作复用共享 action | P1 |

---

## 汇总

| 优先级 | 数量 | 条目 |
| --- | --- | --- |
| **P0** | 5 | X-1、X-3、SRC-1、AP-1、PRM-1 |
| **P1** | 34 | X-2、X-4、X-5、X-6、X-7、X-8、X-9、X-10、X-11、X-12、X-13、OV-1、OV-3、SRC-4、SRC-6、THR-2、EV-1、EX-1、TK-1、TK-2、CON-1、CON-2、SET-1、SET-2、SET-3、SET-4、SET-5、SET-7、SET-10、PRM-2、PRM-3、PRM-4、PRM-5、CMD-1 |
| **P2** | 20 | X-14、X-15、X-16、OV-2、SRC-2、SRC-3、SRC-5、TRG-1、TRG-2、THR-1、EV-2、EV-3、TK-3、CON-3、SET-6、SET-8、SET-9、AP-2、PRM-6、DEP-1 |
| 合计 | 59 | |

**建议实施顺序**：
1. 共享查询缓存与 live 过滤（支撑 X-3、X-4、X-5、AP-1、PRM-1）；
2. Drawer 详情路由（X-1、TK-2、THR-2、CON-2、OV-1）；
3. 统一的 action 层，包括确认策略、乐观更新和撤销 Toast（X-7、X-8、X-9、EX-1）；
4. Settings 外壳不再重新挂载，SaveBar 统一（SET-1、SET-2、SET-5、SRC-1）；
5. 组件替换：Tabs、Select、MultiSelect、DataTable、EmptyState、Skeleton。
