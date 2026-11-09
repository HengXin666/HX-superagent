/** Normalizes HX-Email gateway envelopes into domain Triggers, and the address rules the HX-Email Source listens by. */
import { isoTime, key, threadKey, type ChannelRef, type ScopeResult, type ThreadRef, type Trigger } from '../core/index.ts'
import type { Envelope } from './hxrouter-api.ts'

export const SOURCE = 'hxrouter'
/** Session types that are one-to-one conversations with the bot account; every message there addresses it. */
const DIRECT = new Set(['private', 'temp'])

/** Deterministic trigger ID for a gateway message; the session (v1, the gateway's storage key) and the platform's own message ID name it. */
export const hxrouterTriggerId = (session: string, platformMessageId: string): string => key(SOURCE, session, platformMessageId)
/** A sender's identity on the Policy's lists: the platform, then the sender ID (`qq:10001`), since IDs of different platforms collide. */
export const hxrouterActor = (platform: string, senderId: string): string => `${platform}:${senderId}`

/** Whether `selector` (a v2 address or a prefix of one, such as `qq:3/group`) covers `address`, matching whole path segments only. */
export const covers = (selector: string, address: string): boolean => !!address && (address === selector || address.startsWith(`${selector}/`))
/** The most specific listed selector covering `address`. */
export function rowFor<R extends { address: string }>(rows: readonly R[], address: string): R | undefined {
  return rows.filter(row => covers(row.address, address)).sort((a, b) => b.address.length - a.address.length)[0]
}
export interface ListenConfig { sessions: { address: string; listen: 'mentions' | 'all' }[] }
/** Listening rule: a message is received when a listed selector covers its session, and observed when that row receives all messages. */
export function hxrouterScope(meta: Record<string, unknown>, config: ListenConfig): ScopeResult {
  const address = String(meta.address ?? '')
  const row = rowFor(config.sessions, address)
  return row ? { listened: true, observed: row.listen === 'all', row: row.address } : { listened: false, reason: 'chat_not_allowed' }
}

export const hxrouterChannel = (envelope: Envelope, thread: string): ChannelRef => ({ source: SOURCE, thread,
  address: { session: envelope.session, address: envelope.address, sessionType: envelope.session_type, messageId: envelope.platform_message_id } })

export interface TriggerLookup {
  /** An earlier Trigger by ID, which places a reply on the thread of the message it answers. */
  trigger(id: string): Trigger | undefined
  /** Actors (`platform:id`) the Policy lists as bots; the gateway does not tell bots from people, so the list is the only signal. */
  bots(): readonly string[]
  /** The bot's own account ID on an instance, for gateways that leave `flags.mention_self` unset (QQ reports `null`). */
  self?(instanceId: number): string | undefined
}
/** Whether a text mentions the account: QQ flattens an `at` segment into `@<account id>` in the text. */
export const mentionsAccount = (text: string, account: string | undefined): boolean =>
  !!account && new RegExp(`(^|[^0-9A-Za-z_])@${account.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z_])`).test(text)
/**
 * Converts a gateway envelope into a Trigger, returning undefined for the bot account's own messages and outbound records.
 * A direct conversation is one thread; in a group, a message is its own thread unless it replies to a message received before.
 */
export function hxrouterTrigger(envelope: Envelope, lookup: TriggerLookup): Trigger | undefined {
  if (envelope.direction !== 'inbound' || envelope.sender.is_self || envelope.flags.from_self === true) return undefined
  const direct = DIRECT.has(envelope.session_type)
  const parent = envelope.reply_to ? lookup.trigger(hxrouterTriggerId(envelope.session, envelope.reply_to)) : undefined
  const ref: ThreadRef = direct ? { source: SOURCE, id: envelope.address || envelope.session }
    : parent?.threads[0] ?? { source: SOURCE, id: `${envelope.address || envelope.session}#${envelope.platform_message_id}` }
  const actor = hxrouterActor(envelope.platform, envelope.sender.id)
  const mentioned = envelope.flags.mention_self === true || envelope.mentions.some(mention => mention.is_self === true)
    || envelope.flags.mention_self == null && mentionsAccount(envelope.text, lookup.self?.(envelope.instance_id))
  const repliedToMe = envelope.flags.reply_to_self === true
  const addressed = direct ? 'direct' as const : mentioned || repliedToMe ? 'mention' as const : undefined
  return {
    id: hxrouterTriggerId(envelope.session, envelope.platform_message_id), source: SOURCE, threads: [ref],
    actor: { source: SOURCE, id: actor }, human: !lookup.bots().includes(actor), ...addressed ? { addressed } : {},
    at: isoTime(envelope.occurred_at || envelope.received_at), text: envelope.text, channel: hxrouterChannel(envelope, threadKey(ref)),
    meta: { session: envelope.session, address: envelope.address, sessionType: envelope.session_type, platform: envelope.platform,
      instanceId: envelope.instance_id, envelopeId: envelope.id, platformMessageId: envelope.platform_message_id,
      senderName: envelope.sender.name, direct, mentioned, ...envelope.reply_to ? { replyTo: envelope.reply_to } : {} },
  }
}
/** The gateway reference a Trigger of this Source keeps, used to read its context. */
export interface HxRouterRef { session: string; address: string; instanceId: number; envelopeId: number; replyTo?: string }
export function hxrouterRef(trigger: Trigger): HxRouterRef | undefined {
  const meta = trigger.meta as { session?: unknown; address?: unknown; instanceId?: unknown; envelopeId?: unknown; replyTo?: unknown }
  if (trigger.source !== SOURCE || typeof meta.session !== 'string' || typeof meta.instanceId !== 'number'
    || typeof meta.envelopeId !== 'string' || !/^m_\d+$/.test(meta.envelopeId)) return undefined
  return { session: meta.session, address: typeof meta.address === 'string' ? meta.address : '', instanceId: meta.instanceId,
    envelopeId: Number(meta.envelopeId.slice(2)), ...typeof meta.replyTo === 'string' ? { replyTo: meta.replyTo } : {} }
}
