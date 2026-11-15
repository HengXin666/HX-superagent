# 面板 v4 · 线3 需求分析：所见即真实 + 统一设计语言

日期：2026-11-15 01:40 CST · 依据：经 hxoa 只读查看的本机工作区 `components/HX-superagent`（分支 `feat/panel-v2` @ `2884e9d`，工作树 60 个已修改 + 17 项未跟踪，即 v2/v3 的未提交改动）。行号均为当前工作树里各文件自身的行号。
本文只做分析与实施方案，**没有改动任何代码**；为什么停在这里见第 6 节。

## 1. 这段话到底在要什么

原文把一个感受（“不实时、不合理、低级、廉价”）拆成三个可验收的层，并且明确拒绝一种做法：

| 层 | 用户的话 | 真正的验收口径 | 明确不要的 |
| --- | --- | --- | --- |
| 数据层 | 有些视图一次性加载、订阅主题漏了，改了别处这里不刷新 | 任何一处数据变化，正在看的视图 2 秒内自己变；断线时明确告诉我“数据截至何时” | “加个刷新按钮”“缩短轮询间隔”这类掩盖 |
| 流程层 | 先看到问题再去改，改完马上知道影响 | 问题→定位→就地修→立即看到结果与影响，一条路径走完，不跳页、不丢上下文、不等轮询 | 只把按钮换好看，操作顺序不变 |
| 视觉层 | 一套统一的现代设计语言（层级、留白、动效、空/加载/错误态） | 先定 token，再统一组件和四种状态，最后整页迁移；全面板只有一套视觉来源 | 逐个组件打补丁 |

“交互所见即真实”是总标准：屏幕上显示的任何状态，都必须等于系统当下的真实状态；做不到时（断线、加载中、失败、乐观更新未确认）界面要如实说出来。

## 2. 数据层：代码里查到的根因

### D1（最关键，新发现）`health` 主题从未被发出
- `src/app/live.ts:8` 声明了 `health` 主题；6 个视图订阅它：`provider.tsx:106`（全局 `GET state`）、`overview.tsx:80`、`source.tsx:137`、`settings-kit.tsx:29`、`console.tsx:68`、`agent-preset.tsx:26`。
- 但服务端只转发两类事件：Store 写入（`runtime.ts:227` 的 `store.onChange`，主题限于 `StoreTopic`，`store.ts:47` 不含 `health`）和 Session 活动/阶段（`runtime.ts:145,253-263`）。
- `HealthBoard`（`src/infra/health.ts`）的 `set()` 只改内存，没有任何变更通知。
- 后果：Source 掉线/恢复、模型不可用、runtime 从 starting 变 ready、setup pending 等状态变化**不会推送**。更反直觉的是，live 连上后 `usePoll` 把兜底轮询从 5s 放宽到 60s（`api.ts:64,100`），所以**连上实时通道反而让健康状态最多晚 60 秒**。这正是“改了别处这里不刷新”的典型体感。
- 修法：`HealthBoard` 增加 `onChange`（值相同不触发），`runtime.ts` 订阅后 `live.emit('health')`。需要改 `src/infra/health.ts`。

### D2 一次性 / 半一次性加载
- `ModelField` 的模型目录（`settings-kit.tsx:84-85`）只在挂载和 `restarts` 变化时拉，不订阅任何主题，失败只有一行红字没有重试。
- Agent 预设目录（`agent-preset.tsx:24-26`）订阅了 `settings, health`，但 `health` 是死主题（D1），也不依赖 `restarts`；Eval 和 Execution 两处各请求一次。
- 设置历史（`settings-kit.tsx:144`）只在展开和 revision 变化时拉，展开期间别人保存不会刷新列表。
- `prompts.tsx:34`、`prompt-presets.tsx:33` 已在未提交改动里补上 `prompts` 订阅（审计 PRM-1 当时为 P0），提交前它们仍不算数。

