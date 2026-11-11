# magpie 三个 loop 工作流：原话摘录与复现方案

整理日期：2026-11-12（Asia/Shanghai, UTC+08:00）

标记说明：

- **[Y]**：yetone 原话或原截图
- **[H]**：Huang Xin 复刻 Readest 时加的
- **[他人]**：宝玉（dotey）、wquguru、freeze 等第三方的说法
- **[仓库]**：magpie 仓库里能直接看到的
- **查不到**：找过，没有出处，不补

## 来源编号

| 编号 | 内容 | 链接 | 日期 |
|---|---|---|---|
| S1 | yetone 工作流推（含 3 张截图） | https://x.com/yetone/status/2109855710444237018 | 2026-10-13T03:56:15Z |
| S2 | yetone 设计思路推 | https://x.com/yetone/status/2110089344187056263 | 2026-10-13T19:24:37Z |
| S3 | wquguru 长文《yetone 的魔法：magpie 是怎么让 AI 自己维护项目的》 | https://x.com/wquguru/status/2109650264601117141 | 2026-10-12T14:19:53Z |
| S4 | Huang Xin 复刻推 | https://x.com/hwangxin/status/2110372702825710021 | 2026-10-14T14:10:35Z |
| S5 | Readest PR #6796 及其中的 SKILL.md（merge `f4b0102`） | https://github.com/readest/readest/pull/6796 | 2026-10-14 合入 |
| S6 | 宝玉转述推 / 宝玉 worktree 回复 / readcopilot 转载 | https://x.com/dotey/status/2110084393255514268 ；https://x.com/dotey/status/2110486601625436514 ；https://readcopilot.ionichina.com/articles/56107 | 2026-10-13T19:04:57Z ；2026-10-14T21:43:11Z ；readcopilot 页面无日期 |
| S7 | Claude Code 官方文档 Scheduled tasks | https://code.claude.com/docs/en/scheduled-tasks | 2026-11-12 读取 |
| S8 | magpie 仓库 HEAD `12610cf2f` | https://github.com/yetone/magpie | 2026-11-12 克隆 |
| 附 | linux.do freeze 总结帖 | https://linux.do/t/topic/3025235.json | 2026-10-14T16:49:56Z |

## ⚠️ 先读：三处纠正

1. **配图不是结构图。** S1 的 3 张配图（`HUe16OcbMAA38nu.png`、`HUe2AEZaoAAEG5X.png`、`HUe2GLyaoAAt7Fx.png`）是三段 `/loop` 提示词的**终端截图**，没有任何框图或箭头。逐字转写见第二节。[Y] S1
2. **“路由表”指 AGENTS.md 的文档路由，不是 loop 之间的消息路由。** freeze 总结里的“三个loop + 路由表 + 错题本”来自 wquguru 的说法：AGENTS.md 告诉 agent 做什么活之前读哪份文档。[他人] S3、附
3. **“worktree 隔离 + 合并前 rebase + 合并后删 worktree”是宝玉的建议，不是 Huang Xin 的做法。** Huang Xin 的推里没有提 worktree 和 rebase；他的 SKILL.md 里只有 `pnpm worktree:new` 和“fresh worktree”，没有 rebase 或删除 worktree 的规则。[他人] S6；[H] S4、S5

### 不在 yetone 原话里、是复刻时加的

| 说法 | yetone 原文（S1 截图） | 实际出处 |
|---|---|---|
| “每晚复盘” | Loop 3 只写“定时清理” | wquguru 的描述 [他人] S3；Huang Xin 的 `nightly-review` [H] S4 |
| “3 天升级成硬规则” | 没有 | 仓库 LESSONS 规则 [仓库] S8；wquguru [他人] S3；Huang Xin [H] S4 |
| “Haiku 过滤” | 写的是“便宜的决策模型比如 jev” | Huang Xin [H] S4、S5 |
| “LESSONS.md”文件名 | 只写“放到经验中” | 仓库 [仓库] S8；wquguru [他人] S3；Huang Xin [H] S4 |
| “最近 3 天的 issue” | 没有时间窗口 | Huang Xin [H] S4、S5 |

## 一、共同底座

