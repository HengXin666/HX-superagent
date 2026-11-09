/**
 * HX-Email Source background loop: one gateway subscription per listed session selector, long-polled and acknowledged only after
 * every message it returned reached the Engine (at-least-once; deterministic trigger IDs absorb the repeats).
 */
import { threadKey, type Trigger } from '../core/index.ts'
import { family } from '../kv.ts'
import { RouterError, cursorAfter, envelopeNumber, envelopes, routerClient, type Envelope, type RouterClient, type RouterFetch } from './hxrouter-api.ts'
import { SOURCE, hxrouterTrigger, hxrouterTriggerId } from './hxrouter-trigger.ts'
import { pause } from './poll.ts'
import type { SourceContext } from './host.ts'

export type HxRouterConfig = {
  baseUrl: string; tokenEnv: string
  sessions: { address: string; listen: 'mentions' | 'all' }[]
  /** The bot account ID by instance (`qq:16`), for @-mentions the gateway leaves unflagged; else the gateway's own `account_id`. */
  accounts?: { instance: string; account: string }[]
  /** The gateway's `github_user` instance that posts the GitHub Source's replies; 0 or unset leaves them on the agent's own gh. */
  githubInstance?: number
  pollSeconds: number; readPageSize: number
}
/** The gateway subscription ID kept for one selector of one gateway. */
export const SUBSCRIPTION = family<number, [gateway: string, selector: string]>('hxrouter-subscription:', (gateway, selector) => `${gateway}|${selector}`)
/** How often the supervisor rereads the configuration for added, removed or changed sessions. */
export const RECONCILE_MS = 5000
/** Wait before polling again after a failure: 1s after a poll that succeeded, then doubling up to 60s. */
export const retryAfter = (previous: number | undefined): number => previous === undefined ? 1000 : Math.min(previous * 2, 60_000)

export interface LoopOptions { fetch?: RouterFetch; bots: () => readonly string[]; reconcileMs?: number }
const gatewayOf = (config: HxRouterConfig) => config.baseUrl.trim().replace(/\/+$/, '')

async function receive(ctx: SourceContext, trigger: Trigger): Promise<void> {
  await ctx.receive(trigger)
  const session = String(trigger.meta.address || trigger.meta.session || '')
  for (const ref of trigger.threads) ctx.threads.describe(threadKey(ref), { facts: { chat: { value: session } } })
}
/** The selector's stored subscription when the gateway still has it for the same source, else a new one starting now. */
export async function ensureSubscription(ctx: SourceContext, client: RouterClient, gateway: string, selector: string,
  signal?: AbortSignal): Promise<number> {
  const stored = ctx.state.get(SUBSCRIPTION(gateway, selector))
  if (stored !== undefined) {
    try {
      const found = await client.subscription(stored, signal)
      if (found.address === selector || found.source === selector) return found.id
    } catch (error) { if (!(error instanceof RouterError && error.status === 404)) throw error }
  }
  const created = await client.subscribe(selector, signal)
  ctx.state.set(SUBSCRIPTION(gateway, selector), created.id)
  return created.id
}
/** How far back the session is searched for the message a reply answers, when the gateway leaves `reply_to_self` unset. */
export const REPLY_LOOKBACK = 100
/**
 * Whether `envelope` replies to a message the bot sent, for gateways that leave `flags.reply_to_self` unset (QQ reports `null`):
 * the gateway records the bot's sends with their platform message IDs, so the answered message is looked up among the session's
 * recent messages. A failed lookup counts as no.
 */
