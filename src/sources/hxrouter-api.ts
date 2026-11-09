/** HTTP client for the HX-Email messaging router gateway (`/api/v1/router`) and the envelope it returns. */
import { z } from 'zod'

/** Gateway connection settings shared by every call: the HX-Email base URL and the environment variable holding the `hxr_` key. */
export interface RouterConnection { baseUrl: string; tokenEnv: string }
export type RouterFetch = (input: string, init: RequestInit) => Promise<Response>

/**
 * A gateway call that failed: `status` is the HTTP status (0 when the call never reached the gateway), `code` the gateway's
 * error code (`session_not_found`, `route_not_found`, ...) or a local one (`unconfigured`, `network`, `http_<status>`).
 */
export class RouterError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryable: boolean) { super(message) }
}

/** One message as the gateway's Event v2 view returns it; unknown fields are kept and ignored. */
export const EnvelopeSchema = z.looseObject({
  id: z.string().regex(/^m_\d+$/),
  platform: z.string(),
  instance_id: z.number().int(),
  session: z.string(),
  address: z.string().default(''),
  session_type: z.string(),
  direction: z.string().default('inbound'),
  sender: z.looseObject({ id: z.string().default(''), name: z.string().default(''), is_self: z.boolean().default(false) }),
  text: z.string().default(''),
  reply_to: z.string().default(''),
  platform_message_id: z.string(),
  occurred_at: z.string().default(''),
  received_at: z.string().default(''),
  mentions: z.array(z.looseObject({ id: z.string().default(''), name: z.string().default(''), is_self: z.boolean().nullish() })).default([]),
  flags: z.looseObject({ from_self: z.boolean().nullish(), mention_self: z.boolean().nullish(), reply_to_self: z.boolean().nullish() }).default({}),
})
export type Envelope = z.infer<typeof EnvelopeSchema>
/** A page of `/messages`, `/wait` or `/subscriptions/{id}/events`; the last two add `ack_cursor`, `timed_out` and `paused`. */
export const PageSchema = z.looseObject({
  messages: z.array(z.unknown()).default([]),
  next_cursor: z.string().default(''),
  has_more: z.boolean().default(false),
  gap: z.boolean().default(false),
  ack_cursor: z.string().optional(),
  paused: z.boolean().optional(),
})
export type Page = z.infer<typeof PageSchema>
export const SubscriptionSchema = z.looseObject({ id: z.number().int(), source: z.string().default(''), address: z.string().default(''),
  status: z.string().default('active') })
export type Subscription = z.infer<typeof SubscriptionSchema>
export const DeliverySchema = z.looseObject({ delivery_id: z.string().default(''), status: z.string(), last_error: z.string().default(''),
  deduplicated: z.boolean().default(false), platform_message_id: z.string().default('') })

/** The gateway's numeric message id (`m_123` is 123), which the gateway's cursors are built from. */
export const envelopeNumber = (id: string): number => Number(id.slice(2))
/** A gateway cursor positioned just after message `id` of `instance`; cursors of one session never cross instances. */
export const cursorAfter = (instance: number, id: number): string => `c1.${instance}.${Math.max(0, id)}`

interface CallOptions { query?: Record<string, string | number | boolean | undefined>; body?: unknown; headers?: Record<string, string>;
  timeoutMs?: number; signal?: AbortSignal | undefined }