| 项 | 做法 | 标记与来源 |
|---|---|---|
| 工具和模型 | Claude Code + 官方 Opus 5.5 | [Y] S1 |
| 并行 | “我会并行执行图里的 3 个 loop” | [Y] S1 |
| 人的工作 | “每晚抽一点时间铲铲屎（主要是 UI/UX 的问题），然后就没活儿了” | [Y] S1 |
| 一个 loop 一个会话 | “In Claude Code, one session per loop” | [H] S5。yetone 是否如此：**查不到**。官方文档说一个会话最多 50 个定时任务，三个 loop 放同一会话也能跑 [S7] |
| 共享规则入口 | `CLAUDE.md` 只有两行：`@AGENTS.md`、`@LESSONS.md` | [仓库] S8；[他人] S3 |
| 路由表 | AGENTS.md 本身不写规则，指向 `docs/subsystems/`、`docs/code-standards.md`、`docs/contributors.md` | [他人] S3 |
| 真实复现环境 | 一台 Mac、一台 Windows，再在 Windows 上开一个 Linux 虚拟机；每次在三端复现再修 | yetone 回复，经宝玉转述 [他人] S6。yetone 原回复地址**查不到** |
| 偏好判断 | 靠 Claude Code 记忆系统和仓库设计文档 | 同上，[他人] S6 |
| 触发节奏 | 三段提示词都**没写间隔** | [Y] S1 |
| 不写间隔的含义 | Claude Code 里 `/loop <提示词>` 不写间隔时，由模型每轮自定 1 分钟到 1 小时 | S7 |
| 宝玉实测 | “我自己去 Codex 跑了一下，默认是 1 小时”（Codex，不是 Claude Code） | [他人] S6 |
| 运行限制 | 只在会话开着时触发；循环任务 7 天自动过期；自定速率的 loop 用 `--resume` 不恢复 | S7。yetone 怎么处理过期：**查不到** |
| 产品侧减负 | Provider 和 Agent 已插件化，下一步把包括 UI 在内的所有功能插件化 | [Y] S2 |
| freeze 总结 | “其实就三个loop + 路由表 + 错题本”；把频繁变动的功能模块解耦插件化 | [他人] 附 |

## 二、三个 loop

### Loop 1：GitHub（加 Discord）

**yetone 原文（S1 图 1 逐字转写）[Y]**

```
/loop 盯一下 GitHub issues，仔细分析，看看哪些是值得修复和实现的，修复或者实现后记得发版和回复，如果不值得修复或者实现也要回复，如果是中转站的广告商，就统一回复：感谢关注，日后会出相关合作方案，敬请期待。而不能一股脑地把第三方中转站直接加到我们产品里面。也要盯一下GitHub的PR，然后你要认真的去review PR的每行代码、每个逻辑，你要把代码拉下来实际跑一下，验证一下是否没有 bug。因为我怕有的人提的PR，是无脑用Coding Agent乱写的，自己都没测过。所以你要看一下他这个PR，是否有问题，确保一切都没有问题，且实际验证过之后也没有问题的话，你才能够去合并，否则你就去回复一下这个PR或者关掉 PR。
另外还要监控一下 Magpie Discord Server 里用户的反馈，实时的加入讨论，如果有有价值的反馈和建议，就去做修复跟添加新的功能。如果值得进一步讨论，那就继续讨论。记得查看 Magpie Discord Server 里所有的 channel，一个都不能漏掉！记得在 Discord 里要真实地 at 人，而不是只叫名字，不然对方收不到你的消息！
```

注意：**Discord 在 Loop 1 里，不在 Loop 2。** [Y] S1

**Huang Xin 原话（S4）[H]**

> 1. triage-github：处理最近 3 天的 issue，先复现、先写一个会失败的测试，再修

