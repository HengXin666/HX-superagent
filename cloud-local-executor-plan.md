# dsh-superagent：云端派活、本地执行、多人隔离方案

日期：2026-11-10。只出方案，不改代码。
核对范围：
- dsh-superagent（本仓库）：`src/core/ports.ts`、`src/executor/dsh.ts`、`src/app/sessions.ts`、`src/app/tools/executor.ts`、`docs/003`、`docs/006`、`docs/007`。
- 本机 DSH 运行时 `~/.dsh/runtimes/rc2-stage`。
- 同级原型 `../HX-SuperAgent/edge`。
- 论文：DSH 团队的 Super-agent 设计文章，即 `HXLoLi/ai-docs/.../004-Super-agent设计探索双层架构与事件驱动`。

## 0. 结论

- 目标形态由三件事组成：云端 main dsh 派活；本地执行体接活，本地离线时由云端自己做；多人互相隔离。现有架构只具备第一件，后两件都没有。
- 论文第 5 节写了"端侧 daemon、云端补跑"的做法，但把"多人或多组织怎么划隔离"列为第 8 节的未解决问题，所以隔离这一块没有现成答案可照抄。
- 推荐路线：
  - 本地执行体做成完整的 worker，在本地跑一个 DSH worker 会话，不采用论文里"无状态 daemon 只执行命令"的做法。
  - 云端在 Executor 端口后面加一层路由：本地在线就派给本地，不在线就交给现有的 DshExecutor。
  - 多人隔离按"每人或每组一个实例"来做。
  - 本地 worker 的模型 key 走云端模型代理，按租户配额计费（见第 3 节末尾）。
- MVP 预计 27 到 38 人日，其中最大的不确定性是第 0 步的 spike（2 天），先做它。

## 1. 现有架构离目标差在哪

| 维度 | 现状 | 目标 | 差距 |
|---|---|---|---|
| 进程形态 | dsh-superagent 是 DSH 进程里的 cordis 插件。main Session 和每个 `worker-<ticket>` 都由同一进程用 `ctx.agents` 创建 | 云端只放 main Session，worker 可以在另一台机器上 | 进程内没有"远端 worker"这个概念 |
| 执行环境 | worker 以运维者的 OS 用户在本机 `<stateDir>/work` 下运行。prepare 命令和 git/gh shim 都用本机的 `ctx.subprocess`，凭据靠 `worker-bin` 里的 shim 绑定 | 代码、凭据、内网都留在用户自己的机器上 | 部署到云端以后，worker 拿不到用户本地的环境 |
| 调度接缝 | core 已有 `Executor` 端口（`start`、`deliver`、`stop`），Engine 只依赖这个端口；DshExecutor 是唯一实现 | 根据本地是否在线选择执行者 | 接缝已经有了，这是最大的利好；缺的是第二个实现和一层路由 |
| worker 工具 | `orchestrator_ack`、`_report`、`_thread_follow`、`_thread_unrelated`、`_trigger_handback` 由 `Sessions.install` 注册在本进程的 agent 上，直接调用 Engine | 本地 worker 也要能汇报、提问、跟线程 | 这些工具需要一个远程代理，把调用打回云端 API |
| 离线与恢复 | Assignment 中断后会带 recovery note 重新启动；Input 和 Report 都持久化在 SQLite 里 | 本地掉线时由云端接手，本地上线后补跑 | 恢复机制可以复用。缺的是在线判定、租约，以及防止"旧执行者回来后又报告一次"的 fencing |
| 多人 | 一个部署对应一个 main Session（`orchestrator-<stateDir>`）、一份 Policy、一个 GitHub agent 账号、一个 stateDir。所有允许名单里的人共用 main Session 的上下文 | 不同的人或团队之间上下文、凭据、执行环境互不可见 | 进程里没有任何租户字段；`007` 的 Open questions 把 Deployment isolation 列为未决 |
| DSH 运行时 | `dsh-fs`、`dsh-subprocess`、`dsh-sandbox` 只提供接缝，provider 只有 `-local` 一种。另外有 `dsh-sdk-jsonrpc-server`（进程外 SDK 客户端）和 `dsh-api-remotes`、`dsh-api-remote-access`（对非 owner 的 Peer 暴露 Host 能力） | 要么有远程 provider，要么有可用的进程外会话控制 | 远程 provider 不存在。后两个包可能就是本地 runner 的传输层，但没有验证过，这是 spike 的主题 |
| 现成可复用 | `../HX-SuperAgent/edge/hx_edge.py`：只出不进的 WebSocket、设备 token、argv 白名单、断线补发，带测试 | 本地侧的连接与安全闸 | 只有 daemon 半边，gateway 一侧完全没写；而且它是脑手分离模式，见第 3 节 |

