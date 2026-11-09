/** Trigger-scoped context reader for the HX-Email Source: the session's messages before a trigger, and the message it replies to. */
import { cursorAfter, envelopeNumber, envelopes, routerClient, type Envelope, type RouterConnection, type RouterFetch } from './hxrouter-api.ts'
import { hxrouterRef, type HxRouterRef } from './hxrouter-trigger.ts'
import type { ContextMessage, ContextPart, ThreadContext } from './kind.ts'

/** Gateway message IDs one backward window spans; the gateway reads forward only, so a page back is read as a window ending there. */
export const WINDOW = 2000
/** Windows tried before a read reports what it found; a quiet session in a busy instance may need several. */
const WINDOWS = 5
/** Forward pages read within one window. */
const PAGES = 20

export interface ReadConfig extends RouterConnection { readPageSize: number }
export function hxrouterView(envelope: Envelope, bots: readonly string[] = []): ContextMessage {
  const bot = envelope.sender.is_self || bots.includes(`${envelope.platform}:${envelope.sender.id}`)
  return { id: envelope.platform_message_id, from: envelope.sender.name || envelope.sender.id, at: envelope.occurred_at || envelope.received_at,
    text: envelope.text, ...bot ? { bot: true } : {}, ...envelope.reply_to ? { reply_to: envelope.reply_to } : {} }
}

/** Messages of the session with gateway IDs in [start, end), both directions, oldest first. */
async function span(client: ReturnType<typeof routerClient>, ref: HxRouterRef, start: number, end: number): Promise<Envelope[]> {
  const found: Envelope[] = []
  let cursor = cursorAfter(ref.instanceId, start)
  for (let page = 0; page < PAGES; page++) {
    const result = await client.messages(ref.session, cursor, 200)
    const items = envelopes(result)
    found.push(...items.filter(item => envelopeNumber(item.id) < end))
    if (!result.has_more || !items.length || items.some(item => envelopeNumber(item.id) >= end) || result.next_cursor === cursor) break
    cursor = result.next_cursor
  }
  return found
}
/**
 * The newest `size` messages of the session before gateway ID `end`, oldest first, and the ID to continue back from when older
 * messages may remain.
 */
export async function before(client: ReturnType<typeof routerClient>, ref: HxRouterRef, end: number, size: number):
  Promise<{ messages: Envelope[]; next?: number }> {
  const found: Envelope[] = []
  let windowEnd = end
  for (let window = 0; window < WINDOWS && found.length <= size && windowEnd > 0; window++) {
    const start = Math.max(0, windowEnd - WINDOW)
    found.unshift(...await span(client, ref, start, windowEnd))
    windowEnd = start
  }
  const messages = found.slice(-size)
  const more = found.length > size || (windowEnd > 0 && found.length > 0)
  return { messages, ...more && messages.length ? { next: envelopeNumber(messages[0]!.id) } : {} }
}

/**
 * Reads `thread` (the session's messages up to and including the trigger, a page at a time back through `cursor`), `parent`
 * (the message it replies to, searched in the windows before it) or `root` (which gateway sessions do not have).
 */
export async function readHxRouter(ref: HxRouterRef, part: 'thread' | 'root' | 'parent', cursor: string | undefined, config: ReadConfig,
  options: { fetch?: RouterFetch; bots?: readonly string[] } = {}): Promise<ContextPart> {
  const client = routerClient(config, options.fetch)
  if (part === 'root') return { messages: [], body: { status: 'no_root' }, status: 'no_root' }
  if (part === 'parent') {
    if (!ref.replyTo) return { messages: [], body: { status: 'no_parent' }, status: 'no_parent' }
    const read = await before(client, ref, ref.envelopeId, WINDOW * WINDOWS)
    const parent = read.messages.findLast(item => item.platform_message_id === ref.replyTo)
    const messages = parent ? [hxrouterView(parent, options.bots)] : []
    const status = parent ? 'available' : 'unavailable'
    return { messages, body: { status, message: messages[0] ?? null }, status }
  }
  const end = cursor && /^\d+$/.test(cursor) ? Number(cursor) : ref.envelopeId + 1
  const read = await before(client, ref, end, config.readPageSize)
  const messages = read.messages.map(item => hxrouterView(item, options.bots))
  const next = read.next === undefined ? undefined : String(read.next)
  return { messages, next, body: { status: 'available', session: ref.address || ref.session, messages, next_cursor: next ?? null },
    status: 'available' }
}

export function hxrouterThreadContext(options: { fetch?: RouterFetch; bots?: () => readonly string[] } = {}): ThreadContext<ReadConfig> {
  return {
    messageId: trigger => String(trigger.meta.platformMessageId ?? ''),
    read: async (_commands, trigger, part, cursor, config) => {
      const ref = hxrouterRef(trigger)
      if (!ref) throw new Error('An HX-Email source trigger is required')
      return readHxRouter(ref, part, cursor, config, { ...options.fetch ? { fetch: options.fetch } : {}, bots: options.bots?.() ?? [] })
    },
  }
}