### D3 订阅漏项与过订阅
- `filtered.tsx:57` 订阅 `trigger, outbox, settings`，缺 `health`（Source 状态行的健康）。
- `GET state`（`provider.tsx:106`）承载顶部负载与执行位，但执行位的开始/结束走 `stage` 事件（`live.ts:22` 的 `assignment.started/ended`），该视图不订阅 `stage`；若 assignment 起止不伴随 ticket 表写入，顶部负载会滞后，需在实机核对。
- `Store.delete()`（`store.ts:201`）不调用 `touch()`：删除 `prompt-*`/`settings-*` 键不会产生事件。
- Ticket 详情已按 `ticketId` 过滤 `activity`（`ticket.tsx:111-112`），Thread 详情订阅 `ticket` 但仍不按 key 过滤（审计 X-5），任何 Ticket 变化都会重拉当前 Thread 前 50 条。

### D4 没有共享查询层
- 每个 `usePoll` 自带定时器与请求（`api.ts:86-150`），同一端点（如 `GET sources` 在 `source.tsx` 和 `filtered.tsx`）各拉各的；断线时所有挂载视图各自 5s 轮询（审计 X-4）。
- 乐观更新无处落脚：暂停、停止、重试、Requeue/Dismiss 都要“请求→120ms→重拉”后界面才变（审计 X-9、EX-1）。

### D5 错误与过期状态不如实
- 已有数据时仍渲染 `LoadState error ... have`（`overview.tsx:95`、`ticket.tsx:141`、`thread.tsx:143`），瞬时错误插一段红字顶开布局（审计 X-6）。
- v3 只给 Console 加了断线横幅（`console.tsx`），其余页面断线时没有“数据截至何时”。

## 3. 流程层：操作顺序与用户意图不符的地方

用户意图是一条直线：**看到问题 → 定位到要改的地方 → 就地改 → 立刻看到结果和影响**。现在每一段都有断点：

1. 看到问题：Overview 的“24 小时已过滤/已丢弃”只跳到整个 Source 页，要逐个展开折叠行才能找到条目（OV-1）。
2. 定位：列表进详情是整页替换（X-1，审计 P0），返回后“加载更多”和滚动位置全丢。
3. 就地改：Thread 的“取消订阅”在长时间线最底部（THR-2）；仓库表保存流程自成一套，忽略 `restarting`（SRC-1，P0）；Eval 页两个 SaveBar 要分两次保存（SET-5）；切换设置分组整页闪成骨架、地图焦点清空（SET-1）。
4. 立刻看到结果：无乐观更新（X-9）；确认策略反了，可逆的 Retry 要确认、不可逆的 Stop 用主色（X-8）；保存反馈出现两次随后焦点框跳到整块（SET-6）。
5. 知道影响：v3 的 `impactOf()` 只在保存前标出下游步骤；保存后服务端其实返回了生效方式（`prompts.ts:269` 的 `effect: 'next-request'` 与 `context_delivery`，设置保存的 `restarting`），界面没有把“已对哪些 Session 生效 / 下一次请求生效 / 将重启并中断 N 个 Assignment”说出来。

## 4. 视觉层：为什么看起来“廉价”

数字说明了“逐个组件打补丁”就是当前状态：
- `client.css` 68.5 KB，675 处 `.dt-` 选择器，788 处写死 px，10 处写死颜色，**`--hx-ui-*` token 使用 0 次**。
- 新组件库 `src/client/ui/` 已存在（v2 交付），但业务页面只有 12 个文件引用它，23 个仍走旧的 `controls.tsx`。
- `Skeleton`/`EmptyState` 只在 `console.tsx`、`widgets.tsx` 用到；其余页面的加载态、空态、错误态各写各的。
- `docs/panel-v2-visual-direction.md` 已经定好字号、4px 间距刻度、圆角、动效 token，但没有落进 `client.css`。

结论：缺的不是组件，而是“token 先行 → 四态统一 → 整页迁移”的顺序。

## 5. 线3 实施方案（待解锁后执行）

按依赖顺序，每步单独提交、各自可回滚：

