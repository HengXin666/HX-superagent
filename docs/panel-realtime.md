# 面板实时数据契约

日期：2026-11-15 · 分支 `feat/panel-v2` 工作树 · 对应需求：“交互要实时、要顺手. 操作后立刻有结果; 调度或别人改了状态, 页面马上变; 流程贴合‘发现问题 → 就地处理 → 看到影响’.”

## 1. 需求拆解

这句话是三条可验收的要求，外加一条总标准：

1. **操作后立刻有结果**：点下暂停、停止、重试、移除，界面在主机回答之前就变成“正在做/已做”的样子；主机拒绝时退回原样并说明原因，绝不显示一个没有发生的成功。
2. **调度或别人改了状态，页面马上变**：任何后端状态（Store 写入、删除、健康状态、执行位起止）都有一个发出点推到 live feed，所有打开的视图在 2 秒内自己变；实时通道断开时，页面如实说出“数据截至多久前”。
3. **流程贴合“发现问题 → 就地处理 → 看到影响”**：问题在哪个视图被看到，就在那里处理（列表行、Ticket 详情抽屉、总览问题行），处理后同一位置立即呈现结果，保存后提示生效方式（立即 / 下一次请求 / 将重启）。
4. **总标准：所见即真实**。屏幕上的状态等于系统当下的状态；做不到（断线、加载中、未确认）就明说。

## 2. 改之前的缺口（按代码核查）

| 缺口 | 位置 | 后果 |
| --- | --- | --- |
| `health` 主题被 6 个视图订阅，但从未发出 | `src/infra/health.ts` 无变更通知；`src/app/runtime.ts` 只转发 Store 写入和 Session 活动 | Source 掉线/恢复、模型不可用、setup pending 最多晚 60 秒才出现（live 连上后兜底轮询放宽到 60 秒） |
| `Store.delete()` 不产生事件 | `src/app/store.ts` | 删除 `prompt-*` / `settings-*` 键，其他窗口不刷新 |
| 执行位标识在 live feed 里丢失 | `src/app/live.ts` 的 `stageOf()` | 监控台无法把 `assignment.started/ended` 落到具体执行位 |
| 顶部负载不随执行位起止刷新 | `src/client/provider.tsx` 的 `GET state` 不订阅 `stage` | 执行位数字滞后到下一次 Ticket 写入 |
| 同一端点并发重复拉取 | 每个 `usePoll` 各发各的 | 状态轮询、总览、Source 页同时挂载时同一地址打多次 |
| 没有统一的乐观更新落点 | 停止、重试“请求 → 重拉”后才变 | 点完按钮要等一个往返才有反应 |
| 断线时看不出数据多旧 | 头部只显示“轮询” | 过期数据冒充当前数据 |
| 模型目录、设置历史是一次性加载 | `src/client/settings-kit.tsx` | 别处改了这里不变 |
| 已过滤列表缺 `health` 订阅 | `src/client/filtered.tsx` | Source 状态行滞后 |

## 3. 主题表与发出点

| 主题 | 载荷 `data` | 发出点 |
| --- | --- | --- |
| `trigger` `thread` `ticket` `decision` `outbox` | 无（只说该主题变了） | `Store.touch()`，事务提交后合并为一次 `Store.onChange` → `runtime.ts` 里 `live.emit(topic)` |
| `settings` `prompts` | 无 | 同上；`Store.set()` 与 `Store.delete()` 都会 touch（本次补上 delete） |
| `health` | `{ entries: string[] }`，本批真正变化的健康项名，已排序 | `HealthBoard.onChange`（只在 state/code/detail/values 变化或条目释放时触发，单改 `at` 不触发）→ `LiveHub.health(name)`，同一任务内的多次变化合并为一个事件 |
| `stage` | `Stage`：`type`、`node`、`at`，以及 `ticketId` / `threadKey` / `triggerId` / `decisionId` / `assignmentId`（本次新增）/ `detail` | `Engine` 的 `emit` → `live.stage(event)` |
| `activity` | `Activity`：`sessionId`、`role`、`ticketId?`、`kind`、`tool?`、`summary`、`state?` | `runtime.ts` 的 `watchActivity()` |
| `reset`（仅客户端） | `{ seq }` | 服务端已不保留续传点时，客户端通知所有视图重载 |

