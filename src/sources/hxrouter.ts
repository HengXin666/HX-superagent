/**
 * HX-Email Source: receives chat messages (QQ, QQ channels, and every other platform the HX-Email messaging router gateway carries)
 * through gateway subscriptions, reads their context and replies through the same gateway. It leaves GitHub to the GitHub Source.
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { hxrouterLink, sendHxRouter } from './hxrouter-channel.ts'
import { runHxRouter, type HxRouterConfig } from './hxrouter-loops.ts'
import { hxrouterThreadContext } from './hxrouter-read.ts'
import { SOURCE, hxrouterRef, hxrouterScope, hxrouterTriggerId } from './hxrouter-trigger.ts'
import type { RouterFetch } from './hxrouter-api.ts'
import { sourceContext, type SourceHost } from './host.ts'
import type { SourceKind } from './kind.ts'

export { SOURCE, hxrouterActor, hxrouterTrigger, hxrouterTriggerId, hxrouterRef, covers } from './hxrouter-trigger.ts'
export type { HxRouterConfig } from './hxrouter-loops.ts'

/** A v2 gateway address or a selector of whole path segments: `qq:3`, `qq:3/group`, `qq:3/group/555`, `qqbot:5/guild/1/channel/2`. */
const ADDRESS = '[a-z0-9_]+:[0-9]+(/[^\\s/]+)*'
/** Gateway platforms this Source refuses: GitHub belongs to the GitHub Source. */
const GITHUB_PLATFORMS = new Set(['github', 'github_user'])
const SENDER = '[a-z0-9_]+:\\S+'
const Senders = z.array(z.object({ id: z.string().regex(new RegExp(`^${SENDER}$`)), name: z.string().trim().max(100).optional() }).strict())
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Duplicate sender IDs')
export const HxRouterConfigSchema = z.object({
  baseUrl: z.string().trim().regex(/^(https?:\/\/\S+)?$/, 'http(s)://host[:port]').default(''),
  tokenEnv: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default('HX_ROUTER_TOKEN'),
  // GitHub threads stay with the GitHub Source, which binds PRs to tickets; a gateway GitHub address here would make a second ticket for the same thread.
  sessions: z.array(z.object({ address: z.string().trim().regex(new RegExp(`^${ADDRESS}$`))
    .refine(address => !GITHUB_PLATFORMS.has(address.slice(0, address.indexOf(':'))), 'GitHub stays with the GitHub Source'), listen: z.enum(['mentions', 'all']) }).strict())
    .refine(rows => new Set(rows.map(row => row.address)).size === rows.length, 'Duplicate session addresses').default([]),
  accounts: z.array(z.object({ instance: z.string().trim().regex(/^[a-z0-9_]+:[0-9]+$/, '<platform>:<instance id>'), account: z.string().trim().min(1) }).strict())
    .refine(rows => new Set(rows.map(row => row.instance)).size === rows.length, 'Duplicate instances').default([]),
  githubInstance: z.number().int().min(0).max(1_000_000_000).default(0),
  pollSeconds: z.number().int().min(1).max(55).default(25),
  readPageSize: z.number().int().min(1).max(50).default(20),
}).strict() satisfies z.ZodType<HxRouterConfig>