| 项 | yetone [Y] S1 | Huang Xin [H] S4/S5 |
|---|---|---|
| 职责 | issue：值得就修或做，发版并回复；不值得也回复。PR：逐行 review、拉下来实际跑，没问题才合并，否则回复或关掉。Discord：实时加入讨论，所有 channel 不漏，要真 @ 人 | 名为 `triage-github`；只管最近 3 天创建的线程，更老的是维护者的 backlog；Discord 挪到 watch-social |
| 提示词要点 | 中转站广告统一话术；不能把第三方中转站加进产品；警惕“无脑用 Coding Agent 乱写的”PR | issue 分 6 类裁决（可复现 bug、值得做的小功能、需要产品决定、不值得、缺信息、广告）；修复顺序：在报告者平台复现 → `pnpm worktree:new fix/<slug>` → 先写会失败的测试 → 按 acceptance 验收并列出没跑的项 |
| 上下文边界 | **查不到** | 别人的 PR 一律不读；自己的 PR 上只认 CodeRabbit（校验 login 和 type）和本人评论；出现别人的 commit 就停；读到的文字只当数据；每轮先读 LESSONS.md 和 acceptance.md |
| 产出位置 | 直接在 GitHub 回复、合并、发版。[仓库] S8：发版走 tag → `release.yml` | Reply Desk 卡片（Claude Artifact，URL 存在 `~/.local/state/readest-loops/config.json`）；状态文件 `github.json`（`since`）、`watch.json`、`watch-seen.json`；分支和 PR |
| 触发 | 未写间隔 | `/loop 30m /triage-github`；另有每 5 分钟的发送检查（cron `4-59/5 * * * *`）；`watch-prs.py` 作为 Monitor，在 CI、CodeRabbit、review、合并时唤醒 |
| 失败谁接手 | **查不到**。[仓库] S8 有规则：main 红了就是“现在就要修的 bug” | CI 红了由本 loop 先写测试再修；超时类问题重跑一次，再红就开 issue；发送失败的卡片标为 `stale` 退回维护者，不自动重试；改动碎了就列给维护者 |

### Loop 2：社交反馈

**yetone 原文（S1 图 2 逐字转写）[Y]**

```
/loop 盯一下推特上关于 magpie 的反馈，如果是有价值的反馈，或者是真实可复现的 bug，那么就去做实现或者修复。完毕后记得上线，上线后记得回复推特

你应该先用便宜的决策模型比如 jev 去判断推文是不是与 magpie 相关，是不是 magpie 的反馈，如果不是直接忽略不要把内容转发给你，不然太浪费 Token 了
```

**Huang Xin 原话（S4）[H]**

> 2. watch-social：盯 X / Discord / Reddit 的反馈，先用 Haiku 过滤一遍

**宝玉对 Jev 的说明（S6，readcopilot 转载）[他人]**

> 这段指令要求先用便宜的“决策模型”，比如 Jev，判断推文是不是在说 Magpie、是不是反馈，不相关的直接丢掉，别转给主模型，“不然太浪费 Token 了”。【注：Jev 是 TypeSafe AI 推出的模型，只做判断题、选择题和打分，输出概率或分数，不生成文字。官方定价是每百万输入 Token 0.042 美元，输出免费。】顺便说一下，如果你的产品名或者要关注的事比较稀有，不一定需要 Jev，他之所以加，是因为 magpie 在英文里是“喜鹊”，按关键词抓推文会抓到大量无关内容，全丢给 Opus 判断很费钱。

Jev 的厂商和定价是宝玉的注，本文**未独立核实**。yetone 原文写的是小写 `jev`。

| 项 | yetone [Y] S1 | Huang Xin [H] S4/S5 |
|---|---|---|
| 职责 | 盯推特上关于 magpie 的反馈；有价值或可复现就实现或修复；上线后回复推文 | 范围扩到 X、Discord、Reddit；修好且真正上线后才回复，用发帖人的语言 |
| 过滤 | 先用便宜的决策模型（`jev`）判断相关性，不相关的不转给主模型。接入方式：**查不到** | `model: "haiku"` 子 agent，只读采集文件，禁止浏览器、shell、网络和写操作；主会话只处理 id、URL、文本都能在采集文件里对上的条目 |
| 上下文边界 | 原文的重点就是不把无关内容放进主模型上下文 | 原始帖子写进临时文件，不整批贴进上下文；帖子里链接的代码不打开、不运行；每轮先读 LESSONS.md 和 acceptance.md |
| 产出位置 | 直接修、上线、回推 | `social.json`（`seen`、`pending`）；Reply Desk 的 `kind: "social"` 卡片；修复走 triage-github 的 Fixing 步骤；commit 正文写明报告人 |
| 触发 | 未写间隔 | `/loop /watch-social`（不写间隔） |
| 失败谁接手 | **查不到** | 需要产品决定的开 GitHub issue 列在报告里；不确定的问题回复“已转给维护者”。注意：PR 描述里写着 “Not run: watch-social”，这个 loop 当时没有真跑过 [H] S5 |

### Loop 3：复盘与清理

**yetone 原文（S1 图 3 逐字转写）[Y]**