1. **实时底座**：`HealthBoard.onChange` → `live.emit('health')`；`Store.delete` 补 `touch`；新增共享查询 `useQuery(key, load, { live, filter })`（同 key 去重、`reset` 统一失效、断线只轮询可见页、支持乐观补丁与失败回滚）。`usePoll` 保留为它的薄包装，现有调用点不必一次全改。
2. **清零一次性加载与漏订阅**：模型目录、Agent 预设目录、设置历史、`filtered.tsx`、Thread 按 key 过滤、`GET state` 视实机结果补 `stage`。逐条对照审计第 0 节表格标记“已修/不修及理由”。
3. **如实的状态**：全局“实时 / 重连中 / 数据截至 12s 前”指示与固定占位横幅，替换页面里插入的红字；乐观更新 + 撤销 Toast 覆盖暂停/恢复、停止、重试、Requeue、Dismiss，所有入口共用同一 action 定义。
4. **流程重排**（按三条高频路径）：总览→处理问题（问题行直接开 Drawer 列出条目并就地处理）；查 Ticket（列表 + 右侧 Drawer，Esc 焦点归还，窄屏退化整页）；改设置并保存（Provider 提到分组之上不再闪、页面级 SaveBar、保存后显示生效范围与影响）。
5. **设计 token 落地**：把 visual-direction 的字号/间距/圆角/阴影/动效写成 `--hx-ui-*`，替换 `client.css` 写死值，样式守卫禁止回流。
6. **四态统一 + 页面迁移**：Skeleton / EmptyState / ErrorState / 成功反馈一套组件，Overview、Execution、Ticket、Settings、Console 分批切到 `ui/`。

验收对应 v4 计划线3 的 6 条：前后对比截图、跨视图 2 秒内反映、审计逐条标记、断线提示、键盘与 900px 窄屏、`LC_ALL=C pnpm check`。

## 6. 卡在哪（需要你决定）

1. **线1 基线还没落地。** 工作树仍是 60 个已修改 + 17 项未跟踪的 v2/v3 改动，没有基线提交、没有基线分支、没有实机复现报告。线3 按计划要基于线1 基线开分支。我现在往工作树里写，会把线3 的改动混进线1 要整理的那批未提交文件，正是 v3 交付说明里“改动被还原、实例跑旧构建”那类事故的温床。这是线1 的活，不在我这条线内。
2. **hxoa 现在只能读写文件 + 只读 git。** 这次从 GitHub 源码构建的 hxoa 没有 exec，`git` 只放行查询（`git stash list` 被拒）。我无法跑 `tsc`/`vitest`/`build`、无法建分支或提交、无法重启实例截图，线3 的 6 条验收一条都没法由我闭环。
3. **D1 的修复要改 `src/infra/health.ts`。** 计划给线3 划的是 `src/app` 的事件流和 `src/client`，`src/infra` 不在里面，需要你确认可以动。
4. **范围重叠。** 仓库 `.hark/plan.md`（组件库原子化、token、暗色、键盘）与线3 的视觉部分大面积重叠，需要明确它属于哪条线，避免两边同时改 `client.css` 和 `src/client/ui/`。

解锁方式（任选）：线1 先提交基线并开好线3 分支；或你明确授权我直接在当前工作树上改，由本机执行者负责跑检查和提交。

## 7. 复核（2026-11-15 01:50 CST，按重发的线3 任务书）

- 第 6 节第 3 条已解除：新任务书明确授权改 `src/infra` 与 `src/app` 中和实时事件相关的部分（D1 `HealthBoard.onChange`、`Store.delete()` 补 `touch()` 都在此范围内）。
- 第 1 条仍在：`.git/refs/heads` 下只有 `main` 和 `feat/panel-v2`（HEAD `2884e9d`），没有线1 基线分支或基线提交，线3 无处“基于线1 基线”开分支。
- 第 2 条更严重了：hxoa 的 `git` 端点现在对任何参数都返回“/home/hx 不在 rw 挂载根之下”，连 `status`/`log` 都跑不了；仍然没有 exec。因此 `pnpm check`、测试、建分支、提交、实机双窗口验证、截图都无法由我完成，而任务书要求所有产物“已提交并列出提交号”。
- 第 4 条（`.hark/plan.md` 与视觉部分重叠）未见答复。

结论：没有开始写代码。往一个无法编译、无法测试、无法提交、且其他执行者也在改的工作树里写几十个文件，最可能的结果是“显示完成实际坏掉”，正是本线要消灭的那类问题。

解锁所需（满足前两条即可开工，第 3 条可后补）：
1. 线1 提交基线并建好线3 分支（或明确说“直接在 feat/panel-v2 上做”）。
2. 给一个能执行命令的通道（本机执行者代跑 `LC_ALL=C pnpm check` 与 `git commit`，或 hxoa 恢复 git 写/exec）。
3. 说明 `.hark/plan.md` 的视觉部分归哪条线。