export async function repliesToSelf(client: RouterClient, envelope: Envelope, signal?: AbortSignal): Promise<boolean> {
  if (!envelope.reply_to || envelope.flags.reply_to_self != null) return envelope.flags.reply_to_self === true
  try {
    const page = await client.messages(envelope.address || envelope.session, cursorAfter(envelope.instance_id, envelopeNumber(envelope.id) - REPLY_LOOKBACK),
      REPLY_LOOKBACK, signal)
    return envelopes(page).some(item => item.platform_message_id === envelope.reply_to && (item.direction === 'outbound' || item.sender.is_self))
  } catch (error) { if (signal?.aborted) throw error; return false }
}
/** Drains one subscription until `signal` aborts, recreating it when the gateway lost it. */
export async function consume(ctx: SourceContext, config: HxRouterConfig, selector: string, options: LoopOptions, signal: AbortSignal,
  report: (state: 'ready' | 'paused' | 'error', detail: string) => void): Promise<void> {
  const client = routerClient(config, options.fetch)
  const gateway = gatewayOf(config)
  let retry: number | undefined
  // Bot account IDs by instance, read again when a message comes from an instance not seen yet.
  let accounts = new Map<number, string>()
  const self = async (platform: string, instance: number) => {
    const configured = config.accounts?.find(row => row.instance === `${platform}:${instance}`)?.account
    if (configured) return configured
    if (!accounts.has(instance)) accounts = await client.accounts(signal).catch(error => { if (signal.aborted) throw error; return accounts })
    return accounts.get(instance)
  }
  while (!signal.aborted) {
    try {
      const id = await ensureSubscription(ctx, client, gateway, selector, signal)
      report('ready', `Subscribed to ${selector}`)
      while (!signal.aborted) {
        const began = Date.now()
        const page = await client.events(id, config.pollSeconds, signal)
        if (page.paused) { report('paused', `The gateway subscription for ${selector} is paused`); await pause(30_000, signal); continue }
        const tally = { skipped: 0 }
        for (const envelope of envelopes(page, tally)) {
          if (signal.aborted) return
          const account = envelope.flags.mention_self == null && envelope.session_type === 'group' ? await self(envelope.platform, envelope.instance_id) : undefined
          const answered = !ctx.triggers.get(hxrouterTriggerId(envelope.session, envelope.reply_to)) && await repliesToSelf(client, envelope, signal)
          const trigger = hxrouterTrigger(answered ? { ...envelope, flags: { ...envelope.flags, reply_to_self: true } } : envelope,
            { trigger: id => ctx.triggers.get(id), bots: options.bots, self: () => account })
          if (trigger && ctx.config(SOURCE)) await receive(ctx, trigger)
        }
        // Acknowledge only after the Engine took every message, so a crash before this line replays the page.
        if (page.next_cursor && page.next_cursor !== page.ack_cursor) await client.ack(id, page.next_cursor, signal)
        if (tally.skipped) report('error', `${selector}: ${tally.skipped} unreadable gateway messages skipped`)
        retry = undefined
        // An empty page that came back at once (a gateway ignoring the wait) must not spin the loop.
        if (!page.messages.length && Date.now() - began < 1000) await pause(1000, signal)
      }
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof RouterError && error.code === 'route_not_found') ctx.state.set(SUBSCRIPTION(gateway, selector), undefined)
      report(error instanceof RouterError && error.code === 'unconfigured' ? 'paused' : 'error', `${selector}: ${error instanceof Error ? error.message : String(error)}`)
      retry = retryAfter(retry)
      await pause(retry, signal)
    }
  }
}

/** The configuration a running consumer depends on: a change to it restarts that consumer. */
const workerKey = (config: HxRouterConfig, selector: string) => JSON.stringify([gatewayOf(config), config.tokenEnv, config.pollSeconds, config.accounts ?? [], selector])

/**
 * Supervises one consumer per listed selector: starts new ones, stops removed ones (deleting their gateway subscription), and
 * restarts those whose gateway settings changed. Reports `hxrouter` health from the consumers' latest states.
 */
export async function runHxRouter(ctx: SourceContext, signal: AbortSignal, options: LoopOptions): Promise<void> {
  await ctx.ready
  const workers = new Map<string, { controller: AbortController; running: Promise<void>; selector: string; config: HxRouterConfig }>()
  const states = new Map<string, { state: 'ready' | 'paused' | 'error'; detail: string }>()
  const publish = () => {
    const all = [...states.values()]
    const failed = all.filter(item => item.state === 'error'), paused = all.filter(item => item.state === 'paused')
    if (failed.length) ctx.report(SOURCE, { state: 'error', detail: failed.map(item => item.detail).join('\n') })
    else if (paused.length) ctx.report(SOURCE, { state: 'paused', detail: paused.map(item => item.detail).join('\n') })
    else ctx.report(SOURCE, { state: 'ready', detail: `Listening to ${all.length} gateway subscriptions`, at: new Date().toISOString() })
  }
  const stop = async (name: string, retire: boolean) => {
    const worker = workers.get(name)!
    workers.delete(name); states.delete(name)
    worker.controller.abort()
    await worker.running
    if (!retire) return
    const gateway = gatewayOf(worker.config), id = ctx.state.get(SUBSCRIPTION(gateway, worker.selector))
    if (id === undefined) return
    try { await routerClient(worker.config, options.fetch).unsubscribe(id) } catch { /* The gateway keeps an orphan; it holds no consumer. */ }
    ctx.state.set(SUBSCRIPTION(gateway, worker.selector), undefined)
  }
  while (!signal.aborted) {
    const config = ctx.configured() ? ctx.config<HxRouterConfig>(SOURCE) : undefined
    const wanted = new Map((config ? [...new Set(config.sessions.map(row => row.address))] : []).map(selector => [workerKey(config!, selector), selector]))
    for (const [name, worker] of [...workers]) {
      // A selector dropped from the list retires its subscription; one whose gateway settings changed restarts under a new key.
      if (!wanted.has(name)) await stop(name, !config || !config.sessions.some(row => row.address === worker.selector)
        || gatewayOf(config) !== gatewayOf(worker.config))
    }
    for (const [name, selector] of wanted) {
      if (workers.has(name)) continue
      const controller = new AbortController()
      const report = (state: 'ready' | 'paused' | 'error', detail: string) => { if (!controller.signal.aborted) { states.set(name, { state, detail }); publish() } }
      workers.set(name, { controller, selector, config: config!, running: consume(ctx, config!, selector, options, controller.signal, report) })
    }
    if (!config) ctx.report(SOURCE, { state: 'paused', detail: ctx.configured() ? 'Off' : 'Waiting for the deployment check' })
    else if (!wanted.size) ctx.report(SOURCE, { state: 'paused', detail: 'No sessions are listed' })
    await pause(options.reconcileMs ?? RECONCILE_MS, signal)
  }
  await Promise.all([...workers.keys()].map(name => stop(name, false)))
}