export interface HxRouterDeps {
  /** The Source's configuration while enabled, which replies are sent with. */
  config(): HxRouterConfig | undefined
  /** Actors (`platform:id`) the Policy lists as bots. */
  bots(): readonly string[]
  fetch?: RouterFetch
}
/** Builds the HX-Email Source kind; `deps` supply what a reply and a context read need beyond their own arguments. */
export function hxrouterKind(deps: HxRouterDeps): SourceKind<HxRouterConfig> {
  const fetch = deps.fetch ? { fetch: deps.fetch } : {}
  return {
    kind: SOURCE,
    title: { zh: 'HX-Email 消息网关', en: 'HX-Email messaging gateway' },
    description: { zh: '通过 HX-Email 消息路由网关订阅下列会话（QQ、QQ 频道等），读取上下文并经网关回复；不处理 GitHub。',
      en: 'Subscribes to these sessions (QQ, QQ channels and more) through the HX-Email messaging router gateway, reads their context and replies through it; GitHub stays with the GitHub Source.' },
    schema: HxRouterConfigSchema,
    fields: [
      { key: 'baseUrl', type: 'text', pattern: '(https?://\\S+)?', label: { zh: '网关地址', en: 'Gateway address' },
        hint: { zh: 'HX-Email 的地址，例如 http://127.0.0.1:8080；接口前缀 /api/v1/router 自动补上。', en: 'The HX-Email address, such as http://127.0.0.1:8080; the /api/v1/router prefix is added.' } },
      { key: 'tokenEnv', type: 'text', pattern: '[A-Za-z_][A-Za-z0-9_]*', label: { zh: '路由密钥的环境变量', en: 'Router key environment variable' },
        hint: { zh: '保存 hxr_ 路由密钥的环境变量名；密钥本身不进设置。在 HX-Email 的「消息订阅」页签发。', en: 'Name of the environment variable holding the hxr_ router key; the key itself stays out of settings. Issue it on HX-Email\'s subscriptions page.' } },
      { key: 'sessions', type: 'rows', label: { zh: '接收的会话', en: 'Sessions' },
        hint: { zh: '网关 v2 地址或其前缀，例如 qq:3/group/555、qq:3/private（该号全部私聊）。“仅 @”只把 @ 机器人、回复机器人和私聊的消息当作请求，其余消息只用于已有工单的跟进；“全部消息”允许评估从中推断工作。', en: 'Gateway v2 addresses or prefixes, such as qq:3/group/555 or qq:3/private (all direct chats of that account). "@ only" treats only mentions, replies to the bot and direct messages as requests, other messages only follow up existing Tickets; "All" lets Eval infer work from them.' },
        columns: [
          { key: 'address', type: 'text', label: { zh: '地址', en: 'Address' }, pattern: ADDRESS },
          { key: 'listen', type: 'select', label: { zh: '接收', en: 'Receive' }, options: [{ value: 'mentions', label: { zh: '仅 @', en: '@ only' } }, { value: 'all', label: { zh: '全部消息', en: 'All' } }] },
        ] },
      { key: 'accounts', type: 'rows', label: { zh: '机器人账号', en: 'Bot accounts' },
        hint: { zh: '每个网关实例上机器人自己的账号，例如 qq:16 对应 QQ 号 3000。QQ 网关不标记 @，靠它从正文里的 @3000 认出 @ 机器人；不填时用网关 /sources 报告的 account_id（目前为空）。', en: 'The bot\'s own account on each gateway instance, such as qq:16 -> QQ 3000. The QQ gateway leaves @-mentions unflagged, so this finds @3000 in the text; unset, the account_id the gateway\'s /sources reports is used (currently empty).' },
        columns: [
          { key: 'instance', type: 'text', label: { zh: '实例', en: 'Instance' }, pattern: '[a-z0-9_]+:[0-9]+' },
          { key: 'account', type: 'text', label: { zh: '账号', en: 'Account' } },
        ] },
      { key: 'githubInstance', type: 'number', min: 0, max: 1000000000, label: { zh: 'GitHub 回复经网关发出', en: 'GitHub replies through the gateway' },
        hint: { zh: '填网关里 github_user 实例的编号，GitHub 来源的评论和 review 回复就由网关以该实例的 gh 账号发出，超过 4000 字的仍由智能体自己的 gh 发；填 0 则全部自己发。这个实例必须登录智能体同一个账号、配置同一个仓库，否则智能体会把自己的评论当成别人的。GitHub 的接收仍由 GitHub 来源负责。', en: 'The gateway\'s github_user instance number: the GitHub Source\'s comments and review replies are posted by the gateway with that instance\'s gh account, and replies over 4,000 characters still go out through the agent\'s own gh; 0 posts everything directly. The instance must sign in to the agent\'s own account and serve the same repository, or the agent takes its own comments for someone else\'s. Receiving GitHub stays with the GitHub Source.' } },
      { key: 'pollSeconds', type: 'number', advanced: true, min: 1, max: 55, label: { zh: '长轮询等待 / 秒', en: 'Long-poll wait / s' },
        hint: { zh: '每次向网关等待新消息的最长时间；有消息时立即返回。', en: 'How long each gateway wait lasts at most; it returns at once when messages arrive.' } },
      { key: 'readPageSize', type: 'number', advanced: true, min: 1, max: 50, label: { zh: '每页消息数', en: 'Messages per page' },
        hint: { zh: '智能体读取会话上下文时，每页的消息数。', en: 'Messages per page when agents read a session\'s context.' } },
    ],
    health: [SOURCE],
    scope: ({ meta }, config) => hxrouterScope(meta, config),
    // A reply goes only to a session the Source still receives.
    channel: {
      allowed: (address, config) => hxrouterScope({ address: address.address ?? '' }, config).listened,
      send: (_host, message) => {
        const config = deps.config()
        if (!config) throw new Error('The HX-Email Source is off')
        return sendHxRouter(config, message, deps.fetch)
      },
      link: address => hxrouterLink(address),
    },
    threadContext: hxrouterThreadContext({ ...fetch, bots: deps.bots }),
    repliesTo: trigger => {
      const ref = hxrouterRef(trigger)
      return ref?.replyTo ? hxrouterTriggerId(ref.session, ref.replyTo) : undefined
    },
    policy: {
      unnamed: { person: { zh: '网关用户', en: 'Gateway user' }, bot: { zh: '网关机器人', en: 'Gateway bot' } },
      schema: z.object({ allowed: Senders.default([]), bots: Senders.optional() }).strict(),
      fields: [
        { key: 'allowed', type: 'rows', label: { zh: '能发起工作的人', en: 'People who may originate work' },
          hint: { zh: '写成 平台:发送者ID，例如 qq:10001。', en: 'Written as platform:sender ID, such as qq:10001.' },
          columns: [{ key: 'id', type: 'text', label: { zh: 'ID', en: 'ID' }, pattern: SENDER }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
        { key: 'bots', type: 'rows', label: { zh: '机器人', en: 'Bots' },
          hint: { zh: '网关分不出机器人和真人，这张名单是唯一依据：名单里的发送者都当作机器人，它们的消息最多成为推断的候选，不能发起明确的请求，也不能停止工单。', en: 'The gateway cannot tell bots from people, so this list is the only signal: senders on it are bots, whose messages become inferred candidates at most and never make an explicit request or stop a ticket.' },
          columns: [{ key: 'id', type: 'text', label: { zh: 'ID', en: 'ID' }, pattern: SENDER }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
      ],
      explicit: { zh: '名单内的人 @ 机器人、回复机器人或私聊机器人，总是明确的请求，不需要配置。', en: 'Someone on the list who mentions the bot, replies to it or messages it directly always makes an explicit request; that needs no setting.' },
      rows(stored) {
        const config = HxRouterConfigSchema.parse(stored)
        return config.sessions.map(row => ({ id: row.address, label: row.address,
          note: row.listen === 'all' ? { zh: '全部消息', en: 'All' } : { zh: '仅 @', en: '@ only' },
          cells: { listedUnaddressed: row.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: row.listen === 'all' } }))
      },
    },
    environment: {
      variables: [{ key: 'DSH_SUPERAGENT_HXROUTER_SESSION', description: { zh: '接下工单的网关会话地址；工单不是从网关来的时为空', en: 'Gateway session address that started the ticket; empty when the ticket did not start there' } }],
      values: ({ trigger }) => ({ DSH_SUPERAGENT_HXROUTER_SESSION: trigger?.source === SOURCE ? String(trigger.meta.address || trigger.meta.session || '') : '' }),
    },
  }
}

/** Actors the Policy's HX-Email part lists as bots. */
export const policyBots = (host: SourceHost): string[] =>
  ((host.sources.policyPart(SOURCE) as { bots?: { id: string }[] } | undefined)?.bots ?? []).map(bot => bot.id)

export const name = 'dsh-superagent-hxrouter'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  const host = ctx.orchestrator
  const kind = hxrouterKind({ config: () => host.sources.instance<HxRouterConfig>(SOURCE)?.enabled
    ? host.sources.instance<HxRouterConfig>(SOURCE)!.config : undefined, bots: () => policyBots(host) })
  ctx.effect(() => host.sources.register(kind), 'hxrouter: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runHxRouter(sourceContext(host, kind), controller.signal, { bots: () => policyBots(host) })
    return async () => { controller.abort(); await running }
  })
}