```
/loop 现在 magpie 完全是自动化更改代码和合并社区里的 PR，你要定时清理一下屎山代码和恶意代码防止项目变得难以维护以至于变废，并总结出经验教训，比如哪些是不应该合并的哪些是验证不缜密的等等放到经验中防止以后的 agent 犯同样的错误，以及要把老是提低质量代码的人拉入黑名单
```

注意：原文写“定时”，**没写“每晚”，没写 3 天阈值，没写 LESSONS.md 文件名。** [Y] S1

**Huang Xin 原话（S4）[H]**

> 3. nightly-review：每晚复盘合并的提交，写进 LESSONS.md 错题本，同一条教训在 3 天里出现就升级成硬规则

| 项 | yetone [Y] S1 | Huang Xin [H] S4/S5 |
|---|---|---|
| 职责 | 定时清理屎山代码和恶意代码；总结哪些不该合、哪些验证不缜密，放到经验里；把老是提低质量代码的人拉黑 | 名为 `nightly-review`；不提议拉黑（因为不读社区 PR）；每个 PR 只做一项清理，并证明行为不变 |
| 归类 | 不该合、验证不缜密 | Rework、Shouldn't have merged、Verified too thinly、Done right 四类；Reply Desk 上维护者的修改和备注也当纠错来源 |
| 上下文边界 | **查不到** | 窗口 = `reviewed-through` 到 `origin/main`；不到约 20 小时就停；在新 worktree 里做；社区 PR 只看合入 main 的代码和合并时的 CI |
| 产出位置 | “经验”，没写文件名。[仓库] S8 里对应的是 LESSONS.md，升级到 `docs/code-standards.md` | LESSONS.md，升级到 `.claude/rules/acceptance.md`；推进 `reviewed-through`；开 PR，只通过批准过的合并卡片合入 |
| 触发 | “定时”，未写间隔。“每晚”是 wquguru 的说法 [他人] S3；他也说 LESSONS 的更新时间“东一个西一个，不像定时任务” | `/loop /nightly-review`，靠“不到一天就停”实现每天一次 |
| 失败谁接手 | **查不到** | 复盘 PR 进 triage-github 的监视列表，按普通 PR 跟进 |

## 三、错题本规则

wquguru 原话 [他人] S3：

> 每天夜里，agent 把当天的 commit 全过一遍，关注三个场景：哪些修完又返工了；哪些压根不该合；哪些验证做得太糙。每揪出一个就记一条，一句规则，一段原因，后面挂上 commit 和 issue 号当证据。
> ……同一条教训，如果在 3 个不同日子的复盘里都出现了，就从 LESSONS.md 挪进 code-standards.md，从经验变成硬规则。之后每个 PR 审查都要逐条对。
> ……当然错题本也记录做对的事情，标成 Done right。

条目模板 [他人] S3：

```
**<一句话规则>**
- <哪个 commit / issue 出的事，后果是什么>
- <修复的 commit>
- Done right: <做对的例子>
- Seen N× (YYYY-MM-DD, YYYY-MM-DD).
```

| 规则 | yetone/magpie | Huang Xin |
|---|---|---|
| 条目格式 | 一句规则 + 证据（commit/issue）+ 修复 + Done right + `Seen N× (日期…)` [仓库] S8；[他人] S3 | 同样结构，写在 skill 里 [H] S5 |
| 计数 | 按不同的天计，不按次数 [仓库] S8；[他人] S3 | “`Seen` counts distinct days, not commits” [H] S5 |
| 升级条件 | 3 个或更多不同的天 [仓库] S8；[他人] S3 | 同左 [H] S5 |
| 升级到哪 | `docs/code-standards.md`，LESSONS 留一行在 “Moved to the code standards” [仓库] S8 | `.claude/rules/acceptance.md`，LESSONS 留一行在 “Moved to the rules” [H] S5 |
| 游标 | 文件头有 `reviewed-through: e297a8ab2`（2026-10-13 23:30 +0800），最后一次变动是 2026-10-14，之后没再推进 [仓库] S8 | 每次复盘必须推进 [H] S5 |
| 种子 | — | 用前 10 天的提交做一次复盘作为种子，第一天就有 3 条升级 [H] S4 |
| 瘦身 | — | 升级后，超过约两周的证据缩减到最典型的一条 [H] S5 |

## 四、loop 之间怎么交换信息

