/** HX-Email outbound channel: sends a reply through the gateway's `POST /messages`, idempotently by the outgoing message's ID. */
import { key, type OutboundMessage } from '../core/index.ts'
import { RouterError, routerClient, type RouterConnection, type RouterFetch } from './hxrouter-api.ts'
import type { ChannelLink } from './kind.ts'

/** The gateway's idempotency key: the message ID itself when it fits the gateway's 8 to 64 characters of `[A-Za-z0-9_.:-]`, else its hash. */
export const idempotencyKey = (id: string): string => /^[A-Za-z0-9_.:-]{8,64}$/.test(id) ? id : key('hxrouter-send', id)
/**
 * Delivery states that mean the gateway holds the message: sent, still queued or shaped (`queued`, `sending`, `held`), or `unknown`
 * (the platform may have it; the gateway never resends it and neither do we, so it counts as sent).
 */
const ACCEPTED = new Set(['sent', 'queued', 'sending', 'held', 'unknown'])
/** Gateway error codes after which the message is queued or may already be out, so a retry would only duplicate it. */
const QUEUED_ERRORS = new Set(['rate_limited', 'outbound_held', 'delivery_unknown'])
/** Gateway error codes that mean the session can never receive this message. */
const GONE_ERRORS = new Set(['session_not_found', 'session_not_sendable'])

/**
 * Sends `message` to its session; a group reply quotes the message it answers. Returns `'gone'` when the session no longer takes
 * messages.
 * @throws RouterError when delivery failed and a later retry may succeed (the gateway is unreachable, offline, or failed the send).
 */
export async function sendHxRouter(connection: RouterConnection, message: OutboundMessage, fetchImpl?: RouterFetch): Promise<'sent' | 'gone'> {
  const { session, sessionType, messageId } = message.channel.address
  if (!session) throw new Error('Missing HX-Email reply session')
  const client = routerClient(connection, fetchImpl)
  try {
    const delivery = await client.send({ sink: session, text: message.text, reply_to: sessionType === 'group' && messageId ? messageId : '',
      idempotency_key: idempotencyKey(message.id) })
    if (ACCEPTED.has(delivery.status)) return 'sent'
    throw new RouterError(`HX-Email delivery ${delivery.delivery_id} ${delivery.status}: ${delivery.last_error}`, 200, delivery.status, true)
  } catch (error) {
    if (error instanceof RouterError && QUEUED_ERRORS.has(error.code)) return 'sent'
    if (error instanceof RouterError && GONE_ERRORS.has(error.code)) return 'gone'
    throw error
  }
}
/** Gateway sessions have no deep link a person can open, so the link names the session alone. */
export const hxrouterLink = (address: Record<string, string>): ChannelLink => ({ url: '',
  label: { zh: `HX-Email 会话 ${address.address || address.session || ''}`.trim(), en: `HX-Email session ${address.address || address.session || ''}`.trim() } })