/** A client bound to one connection; every call carries `Authorization: Bearer <key>` read from the environment at call time. */
export function routerClient(connection: RouterConnection, fetchImpl: RouterFetch = (input, init) => fetch(input, init)) {
  async function call(method: string, path: string, options: CallOptions = {}): Promise<{ status: number; body: unknown }> {
    const base = connection.baseUrl.trim().replace(/\/+$/, '')
    if (!base) throw new RouterError('The HX-Email gateway address is not set', 0, 'unconfigured', false)
    const token = process.env[connection.tokenEnv]?.trim()
    if (!token) throw new RouterError(`The environment variable ${connection.tokenEnv} holding the gateway key is not set`, 0, 'unconfigured', false)
    const query = Object.entries(options.query ?? {}).filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`).join('&')
    const url = `${base}/api/v1/router${path}${query ? `?${query}` : ''}`
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetchImpl(url, { method, signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...options.body !== undefined ? { 'Content-Type': 'application/json' } : {}, ...options.headers },
        ...options.body !== undefined ? { body: JSON.stringify(options.body) } : {} })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new RouterError(`HX-Email gateway unreachable: ${String(error)}`, 0, 'network', true)
    }
    const text = await response.text()
    let body: unknown = undefined
    try { body = text ? JSON.parse(text) : undefined } catch { body = text }
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string; retryable?: boolean }; detail?: unknown } | undefined)
      const code = error?.error?.code ?? `http_${response.status}`
      const message = error?.error?.message ?? (typeof error?.detail === 'string' ? error.detail : JSON.stringify(error?.detail ?? text).slice(0, 500))
      throw new RouterError(`HX-Email gateway ${method} ${path} failed (${response.status} ${code}): ${message}`, response.status, code,
        error?.error?.retryable ?? response.status >= 500)
    }
    return { status: response.status, body }
  }
  return {
    call,
    async subscription(id: number, signal?: AbortSignal): Promise<Subscription> {
      return SubscriptionSchema.parse((await call('GET', `/subscriptions/${id}`, { signal })).body)
    },
    async subscribe(source: string, signal?: AbortSignal): Promise<Subscription> {
      const body = { source, name: 'dsh-superagent', filter: { direction: 'inbound', exclude_self: true }, from: 'now', delivery: 'pull' }
      return SubscriptionSchema.parse((await call('POST', '/subscriptions', { body, signal })).body)
    },
    async unsubscribe(id: number, signal?: AbortSignal): Promise<void> { await call('DELETE', `/subscriptions/${id}`, { signal }) },
    /** Long-polls a subscription from its ack cursor; the call outlives the gateway's wait by 15 seconds. */
    async events(id: number, timeoutSeconds: number, signal?: AbortSignal): Promise<Page> {
      return PageSchema.parse((await call('GET', `/subscriptions/${id}/events`, { query: { timeout_seconds: timeoutSeconds, limit: 50 },
        timeoutMs: (timeoutSeconds + 15) * 1000, signal })).body)
    },
    async ack(id: number, cursor: string, signal?: AbortSignal): Promise<void> {
      await call('POST', `/subscriptions/${id}/ack`, { body: { cursor }, signal })
    },
    async messages(source: string, cursor: string, limit: number, signal?: AbortSignal): Promise<Page> {
      return PageSchema.parse((await call('GET', '/messages', { query: { source, cursor, limit, direction: 'both' }, signal })).body)
    },
    /** The bot account ID of each instance the key can see, by instance ID (empty while the instance is logged out). */
    async accounts(signal?: AbortSignal): Promise<Map<number, string>> {
      const { sources } = z.looseObject({ sources: z.array(z.looseObject({ instance_id: z.number().int(), account_id: z.string().default('') })).default([]) })
        .parse((await call('GET', '/sources', { signal })).body)
      return new Map(sources.filter(source => source.account_id).map(source => [source.instance_id, source.account_id]))
    },
    /** Queues a message; `waitSeconds` (at most 5) lets the gateway return the platform's answer instead of `queued`. */
    async send(body: { sink: string; text: string; reply_to: string; idempotency_key: string }, signal?: AbortSignal, waitSeconds = 0) {
      return DeliverySchema.parse((await call('POST', '/messages', { body: { ...body, wait_seconds: waitSeconds }, signal,
        timeoutMs: 20_000 + waitSeconds * 1000 })).body)
    },
  }
}
export type RouterClient = ReturnType<typeof routerClient>

/** Parses the messages of a page one by one, dropping (and counting) what does not read as an envelope. */
export function envelopes(page: Page, tally?: { skipped: number }): Envelope[] {
  return page.messages.flatMap(item => {
    const parsed = EnvelopeSchema.safeParse(item)
    if (!parsed.success && tally) tally.skipped++
    return parsed.success ? [parsed.data] : []
  })
}
