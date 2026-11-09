/** GitHub replies through the HX-Email gateway's github_user platform: sink, review-thread replies, re-keying, gone and the direct fallback. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboundMessage } from '../src/core/index.ts'
import { sendGithub } from '../src/sources/github-channel.ts'
import { GATEWAY_TEXT_LIMIT, gatewayGone, githubKey, githubSink, sendGithubGateway, type GithubGateway } from '../src/sources/github-gateway.ts'
import { configuredGateway, githubKind, githubKindWith } from '../src/sources/github.ts'
import { HxRouterConfigSchema } from '../src/sources/hxrouter.ts'

beforeEach(() => { process.env.HXR_GH_TOKEN = 'hxr_secret' })
afterEach(() => { delete process.env.HXR_GH_TOKEN })

/** A fake gateway: `answer` is called per `POST /messages` with the parsed body and returns status and body. */
function fake(answer: (body: any, n: number) => { status?: number; body: unknown }) {
  const calls: any[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    expect(new URL(input).pathname).toBe('/api/v1/router/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hxr_secret')
    const body = JSON.parse(String(init.body))
    calls.push(body)
    const { status = 200, body: reply } = answer(body, calls.length)
    return new Response(JSON.stringify(reply), { status })
  })
  const gateway: GithubGateway = { connection: { baseUrl: 'http://gw.test:8000/', tokenEnv: 'HXR_GH_TOKEN' }, instance: 8, fetch }
  return { gateway, calls }
}
const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({ id: 'reply:abc', kind: 'reply', text: 'done',
  channel: { source: 'github', thread: 'github:42', address: { number: '42' } }, ...over })
/** Commands for sendGithub: the repository and agent account, an `api` that answers review-comment reads, and `pages` that must not run. */
function commands(api: (path: string) => unknown = () => { throw new Error('no read expected') }) {
  return { deployment: { repository: 'hx/HX-Email', github: { login: 'hx-agent' } },
    api: vi.fn(async (_schema: unknown, path: string) => api(path)), pages: vi.fn(async () => { throw new Error('direct path used') }) } as any
}