## 2. 论文里哪些已实现，哪些是未来方向

"论文状态"是论文自己的说法（第 1 到第 6 节写的是 DSH 团队已实现的部分，第 8 节是未解决的问题）；"本仓库"是 dsh-superagent 的实际状况。

| 模块（论文章节） | 论文状态 | 本仓库 |
|---|---|---|
| 双层架构：Router 加 Worker（2） | 已实现 | 有：main Session 加 `worker-<ticket>` |
| 两级过滤：程序准入加模型准入（3.1） | 已实现 | 有：Source filter，加上 Eval 的 gate 和 assessment |
| 订阅 Thread 直通（3.2） | 已实现 | 有：订阅线程上的消息直接进 worker，main Session 只收到 follow_up 通知 |
| Router 序点与批处理（3.3） | 已实现 | 有：Thread 串行 Eval 并合并 batch，`orchestrator_route` 一次决定多项 |
| 异步工具：立即返回，完成后回投（3.4） | 已实现 | 有：shell 5 秒后转后台，完成后唤醒同一个 slot |
| 上下文按 Cache 管（Inline 与 Spill） | 已实现 | 部分有：卡片内联截断加按需读资源，但没有按 cache 命中去做编排 |
| 投机执行（4.1） | 已实现 | 无 |
| 按信道回话（4.2） | 已实现 | 有：IM 短句，GitHub 完整说明 |
| 存算分离第一步：无状态计算加数据库（5.1） | 已实现 | 无：SQLite 和 DSH 会话日志与进程在同一台机器上 |
| 端侧 daemon、BYOM、上线补跑（5.2） | 已实现 | 无。HX-SuperAgent 里有 daemon 原型，没有接入 |
| Watchdog（6） | 已实现 | 部分有：每小时一次的检查脚本负责存活检测和重启，但没有让模型判断"有没有实质进展、有没有跑偏" |
| Router 切分、Worker 互通、长程记忆（8） | 未来方向 | 无 |
| 协作：中途介入、接管、实时协同（8） | 未来方向 | 部分有：人可以直接在 Executor Session 里写消息 |
| 边界：组织怎么划共享与隔离，隔离实例之间做 A2A（8） | 未来方向 | 无，这正是"多人隔离"要解决的事 |
| 安全：不可信输入面、云端被攻破波及端侧、"用凭据但碰不到凭据"（8） | 未来方向 | 部分有：shim 绑定账号、清掉 `GH_TOKEN`、命令黑名单 |

结论：目标里的"云端派活、本地执行、离线由云端兜底"属于论文第 5 节已实现、但本仓库还没有的部分；"多人隔离"属于论文自己也没解决的第 8 节。

## 3. 关键取舍：本地执行体做成"完整 worker"还是"手"

方案 A，脑手分离（论文 5.2）
- worker 的模型循环留在云端，只把 `ctx.fs` 和 `ctx.subprocess` 换成远程 provider，本地跑 hx_edge 这类 daemon。
- 最强理由：和论文、Anthropic 的思路一致；本地不存状态，掉线时云端换个 provider 就能继续；本地不用装 DSH。
- 否决理由：
  1. DSH 没有远程 provider，而且接缝是挂在进程级 ctx 上的。要做到"同一进程里有的 worker 在本地、有的在云端"，必须按会话切换 provider，DSH 是否支持未知。
  2. 每一次工具调用都要跨公网，worker 一轮几十上百次调用，延迟成倍放大。
  3. 本地掉线时，云端这一轮会卡在半截的工具调用上；换到云端也没有那份本地环境，所谓"自己做"其实做不了。

