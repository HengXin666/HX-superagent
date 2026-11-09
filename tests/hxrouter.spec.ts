/** HX-Email Source: envelope mapping, listening scope, subscription consumption, context reads and replies through a fake gateway. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboundMessage, Trigger } from '../src/core/index.ts'
import { idempotencyKey, sendHxRouter } from '../src/sources/hxrouter-channel.ts'
import { SUBSCRIPTION, consume, ensureSubscription, repliesToSelf, runHxRouter, type HxRouterConfig } from '../src/sources/hxrouter-loops.ts'
import { readHxRouter } from '../src/sources/hxrouter-read.ts'
import { covers, mentionsAccount, hxrouterRef, hxrouterScope, hxrouterTrigger, hxrouterTriggerId } from '../src/sources/hxrouter-trigger.ts'
import { HxRouterConfigSchema, hxrouterKind } from '../src/sources/hxrouter.ts'
import type { SourceContext } from '../src/sources/host.ts'
import type { Envelope } from '../src/sources/hxrouter-api.ts'

const CONFIG: HxRouterConfig = { baseUrl: 'http://gw.test:8080/', tokenEnv: 'HXR_TEST_TOKEN', sessions: [{ address: 'qq:3/group/555', listen: 'mentions' },
  { address: 'qq:3/private', listen: 'mentions' }, { address: 'qq:3/group/777', listen: 'all' }], pollSeconds: 1, readPageSize: 3 }
beforeEach(() => { process.env.HXR_TEST_TOKEN = 'hxr_secret' })
afterEach(() => { delete process.env.HXR_TEST_TOKEN })

function envelope(id: number, over: Partial<Omit<Envelope, 'sender' | 'flags'>> & { sender?: Partial<Envelope['sender']>; flags?: Envelope['flags'] } = {}): Envelope {
  const { sender, ...rest } = over
  return { id: `m_${id}`, platform: 'qq', instance_id: 3, session: 'qq:3:group:555', address: 'qq:3/group/555', session_type: 'group',
    direction: 'inbound', text: `message ${id}`, reply_to: '', platform_message_id: String(9000 + id), occurred_at: '2026-11-09T12:00:00Z',
    received_at: '2026-11-09T12:00:01Z', mentions: [], flags: { from_self: false, mention_self: false, reply_to_self: false },
    ...rest, sender: { id: '10001', name: 'alice', is_self: false, ...sender } }
}
const lookup = (triggers: Record<string, Trigger> = {}, bots: string[] = []) => ({ trigger: (id: string) => triggers[id], bots: () => bots })

/** A fake gateway answering by method and path; every request is recorded with its parsed body. */
function gateway(handler: (method: string, path: string, query: URLSearchParams, body: any) => { status?: number; body: unknown } | 'hang' | undefined) {
  const calls: { method: string; path: string; query: URLSearchParams; body: any; auth: string | null }[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const path = url.pathname.replace('/api/v1/router', '')
    calls.push({ method: init.method ?? 'GET', path, query: url.searchParams, body, auth: new Headers(init.headers).get('authorization') })
    const answer = handler(init.method ?? 'GET', path, url.searchParams, body) ?? { status: 404, body: { error: { code: 'route_not_found', message: 'no' } } }
    // A long poll that waits until its caller gives up.
    if (answer === 'hang') return new Promise<Response>((_resolve, reject) => { init.signal?.addEventListener('abort', () => { reject(init.signal!.reason) }, { once: true }) })
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetch, calls }
}