describe('github through the gateway', () => {
  it('posts the comment to the github_user issue session with a stable key and waits for GitHub', async () => {
    const { gateway, calls } = fake(() => ({ body: { delivery_id: 'd_1', status: 'sent', platform_message_id: 'ic:1' } }))
    expect(await sendGithubGateway(gateway, 'hx/HX-Email', 42, 'done', 'reply:abc')).toBe('sent')
    expect(calls[0]).toEqual({ sink: 'github_user:8:issue:hx/HX-Email#42', text: 'done', reply_to: '', idempotency_key: githubKey('reply:abc', 0), wait_seconds: 5 })
    expect(githubKey('reply:abc', 0)).toMatch(/^[A-Za-z0-9_.:-]{8,64}$/)
    expect(githubKey('reply:abc', 1)).not.toBe(githubKey('reply:abc', 0))
    expect(githubSink(3, 'o/r', 7)).toBe('github_user:3:issue:o/r#7')
  })
  it('replies in a review thread with rc: of its root comment', async () => {
    const { gateway, calls } = fake(() => ({ status: 202, body: { status: 'queued' } }))
    expect(await sendGithubGateway(gateway, 'o/r', 5, 'x', 'm1', 991)).toBe('sent')
    expect(calls[0].reply_to).toBe('rc:991')
  })
  it('counts held, unknown and shaped deliveries as sent, a locked or deleted thread as gone', async () => {
    for (const status of ['sending', 'held', 'unknown']) expect(await sendGithubGateway(fake(() => ({ body: { status } })).gateway, 'o/r', 1, 'x', 'm')).toBe('sent')
    expect(await sendGithubGateway(fake(() => ({ status: 429, body: { error: { code: 'rate_limited', message: '' } } })).gateway, 'o/r', 1, 'x', 'm')).toBe('sent')
    expect(await sendGithubGateway(fake(() => ({ body: { status: 'failed', last_error: 'permission_denied: GitHub refused: HTTP 403 (Issue is locked)' } })).gateway, 'o/r', 1, 'x', 'm')).toBe('gone')
    expect(await sendGithubGateway(fake(() => ({ body: { status: 'failed', last_error: 'provider_error: GitHub returned HTTP 410' } })).gateway, 'o/r', 1, 'x', 'm')).toBe('gone')
    expect(await sendGithubGateway(fake(() => ({ status: 404, body: { error: { code: 'session_not_found', message: '' } } })).gateway, 'o/r', 1, 'x', 'm')).toBe('gone')
    expect(gatewayGone('not_found: repository or thread is gone')).toBe(false)
  })
  it('throws a fresh failure so the Outbox retries, and retries a deduplicated failure under the next key', async () => {
    await expect(sendGithubGateway(fake(() => ({ body: { delivery_id: 'd_2', status: 'failed', last_error: 'unprocessable: no' } })).gateway, 'o/r', 1, 'x', 'm'))
      .rejects.toThrow(/d_2 failed: unprocessable/)
    const { gateway, calls } = fake((_body, n) => n === 1 ? { body: { status: 'failed', deduplicated: true, last_error: 'not_found: x' } } : { body: { status: 'sent' } })
    expect(await sendGithubGateway(gateway, 'o/r', 1, 'x', 'm')).toBe('sent')
    expect(calls.map(call => call.idempotency_key)).toEqual([githubKey('m', 0), githubKey('m', 1)])
    await expect(sendGithubGateway(fake(() => ({ status: 503, body: { error: { code: 'provider_offline', message: 'off' } } })).gateway, 'o/r', 1, 'x', 'm'))
      .rejects.toThrow(/provider_offline/)
  })
  it('sends from the GitHub channel through the gateway with its marker, and long replies directly', async () => {
    const { gateway, calls } = fake(() => ({ body: { status: 'sent' } }))
    const host = { commands: commands() }
    expect(await sendGithub(host, message(), gateway)).toBe('sent')
    expect(calls[0].text).toBe('done\n\n<!-- dsh-superagent:reply:abc -->')
    expect(host.commands.pages).not.toHaveBeenCalled()
    const direct = { commands: { ...commands(), pages: vi.fn(async () => []), api: vi.fn(async () => ({})) } }
    expect(await sendGithub(direct, message({ text: 'y'.repeat(GATEWAY_TEXT_LIMIT) }), gateway)).toBe('sent')
    expect(calls).toHaveLength(1)
    expect(direct.commands.api).toHaveBeenCalledWith(expect.anything(), 'issues/42/comments', '--method', 'POST', '-f', expect.stringMatching(/^body=y+/))
  })
  it('resolves an inline review discussion to its thread root before sending', async () => {
    const { gateway, calls } = fake(() => ({ body: { status: 'sent' } }))
    const host = { commands: commands(path => { expect(path).toBe('pulls/comments/555'); return { id: 555, in_reply_to_id: 500 } }) }
    const url = 'https://github.com/hx/HX-Email/pull/42#discussion_r555'
    expect(await sendGithub(host, message({ channel: { source: 'github', thread: 'github:42', address: { number: '42', url } } }), gateway)).toBe('sent')
    expect(calls[0].reply_to).toBe('rc:500')
  })
  it('takes the gateway from the enabled HX-Email Source only when it names a github_user instance', async () => {
    const config = HxRouterConfigSchema.parse({ baseUrl: 'http://gw', githubInstance: 8 })
    expect(configuredGateway({ enabled: true, config })).toEqual({ connection: { baseUrl: 'http://gw', tokenEnv: 'HX_ROUTER_TOKEN' }, instance: 8 })
    expect(configuredGateway({ enabled: false, config })).toBeUndefined()
    expect(configuredGateway({ enabled: true, config: HxRouterConfigSchema.parse({}) })).toBeUndefined()
    expect(configuredGateway(undefined)).toBeUndefined()
    const { gateway, calls } = fake(() => ({ body: { status: 'sent' } }))
    const kind = githubKindWith(() => gateway)
    expect(kind.kind).toBe(githubKind.kind)
    expect(await kind.channel!.send({ commands: commands() }, message())).toBe('sent')
    expect(calls).toHaveLength(1)
  })
})