方案 B，完整本地 worker（推荐）
- 本地装一个精简 DSH，跑 runner 插件。runner 从云端领取 Assignment，在本地建 worker 会话，用 worker 预设执行，再把 Report 和事件报回云端。
- 最强理由：
  1. 复用现有的 `Executor` 端口和 recovery note，Engine 不用改。
  2. 工具调用全在本地，不受网络延迟影响。
  3. 凭据和代码天然不离开用户机器。
- 代价：
  1. 本地要装 DSH 和模型 key（或者走云端的模型代理）。
  2. 中途切换执行者时，本地会话的推理上下文带不过去，只能靠 Report、Input 加 recovery note 接力。这和现在重启后的恢复行为一样，不算新增的风险。
  3. 和论文"daemon 不存状态"的设定不同：会话日志落在本地。云端对每个 Assignment 只保存结果。

### 本地 worker 的模型 key：云端代理（已定）

结论：本地 worker 不持有任何模型厂商的 key。本地 DSH 的 `llm-deepseek` 把 `baseURL` 指向云端模型代理，凭据引用里放的是本设备的 runner token。代理校验 token，查出所属租户，扣配额，再把请求头里的 `x-api-key` 换成云端的厂商 key 转发出去。云端兜底的 worker 也走同一个代理，这样一个租户的全部用量都记在同一本账上。

依据"凭据不出机器"的原则来划边界：
- 用户的代码、git/gh 凭据和内网只留在本地。
- 厂商 key 只留在云端代理所在的机器上。
- 本地设备只拿到一个可以吊销、只能在配额内调模型的 runner token。

选它而不选 BYOM，是因为整体更省事：
1. **本地零代码。** DSH 原生支持这种接法（dsh 0.2.1-rc.2 源码）：`dsh-llm-deepseek` 的 `baseURL` 可配，也可以从 `$DEEPSEEK_BASE_URL` 读取，默认值是 `https://api.deepseek.com/anthropic`；`dsh-llm-deepseek-api-key` 把 `apiKeyEnv` 指向的凭据作为 `x-api-key` 发出。L1 只需要在本地 profile 里写上这两项。
2. **吊销只有一处。** 设备丢了或人离开了，吊销 runner token，派活和模型调用会同时停掉。BYOM 则要求每台设备各存一把厂商 key，泄露时只能去厂商那边一把把地轮换。
3. **配额本来就要做。** 多租户计费和防滥用迟早要做；做在代理上只需要一个计量点。BYOM 的用量分散在各人自己的厂商账户里，云端看不到。
4. **用户不用去开厂商账户。** 本地只要装 DSH 并登记一个 token。

代价：
- 要新增一个代理，即 M1，2 到 3 人日。它要透传 Anthropic Messages 的流式响应和 Files API（图片），从流里的 usage 计量，超出配额时返回 429。
- 每个模型请求多绕一跳云端。只多在模型请求上，不在工具调用上；模型请求本来就要出公网，增加的只是一次 RTT。
- 云端挂了，本地也调不了模型。不过云端挂了本来就不会派活，这不算新增的故障面。
- 允许租户自己在本地 profile 里改回自带 key，作为逃生口。这样做的用量不进配额，MVP 不为它做任何事。

## 4. 多人隔离怎么做

方案 I，每人或每组一个实例（推荐）
- 每个租户一套 profile：独立的 stateDir、main Session、Policy、GitHub 账号、hxr_ key 和 runner token。
- 云端兜底的 worker 跑在各租户自己的 OS 用户或容器里。
- 最强理由：隔离由进程和文件系统保证，不用改任何领域模型。
- 代价：租户之间不能协作（论文里的 A2A 留到以后再做）；多实例的运维和资源开销线性增长。

方案 II，单进程多租户
- 在 Trigger、Thread、Ticket、Policy、Session、Outbox、KV 上全部加 tenant 字段，按租户分 main Session。
- 最强理由：资源共享，以后做跨租户协作比较顺。
- 否决理由：要改 core 领域模型和全部持久化；一处漏判就会串上下文，一旦出事故就是信息泄露；工作量是方案 I 的 3 到 4 倍。

方案 III，什么都不做，只给一个人用
- 最强理由：零成本，现状就是这样。
- 否决理由：不满足"多人隔离"这个需求。