describe('hxrouter triggers and scope', () => {
  it('maps a group mention to an addressed trigger on its own thread, and a reply onto the thread of the message it answers', () => {
    const first = hxrouterTrigger(envelope(1, { flags: { mention_self: true } }), lookup())!
    expect(first).toMatchObject({ id: hxrouterTriggerId('qq:3:group:555', '9001'), source: 'hxrouter', threads: [{ source: 'hxrouter', id: 'qq:3/group/555#9001' }],
      actor: { source: 'hxrouter', id: 'qq:10001' }, human: true, addressed: 'mention', at: '2026-11-09T12:00:00.000Z', text: 'message 1',
      channel: { source: 'hxrouter', thread: 'hxrouter:qq:3/group/555#9001', address: { session: 'qq:3:group:555', sessionType: 'group', messageId: '9001' } },
      meta: { session: 'qq:3:group:555', address: 'qq:3/group/555', instanceId: 3, envelopeId: 'm_1', platformMessageId: '9001' } })
    const reply = hxrouterTrigger(envelope(2, { reply_to: '9001' }), lookup({ [first.id]: first }))!
    expect(reply.threads).toEqual(first.threads)
    expect(reply).not.toHaveProperty('addressed')
    expect(hxrouterKind({ config: () => CONFIG, bots: () => [] }).repliesTo!(reply)).toBe(first.id)
    expect(hxrouterRef(reply)).toEqual({ session: 'qq:3:group:555', address: 'qq:3/group/555', instanceId: 3, envelopeId: 2, replyTo: '9001' })
    // A reply to a message never received starts its own thread.
    expect(hxrouterTrigger(envelope(3, { reply_to: '1' }), lookup())!.threads[0]!.id).toBe('qq:3/group/555#9003')
  })
  it('makes a direct chat one addressed thread, treats listed bots as non-human, and drops the bot account\'s own messages', () => {
    const direct = hxrouterTrigger(envelope(4, { session: 'qq:3:private:10001', address: 'qq:3/private/10001', session_type: 'private' }), lookup())!
    expect(direct).toMatchObject({ addressed: 'direct', threads: [{ id: 'qq:3/private/10001' }], meta: { direct: true } })
    expect(hxrouterTrigger(envelope(5, { flags: { reply_to_self: true } }), lookup())!.addressed).toBe('mention')
    expect(hxrouterTrigger(envelope(6), lookup({}, ['qq:10001']))!.human).toBe(false)
    expect(hxrouterTrigger(envelope(7, { sender: { is_self: true } }), lookup())).toBeUndefined()
    expect(hxrouterTrigger(envelope(8, { direction: 'outbound' }), lookup())).toBeUndefined()
  })
  it('finds an @-mention of the bot account in the text when the gateway leaves mention_self null, as QQ does', () => {
    expect(mentionsAccount('@3000 please fix the build', '3000')).toBe(true)
    expect(mentionsAccount('ping @30001', '3000')).toBe(false)
    expect(mentionsAccount('mail@3000', '3000')).toBe(false)
    expect(mentionsAccount('@3000', undefined)).toBe(false)
    const unflagged = envelope(9, { text: '@3000 fix it', flags: { from_self: false, mention_self: null, reply_to_self: null } })
    expect(hxrouterTrigger(unflagged, { ...lookup(), self: () => '3000' })!.addressed).toBe('mention')
    expect(hxrouterTrigger(unflagged, lookup())!.addressed).toBeUndefined()
    // An explicit false from the gateway is believed.
    expect(hxrouterTrigger({ ...unflagged, flags: { mention_self: false } }, { ...lookup(), self: () => '3000' })!.addressed).toBeUndefined()
  })
  it('tells a reply to the bot\'s own message from the session history when the gateway leaves reply_to_self null', async () => {
    const { fetch, calls } = gateway((method, path) => method === 'GET' && path === '/messages'
      ? { body: { messages: [envelope(3, { direction: 'outbound', platform_message_id: '70001', sender: { is_self: true } })], next_cursor: 'c1.3.3', has_more: false } }
      : undefined)
    const client = (await import('../src/sources/hxrouter-api.ts')).routerClient(CONFIG, fetch)
    const reply = envelope(150, { reply_to: '70001', flags: { reply_to_self: null } })
    expect(await repliesToSelf(client, reply)).toBe(true)
    expect(calls[0]!.query.get('cursor')).toBe('c1.3.50')
    expect(await repliesToSelf(client, { ...reply, reply_to: '9001' })).toBe(false)
    expect(await repliesToSelf(client, { ...reply, flags: { reply_to_self: false } })).toBe(false)
    expect(calls).toHaveLength(2)
  })
  it('listens by the most specific selector covering whole path segments', () => {
    expect(covers('qq:3/group/55', 'qq:3/group/555')).toBe(false)
    expect(covers('qq:3', 'qq:3/group/555')).toBe(true)
    expect(hxrouterScope({ address: 'qq:3/group/555' }, CONFIG)).toEqual({ listened: true, observed: false, row: 'qq:3/group/555' })
    expect(hxrouterScope({ address: 'qq:3/group/777' }, CONFIG)).toEqual({ listened: true, observed: true, row: 'qq:3/group/777' })
    expect(hxrouterScope({ address: 'qq:3/private/42' }, CONFIG)).toMatchObject({ listened: true, row: 'qq:3/private' })
    expect(hxrouterScope({ address: 'qq:3/group/999' }, CONFIG)).toEqual({ listened: false, reason: 'chat_not_allowed' })
    const kind = hxrouterKind({ config: () => CONFIG, bots: () => [] })
    expect(kind.channel!.allowed!({ address: 'qq:3/group/999' }, CONFIG)).toBe(false)
    expect(kind.policy!.rows!(CONFIG).map(row => [row.id, row.cells.listedUnaddressed])).toEqual([['qq:3/group/555', false], ['qq:3/private', false], ['qq:3/group/777', true]])
  })
  it('validates its configuration and policy part', () => {
    expect(HxRouterConfigSchema.safeParse({ sessions: [{ address: 'github_user:7/repo/hx/x', listen: 'all' }] }).success).toBe(false)
    expect(HxRouterConfigSchema.safeParse({ sessions: [{ address: 'qqbot:5/guild/1/channel/2', listen: 'all' }] }).success).toBe(true)
    expect(HxRouterConfigSchema.parse({ accounts: [{ instance: 'qq:16', account: '3000' }] }).accounts).toEqual([{ instance: 'qq:16', account: '3000' }])
    expect(HxRouterConfigSchema.safeParse({ accounts: [{ instance: 'qq', account: '3000' }] }).success).toBe(false)
    expect(HxRouterConfigSchema.safeParse({ accounts: [{ instance: 'qq:16', account: '1' }, { instance: 'qq:16', account: '2' }] }).success).toBe(false)
    expect(HxRouterConfigSchema.parse({})).toEqual({ baseUrl: '', tokenEnv: 'HX_ROUTER_TOKEN', sessions: [], accounts: [], githubInstance: 0, pollSeconds: 25, readPageSize: 20 })
    expect(() => HxRouterConfigSchema.parse({ sessions: [{ address: 'qq:3:group:555', listen: 'all' }] })).toThrow()
    const policy = hxrouterKind({ config: () => CONFIG, bots: () => [] }).policy!.schema
    expect(policy.parse({ allowed: [{ id: 'qq:10001', name: 'Alice' }], bots: [{ id: 'qqbot:42' }] })).toMatchObject({ allowed: [{ id: 'qq:10001' }] })
    expect(() => policy.parse({ allowed: [{ id: '10001' }] })).toThrow()
  })
})