规则：载荷只增不改，旧订阅者不受影响；带载荷的事件可被视图的 `filter` 过滤，无载荷事件和 `reset` 一律触发重载。

## 4. 前端共享层用法

- **请求去重**：`caller()` 对没有自带 `signal` 的 GET，同一地址在途时共享同一个请求（`shareRead`）。所有视图自动受益，不必迁移调用点。
- **`usePoll(load, deps, interval, { live, filter })`** 现在额外返回：
  - `updatedAt`：主机最后一次确认该数据的时间；
  - `mutate(patch, action)`：先用 `patch` 改屏幕上的数据，再跑 `action`，成功后按主机答案重载，失败则退回原数据并把错误抛出给调用方（`useAction` 会弹出错误提示）。
  - 实时通道从断开恢复为连接时，自动补读一次，防止断线期间的变化漏掉。
- **面板状态**：`usePanelData()` 新增 `updatedAt` 与 `mutate`；`GET state` 订阅 `ticket`、`settings`、`health`，以及 `stage` 中执行位与 Ticket 起止的步骤（`assignmentStep` 过滤器）。
- **头部指示**：实时时显示“实时”；离开实时或最近一次读取失败时显示“轮询 · 数据截至 N 秒前”，每 5 秒更新。

## 5. “就地处理 → 看到影响”的落点

- Ticket 详情页与 Ticket 列表行：停止、重试点下后按钮立即让位给“正在停止… / 正在重试…”标记；主机拒绝则按钮回来并提示原因。详情页同时订阅本 Ticket 的 `stage` 步骤，执行位起止即时可见。
- 暂停/恢复：沿用 `usePause` 的即时切换与撤销提示，现在顶部负载也会随执行位事件立即变化。
- 设置保存后提示“已保存 / 已保存，将重启”，提示词保存后提示“下一次请求生效 / 待送达”（沿用已有逻辑）。
- 模型目录在模型健康变化或别处保存设置时自动重读；设置历史展开期间，别处的保存会立即加一行。

## 6. 测试

- `tests/realtime.spec.ts`：健康真实变化才发事件、单改时间不发、释放条目也发；同批变化合并为一个 `health` 事件；删除设置与提示词产生事件；执行位事件带 `assignmentId`。
- `tests/panel-realtime.spec.tsx`：同一地址在途请求只发一次；首屏每个 GET 地址只请求一次；`mutate` 立即生效、成功保留、失败回滚；`health` 事件让状态与总览重载；`assignmentStep` 过滤；断线后头部显示数据时间。

## 7. 本机验收

1. `LC_ALL=C pnpm check`。
2. 两个浏览器窗口：一个暂停执行或保存设置，另一个 2 秒内变化。
3. 让一个 Source 掉线再恢复（例如临时改错 GitHub CLI 路径再改回），总览与 Source 页 2 秒内变化。
4. 停掉实时通道（重启插件），头部出现“数据截至 N 秒前”，恢复后自动补读并回到“实时”。
5. 对一个运行中的 Ticket 点停止：按钮立即变为“正在停止…”，完成后从列表消失。

## 8. 未做

- 总览问题行直接开抽屉逐条处理已过滤条目（OV-1）、Thread 详情按 key 过滤 `ticket` 事件（Store 写入无载荷，需服务端先给 `ticket` 主题带 id）。
- 高频 `activity` 事件的服务端合并；目前由客户端 120ms 去抖。
- 实机双窗口与截图需在本机完成。