- **yetone：查不到。** [Y] S1、S2 都没有交接描述。
- 能确认的共享渠道只有仓库本身：Loop 3 写 LESSONS.md，Loop 1 和 Loop 2 通过 `CLAUDE.md` 的 `@LESSONS.md` 读到。[仓库] S8；[他人] S3
- **Huang Xin：全部通过文件和卡片，不传对话。** [H] S5
  - Reply Desk 的 `drafts` 集合是总线：`kind: "social"` 归 Loop 2 发，其他归 Loop 1 发。
  - Loop 2 的修复走 Loop 1 的 Fixing 步骤。
  - Loop 3 读 Reply Desk 上的编辑和备注，写 LESSONS；它开的 PR 交给 Loop 1 的监视列表。
  - 三个 loop 每轮都重读 LESSONS.md 和 acceptance.md，因为运行中它们会变。
  - 状态都在 `~/.local/state/readest-loops/` 下。
- 设计注意：CodeRabbit 在 PR #6796 上对社交发送的“审批重放”风险提过 Medium 级意见，后续提交有回应。[H] S5

## 五、人工闸门放在哪

| 闸门 | yetone | Huang Xin |
|---|---|---|
| 对外回复、改标题、关闭 | 无闸门，提示词让 agent 直接回 [Y] S1 | 全部进 Reply Desk，点批准才发；发之前重读线程，有新评论就退回 [H] S4、S5 |
| 合并 | agent 合并 [Y] S1；危害检查命中时等 maintainer 放行 [仓库] S8；[他人] S3 | 必须有批准过的合并卡片，并钉住 `headSha` [H] S5 |
| 推送和开 PR | agent 直接做 [Y] S1 | 卡片批准后才推送、才开 PR [H] S5 |
| 发版 | agent 发 [Y] S1 | 人发（“毕竟要过应用商店”）[H] S4 |
| 社区 PR | agent 评审并合并 [Y] S1 | 人自己评审，loop 完全不碰 [H] S4 |
| 产品和 UI/UX | yetone 每晚“铲屎” [Y] S1；已拍板的产品决定 PR 不能改 [他人] S3 | 需要产品决定的不做，留给维护者 [H] S5 |

## 六、照着做的步骤

1. 仓库根放 `CLAUDE.md`，内容只有 `@AGENTS.md` 和 `@LESSONS.md`；AGENTS.md 写成文档路由表。[仓库] S8；[他人] S3
2. 写验收标准文件：去掉改动就失败的测试、在报告者的界面上真实使用、没跑的列出来、只合并审过的 head（`gh pr merge --match-head-commit`）。[仓库] S8；[他人] S3；[H] S5
3. 用前 10 天的提交跑一次复盘，作为 LESSONS.md 的种子，文件头写好 `reviewed-through`。[H] S4
4. 把三段提示词写成三个 skill。要 1:1 复现就直接用第二节 yetone 的三段原文 [Y] S1；要更稳就用 Huang Xin 的三个 SKILL.md 作模板 [H] S5。
5. 开三个 Claude Code 会话，模型选 Opus 5.5 [Y] S1，分别运行（Huang Xin 的写法 [H] S5；yetone 三段都不写间隔 [Y] S1）：
   - `/loop 30m /triage-github`
   - `/loop /watch-social`
   - `/loop /nightly-review`
6. 每个修复用自己的 worktree [H] S5。如果要加宝玉建议的“合并之前 rebase 一下并解决冲突，合并后删除 worktree”，写进 AGENTS.md。[他人] S6
7. 社交 loop 前面加便宜模型过滤：Jev [Y] S1 或 Haiku 子 agent [H] S5。
8. 定下人工闸门：按 yetone 的做法只留 UI/UX [Y] S1；按 Huang Xin 的做法加 Reply Desk、只处理自己的 PR、人发版 [H] S4。
9. 每 7 天重建一次 loop，因为循环任务 7 天后过期 [S7]。要不依赖会话，就换云端或桌面定时任务。[S7]

## 七、仍然查不到

- yetone 的三个 loop 是三个独立会话还是同一个会话。
- yetone 的实际触发间隔（Claude Code 里由模型自己定，具体值没有公开）。
- Jev 怎么接入 Claude Code。
- yetone 的 loop 之间是否直接交接。
- yetone 侧失败以后谁接手。
- yetone 怎么处理 7 天过期。
- yetone 那两条补充回复（三端环境、记忆系统）的原推地址。