describe('hxrouter send', () => {
  const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({ id: 'a'.repeat(32), kind: 'reply', text: 'done',
    channel: { source: 'hxrouter', thread: 't', address: { session: 'qq:3:group:555', address: 'qq:3/group/555', sessionType: 'group', messageId: '9001' } }, ...over })
  it('posts to the session with the message id as idempotency key, quoting the message in groups', async () => {
    const { fetch, calls } = gateway(() => ({ status: 202, body: { delivery_id: 'd_1', status: 'queued' } }))
    expect(await sendHxRouter(CONFIG, message(), fetch)).toBe('sent')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/messages', auth: 'Bearer hxr_secret',
      body: { sink: 'qq:3:group:555', text: 'done', reply_to: '9001', idempotency_key: 'a'.repeat(32), wait_seconds: 0 } })
    await sendHxRouter(CONFIG, message({ channel: { source: 'hxrouter', thread: 't', address: { session: 'qq:3:private:1', sessionType: 'private', messageId: '5' } } }), fetch)
    expect(calls[1]!.body.reply_to).toBe('')
  })
  it('counts unknown and queued outcomes as sent, a lost session as gone, and retries failures', async () => {
    for (const status of ['sent', 'unknown', 'held', 'sending']) {
      expect(await sendHxRouter(CONFIG, message(), gateway(() => ({ body: { status } })).fetch)).toBe('sent')
    }
    expect(await sendHxRouter(CONFIG, message(), gateway(() => ({ status: 409, body: { error: { code: 'delivery_unknown', message: '' } } })).fetch)).toBe('sent')
    expect(await sendHxRouter(CONFIG, message(), gateway(() => ({ status: 429, body: { error: { code: 'rate_limited', message: '' } } })).fetch)).toBe('sent')
    expect(await sendHxRouter(CONFIG, message(), gateway(() => ({ status: 404, body: { error: { code: 'session_not_found', message: '' } } })).fetch)).toBe('gone')
    await expect(sendHxRouter(CONFIG, message(), gateway(() => ({ body: { status: 'failed', last_error: 'risk' } })).fetch)).rejects.toThrow(/failed: risk/)
    await expect(sendHxRouter(CONFIG, message(), gateway(() => ({ status: 503, body: { error: { code: 'provider_offline', message: 'off' } } })).fetch)).rejects.toThrow(/provider_offline/)
    delete process.env.HXR_TEST_TOKEN
    await expect(sendHxRouter(CONFIG, message(), gateway(() => undefined).fetch)).rejects.toThrow(/HXR_TEST_TOKEN/)
  })
  it('hashes message ids the gateway would refuse as idempotency keys', () => {
    expect(idempotencyKey('ack:abc12345')).toBe('ack:abc12345')
    expect(idempotencyKey('x')).toMatch(/^[0-9a-f]{32}$/)
    expect(idempotencyKey('a/b'.repeat(10))).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('hxrouter context reads', () => {
  /** A session of messages m_1..m_n in instance 3, read forward from a `c1.3.<id>` cursor. */
  const session = (ids: number[], pageSize = 200) => gateway((method, path, query) => {
    if (path !== '/messages') return undefined
    expect(query.get('direction')).toBe('both')
    const after = Number(query.get('cursor')!.split('.')[2])
    const items = ids.filter(id => id > after).slice(0, Math.min(Number(query.get('limit')), pageSize))
    const more = ids.some(id => id > (items.at(-1) ?? Infinity))
    return { body: { messages: items.map(id => envelope(id, id === 2 ? { sender: { is_self: true } } : {})), next_cursor: `c1.3.${items.at(-1) ?? after}`, has_more: more, gap: false } }
  })
  const ref = { session: 'qq:3:group:555', address: 'qq:3/group/555', instanceId: 3, envelopeId: 6, replyTo: '9002' }
  it('pages the session back from the trigger, the trigger included', async () => {
    const { fetch } = session([1, 2, 3, 4, 5, 6, 7], 2)
    const first = await readHxRouter(ref, 'thread', undefined, { ...CONFIG, readPageSize: 3 }, { fetch })
    expect(first.messages.map(item => item.id)).toEqual(['9004', '9005', '9006'])
    expect(first.next).toBe('4')
    const older = await readHxRouter(ref, 'thread', first.next, { ...CONFIG, readPageSize: 3 }, { fetch })
    expect(older.messages.map(item => item.id)).toEqual(['9001', '9002', '9003'])
    expect(older.messages[1]).toMatchObject({ bot: true })
    expect(older.next).toBeUndefined()
  })
  it('finds the replied-to message, and reports roots and missing parents', async () => {
    const { fetch } = session([1, 2, 3, 4, 5, 6])
    expect((await readHxRouter(ref, 'parent', undefined, CONFIG, { fetch })).messages).toEqual([expect.objectContaining({ id: '9002', text: 'message 2' })])
    expect((await readHxRouter({ ...ref, replyTo: '1' }, 'parent', undefined, CONFIG, { fetch })).status).toBe('unavailable')
    expect((await readHxRouter({ ...ref, replyTo: undefined }, 'parent', undefined, CONFIG, { fetch })).status).toBe('no_parent')
    expect((await readHxRouter(ref, 'root', undefined, CONFIG, { fetch })).status).toBe('no_root')
  })
})

describe('hxrouter subscription consumer', () => {
  function context(config: HxRouterConfig | undefined = CONFIG) {
    const state = new Map<string, unknown>()
    const triggers = new Map<string, Trigger>()
    const received: Trigger[] = []
    const reports: { state: string; detail: string }[] = []
    const ctx = {
      ready: Promise.resolve(), configured: () => true, config: () => config,
      receive: vi.fn(async (trigger: Trigger) => { received.push(trigger); triggers.set(trigger.id, trigger); return {} }),
      state: { get: (key: string) => state.get(key), set: (key: string, value: unknown) => { if (value === undefined) state.delete(key); else state.set(key, value) }, keys: () => [] },
      threads: { describe: vi.fn() }, triggers: { get: (id: string) => triggers.get(id) },
      report: (_entry: string, health: { state: string; detail: string }) => { reports.push(health) },
    } as unknown as SourceContext
    return { ctx, state, received, reports }
  }
  it('creates a subscription starting now and reuses it while the gateway keeps it', async () => {
    const { ctx, state } = context()
    let created = 0
    const { fetch, calls } = gateway((method, path) => {
      if (method === 'POST' && path === '/subscriptions') return { status: 201, body: { id: 40 + ++created, source: 'qq:3:group:555', address: 'qq:3/group/555' } }
      if (method === 'GET' && path === '/subscriptions/41') return { body: { id: 41, address: 'qq:3/group/555' } }
      return undefined
    })
    const client = (await import('../src/sources/hxrouter-api.ts')).routerClient(CONFIG, fetch)
    expect(await ensureSubscription(ctx, client, 'http://gw.test:8080', 'qq:3/group/555')).toBe(41)
    expect(calls[0]!.body).toEqual({ source: 'qq:3/group/555', name: 'dsh-superagent', filter: { direction: 'inbound', exclude_self: true }, from: 'now', delivery: 'pull' })
    expect(state.get(SUBSCRIPTION('http://gw.test:8080', 'qq:3/group/555'))).toBe(41)
    expect(await ensureSubscription(ctx, client, 'http://gw.test:8080', 'qq:3/group/555')).toBe(41)
    state.set(SUBSCRIPTION('http://gw.test:8080', 'qq:3/group/555'), 99)
    expect(await ensureSubscription(ctx, client, 'http://gw.test:8080', 'qq:3/group/555')).toBe(42)
  })
  it('hands every message of a page to the Engine before acknowledging the page', async () => {
    const { ctx, state, received } = context()
    state.set(SUBSCRIPTION('http://gw.test:8080', 'qq:3/group/555'), 7)
    const controller = new AbortController()
    let polls = 0
    const order: string[] = []
    const { fetch, calls } = gateway((method, path) => {
      if (path === '/subscriptions/7' && method === 'GET') return { body: { id: 7, address: 'qq:3/group/555' } }
      if (path === '/subscriptions/7/events') {
        polls++
        if (polls === 1) return { body: { subscription_id: 7, ack_cursor: 'c1.0.0', messages: [envelope(1, { flags: { mention_self: true } }), { junk: true },
          envelope(2, { reply_to: '9001' }), envelope(3, { sender: { is_self: true } })], next_cursor: 'c1.0.3', has_more: false, gap: false } }
        controller.abort()
        return { body: { subscription_id: 7, ack_cursor: 'c1.0.3', messages: [], next_cursor: 'c1.0.3', timed_out: true } }
      }
      if (path === '/subscriptions/7/ack') { order.push(`ack ${received.length}`); return { body: { id: 7 } } }
      return undefined
    })
    const reports: string[] = []
    await consume(ctx, CONFIG, 'qq:3/group/555', { fetch, bots: () => [] }, controller.signal, (state, detail) => { reports.push(`${state}: ${detail}`) })
    expect(received.map(trigger => trigger.text)).toEqual(['message 1', 'message 2'])
    expect(received[1]!.threads).toEqual(received[0]!.threads)
    expect(order).toEqual(['ack 2'])
    expect(calls.find(call => call.path.endsWith('/ack'))!.body).toEqual({ cursor: 'c1.0.3' })
    expect(calls.find(call => call.path.endsWith('/events'))!.query.get('timeout_seconds')).toBe('1')
    expect(reports).toContain('error: qq:3/group/555: 1 unreadable gateway messages skipped')
  })
  it('recreates a subscription the gateway lost, and pauses while the key is unset', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, state } = context()
      state.set(SUBSCRIPTION('http://gw.test:8080', 'qq:3/group/555'), 7)
      const controller = new AbortController()
      let created = false
      const { fetch } = gateway((method, path) => {
        if (path === '/subscriptions/7' && method === 'GET') return { body: { id: 7, address: 'qq:3/group/555' } }
        if (path === '/subscriptions/7/events') return { status: 404, body: { error: { code: 'route_not_found', message: 'gone' } } }
        if (method === 'POST' && path === '/subscriptions') { created = true; controller.abort(); return { status: 201, body: { id: 8, address: 'qq:3/group/555' } } }
        return undefined
      })
      const reports: string[] = []
      const running = consume(ctx, CONFIG, 'qq:3/group/555', { fetch, bots: () => [] }, controller.signal, (s, d) => { reports.push(`${s}: ${d}`) })
      await vi.advanceTimersByTimeAsync(1500)
      await running
      expect(created).toBe(true)
      expect(reports.some(line => line.startsWith('error: qq:3/group/555') && line.includes('route_not_found'))).toBe(true)
      delete process.env.HXR_TEST_TOKEN
      const paused: string[] = []
      const second = new AbortController()
      const idle = consume(ctx, CONFIG, 'qq:3/group/555', { fetch, bots: () => [] }, second.signal, (s, d) => { paused.push(`${s}: ${d}`); second.abort() })
      await vi.advanceTimersByTimeAsync(10)
      await idle
      expect(paused[0]).toMatch(/^paused: .*HXR_TEST_TOKEN/)
    } finally { vi.useRealTimers() }
  })
  it('runs one consumer per listed selector and retires the subscription of a selector dropped from the list', async () => {
    vi.useFakeTimers()
    try {
      let config: HxRouterConfig = { ...CONFIG, sessions: [{ address: 'qq:3/group/555', listen: 'mentions' }, { address: 'qq:3/private', listen: 'all' }] }
      const harness = context()
      ;(harness.ctx as unknown as { config: () => unknown }).config = () => config
      let next = 10
      const { fetch, calls } = gateway((method, path, _query, body) => {
        if (method === 'POST' && path === '/subscriptions') return { status: 201, body: { id: ++next, address: body.source } }
        if (path.endsWith('/events')) return 'hang'
        if (method === 'DELETE') return { body: { deleted: true } }
        return undefined
      })
      const controller = new AbortController()
      const running = runHxRouter(harness.ctx, controller.signal, { fetch, bots: () => [], reconcileMs: 100 })
      await vi.advanceTimersByTimeAsync(50)
      expect(calls.filter(call => call.method === 'POST').map(call => call.body.source).sort()).toEqual(['qq:3/group/555', 'qq:3/private'])
      config = { ...config, sessions: [{ address: 'qq:3/group/555', listen: 'all' }] }
      await vi.advanceTimersByTimeAsync(200)
      const deleted = calls.filter(call => call.method === 'DELETE').map(call => call.path)
      expect(deleted).toHaveLength(1)
      expect(harness.state.get(SUBSCRIPTION('http://gw.test:8080', 'qq:3/private'))).toBeUndefined()
      expect(harness.state.get(SUBSCRIPTION('http://gw.test:8080', 'qq:3/group/555'))).toBeDefined()
      controller.abort()
      await vi.advanceTimersByTimeAsync(10)
      await running
      expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})