## 5. 要补的块与工作量（方案 B 加方案 I）

| 编号 | 块 | 内容 | 人日 |
|---|---|---|---|
| S0 | spike | 验证 `dsh-sdk-jsonrpc-server` 或 `dsh-api-remotes` 能否当本地 runner 的控制通道；验证本地 DSH 能否加载 worker 预设和远程代理工具。不行就退回自建 WebSocket，复用 hx_edge 的连接层 | 2 |
| C1 | 云端 RoutingExecutor | 实现 `Executor` 端口：本地在线就派给 RemoteExecutor，否则交给 DshExecutor；记录每个 Assignment 落在哪里，面板上显示 | 3 到 4 |
| C2 | runner 网关 | 设备注册、token 签发与吊销、心跳与在线判定；下发 Assignment 和 Input，接收 Report 和回合结束事件，并按 id 幂等去重 | 4 到 5 |
| C3 | worker 工具代理 | 把 ack、report、thread_follow、thread_unrelated、trigger_handback 和读资源接口包成 HTTP 或 RPC，本地工具调用时打回云端 | 3 |
| L1 | 本地 runner 插件 | 领取 Assignment，在本地跑 prepare，创建 worker 会话，从云端拉取提示词组合，在本地装 git/gh shim，处理 30 分钟后台作业规则和 slot 的上报；本地 profile 的 `llm-deepseek` 指向 M1（`baseURL` 加 runner token 凭据） | 6 到 8 |
| M1 | 云端模型代理 | 透传 Anthropic Messages（流式）和 Files API；用 runner token 识别租户，按 usage 计量，超出配额返回 429；把厂商 key 换进 `x-api-key`。和 C2 共用设备 token 的签发与吊销 | 2 到 3 |
| F1 | 回退与补跑 | 租约加 fencing token：云端接手后，旧 runner 的报告一律拒收；掉线超过阈值就由云端带 recovery note 接手；本地上线后只领取新的 Assignment，不抢回已在云端运行的 | 3 到 4 |
| T1 | 每租户实例 | profile 模板和开通脚本、按租户签发 hxr_ key 与 runner token、给每个租户设模型配额、云端兜底 worker 的 OS 用户或容器隔离 | 4 到 6 |
| K1 | 安全 | runner 只出不进；本地侧沿用 hx_edge 的命令白名单作为第二道闸；凭据只在本地；云端被攻破时，影响范围限于该租户自己的设备 | 2 到 3 |
| Q1 | 测试与联调 | 假 runner 和真 DSH 各跑一遍：本地在线、本地掉线由云端接手、本地回来不重复执行、两个租户之间互相不可见 | 3 到 4 |

合计 32 到 42 人日；如果 S0 证明 DSH 自带的通道可用，C2 和 L1 能省 4 到 5 天，就是开头说的 27 到 38 人日。

暂不做的事，以及理由：
- 论文 5.1 的"无状态计算容器"：单租户单实例时，SQLite 加每小时检查已经够用。等到需要水平扩展时，再把 Store 换成 Postgres，约 8 到 10 人日。
- 投机执行：会花冤枉钱，和"少占用人的注意力"的原则冲突。
- 模型版 Watchdog（判断有无实质进展）：可以等 F1 上线后再加，约 3 人日。
- 跨租户 A2A：论文自己都没有定论。

## 6. 建议顺序

1. S0 spike（2 天），结论决定 C2 和 L1 用哪种通道。
2. C1、C3 和 L1 并行，F1 紧跟 C1；M1 和 C2 一起做，因为两者共用设备 token。
3. T1 和 K1 在 F1 之后做，最后用 Q1 收口。
4. 每一步都不改 Engine 和领域模型。如果要改，说明方案偏了，先停下来重新评估。

## 7. 待验证

- DSH 是否支持按会话切换 fs 和 subprocess 的 provider。这只影响"以后要不要支持方案 A"，不影响推荐路线。
- 云端模型代理透传 Files API 时，图片上传的配额和过期清理（`fileQuotaCleanupBatch`）是否需要按租户隔离。模型 key 的归属已定为云端代理，见第 3 节末尾。
- `dsh-api-remotes` 的 Peer 访问模型能不能直接当租户边界用。如果能，T1 能省一部分。
