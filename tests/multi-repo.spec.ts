/** One GitHub Source instance per repository: registry, settings, polling, PR binding, replies, reads and the execution environment. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type Assessor, type Executor, type Ticket, type Trigger } from '../src/core/index.ts'
import { SettingsSchema, allowedSender, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { githubKind, githubKindWith, instanceContext, pollRound } from '../src/sources/github.ts'
import { issueTrigger } from '../src/sources/github-trigger.ts'
import { claimPull, observePull, pullEndNotices, type Pull } from '../src/sources/github-pull.ts'
import { readGithub } from '../src/sources/github-read.ts'
import { Store } from '../src/app/store.ts'
import { Commands } from '../src/infra/commands.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import { githubInstances, instanceOf, repositoryOf, type Deployment } from '../src/deployment.ts'
import { Setup } from '../src/app/setup.ts'
import { UserError } from '../src/core/index.ts'
import { KV } from '../src/kv.ts'
import { parseRepositories, repeatedRepositories } from '../src/client/repositories.tsx'
import { testDeployment } from './fixtures/deployment.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

const GADGETS = 'acme/gadgets'
const deployment = (): Deployment => testDeployment({ repositories: { 'github-2': GADGETS } })
const stored = SettingsSchema.parse({
  sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh-agent' } },
    'github-2': { enabled: true, kind: 'github', config: { repository: GADGETS } } },
  policy: { sources: { github: { allowed: [{ id: 'alice' }] }, 'github-2': { allowed: [{ id: 'bob' }] } } },
})

function host() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'multi-repo-')), 'db.sqlite'))
  store.saveSettings(stored)
  const board = new HealthBoard()
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(githubKind)
  const assessor: Assessor = { request: vi.fn(async () => {}) }
  const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const resolved = deployment()
  const commands = new Commands(() => resolved, {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger) => engine.receive(trigger))
  const deps: SourceContextDeps = { store, engine, outbox: { send: message => { store.receipts.add(message) } }, commands, sources, deployment: resolved,
    ready: Promise.resolve(), configured: () => true, receive }
  const base = sourceContextOf(deps, { kind: 'github', health: ['github'] })
  const gadgets = instanceContext(base, 'github-2', GADGETS, sources.instanceHealth('github-2'))
  return { store, sources, board, base, gadgets, receive, commands }
}
/** Answers `gh api` by path per repository; `--include` reads get HTTP headers. Returns the paths read, repository included. */
function github(routes: Record<string, unknown>): string[] {
  const reads: string[] = []
  vi.spyOn(Commands.prototype, 'run').mockImplementation(async (_program, args) => {
    const path = args[1]!
    reads.push(path)
    const bare = path.split('?')[0]!
    const value = routes[bare] ?? (/\/(comments|reviews|statuses)$/.test(bare) ? [] : bare.endsWith('/check-runs') ? { check_runs: [] } : [])
    if (args.includes('--include')) return `HTTP/2.0 200 OK\r\nX-Poll-Interval: 60\r\n\r\n${JSON.stringify(value)}`
    return JSON.stringify(args.includes('--slurp') ? [value] : value)
  })
  return reads
}
const issue = (number: number, body: string, login = 'bob') => ({ id: number * 10, number, title: `Issue ${number}`, state: 'open', body,
  user: { login, type: 'User' }, created_at: new Date(Date.now() + 60_000).toISOString(), html_url: `https://github.com/${GADGETS}/issues/${number}` })
afterEach(() => { vi.restoreAllMocks() })

describe('GitHub instances in the registry', () => {
  it('lists an extra instance after its kind\'s default one, with its own title, health entries, policy part and Threads', () => {
    const sources = new SourceRegistry(() => stored)
    sources.register(githubKind)
    expect(sources.instances().map(item => [item.id, item.kind, item.config.repository])).toEqual([['github', 'github', 'acme/widgets'],
      ['github-2', 'github', GADGETS]])
    expect(sources.kind('github-2')).toBe(githubKind)
    expect(sources.instancesOf('github')).toEqual(['github', 'github-2'])
    expect(sources.title('github-2')).toEqual({ zh: `GitHub · ${GADGETS}`, en: `GitHub · ${GADGETS}` })
    expect(sources.healthNames('github-2')).toEqual(['github@github-2'])
    expect(sources.policyPart('github-2')?.allowed).toEqual([{ id: 'bob' }])
    // The same login is allowed in one repository and not in the other.
    expect(allowedSender(stored, { source: 'github-2', id: 'bob' })).toBeDefined()
    expect(allowedSender(stored, { source: 'github', id: 'bob' })).toBeUndefined()
    expect(sources.find('#3').threads).toEqual(['github:3', 'github-2:3'])
    expect(sources.scope({ source: 'github-2', meta: { kind: 'issue' } }).listened).toBe(true)
    const off = new SourceRegistry(() => SettingsSchema.parse({ sources: { ...stored.sources, 'github-2': { ...stored.sources['github-2']!, enabled: false } } }))
    off.register(githubKind)
    expect(off.scope({ source: 'github-2', meta: {} })).toEqual({ listened: false, reason: 'source_disabled' })
    // A stored instance whose kind takes one instance only is not an instance of it.
    const single = new SourceRegistry(() => SettingsSchema.parse({ sources: { 'probe-2': { kind: 'probe', config: {} } } }))
    expect(single.kind('probe-2')).toBeUndefined()
  })
  it('gives Triggers, channels and IDs of an extra instance its own ID, so equal numbers in two repositories never meet', () => {
    const opened = { number: 3, title: 'T', body: '@agent-bot fix', user: { login: 'bob' }, created_at: '2026-11-10T00:00:00Z', html_url: 'u' }
    const primary = issueTrigger(opened, 'agent-bot')
    const extra = issueTrigger(opened, 'agent-bot', 'github-2')
    expect(extra).toMatchObject({ source: 'github-2', threads: [{ source: 'github-2', id: '3' }], actor: { source: 'github-2', id: 'bob' },
      channel: { source: 'github-2', thread: 'github-2:3' } })
    expect(extra.id).not.toBe(primary.id)
    expect(primary).toMatchObject({ source: 'github', channel: { thread: 'github:3' } })
  })
  it('resolves repositories by instance and instances by repository', () => {
    const resolved = deployment()
    expect(repositoryOf(resolved, 'github')).toBe('acme/widgets')
    expect(repositoryOf(resolved, 'github-2')).toBe(GADGETS)
    expect(repositoryOf(resolved, 'feishu')).toBeUndefined()
    expect(instanceOf(resolved, 'ACME/Gadgets')).toBe('github-2')
    expect(githubInstances(resolved)).toEqual([['github', 'acme/widgets'], ['github-2', GADGETS]])
  })
  it('tells a ticket from an extra instance its repository, and every repository the installation watches', () => {
    const values = githubKind.environment!.values
    const trigger = issueTrigger({ number: 3, title: 'T', body: '', user: { login: 'bob' }, created_at: '', html_url: '' }, 'agent-bot', 'github-2')
    expect(values({ deployment: deployment(), config: {} as never, trigger })).toMatchObject({ DSH_SUPERAGENT_GITHUB_REPOSITORY: GADGETS,
      DSH_SUPERAGENT_GITHUB_REPOSITORIES: `acme/widgets ${GADGETS}`, DSH_SUPERAGENT_GITHUB_NUMBER: '3' })
    // A ticket from a chat works in the default repository.
    const chat = { ...trigger, source: 'feishu', threads: [{ source: 'feishu', id: 'oc_1:om_1' }] }
    expect(values({ deployment: deployment(), config: {} as never, trigger: chat })).toMatchObject({ DSH_SUPERAGENT_GITHUB_REPOSITORY: 'acme/widgets',
      DSH_SUPERAGENT_GITHUB_NUMBER: '' })
  })
})

describe('polling an extra GitHub instance', () => {
  it('reads its own repository and records its Triggers, Threads, cursors and health apart from the default instance', async () => {
    const h = host()
    const reads = github({
      [`repos/${GADGETS}/notifications`]: [{ repository: { full_name: 'acme/Gadgets' }, subject: { url: `https://api.github.com/repos/${GADGETS}/issues/3` } }],
      [`repos/${GADGETS}/issues/3`]: issue(3, '@agent-bot please fix'),
    })
    await pollRound(h.gadgets)
    expect(reads.every(path => path.startsWith(`repos/${GADGETS}/`))).toBe(true)
    const received = h.receive.mock.calls.map(([trigger]) => trigger)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ source: 'github-2', actor: { source: 'github-2', id: 'bob' }, addressed: 'mention' })
    expect(h.store.threads.get('github-2:3')).toBeDefined()
    expect(h.store.threads.get('github:3')).toBeUndefined()
    // The extra instance's cursor is its own; the default instance has not polled.
    expect(h.store.get(KV.github.since)).toBeUndefined()
    expect(h.store.get(`github-2/${KV.github.since}` as typeof KV.github.since)).toBeDefined()
    expect(h.board.all['github@github-2']).toMatchObject({ state: 'ready' })
    expect(h.board.all.github?.state).not.toBe('ready')
    h.store.close()
  })
  it('binds the agent\'s PR on a ticket\'s branch in an extra repository to that repository\'s Thread', async () => {
    const h = host()
    const ticket: Ticket = { id: 't1', title: 'one', decisionId: 'd1', mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' },
      actor: { source: 'feishu', id: 'ou_alice' }, scope: '' }, channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '',
    execution: { name: 'fix-login', directory: '/w/fix-login', assignment: '' }, origin: { triggerId: 'x', triggerIds: [] } }
    h.store.tickets.save(ticket)
    const pr: Pull = { number: 5, title: 'Fix', state: 'open', html_url: `https://github.com/${GADGETS}/pull/5`, user: { login: 'agent-bot' },
      head: { sha: 'abc', ref: 'agent/fix-login', repo: { full_name: GADGETS } } }
    await observePull(h.gadgets, pr)
    expect(h.store.tickets.get('t1')?.follows).toEqual([expect.objectContaining({ thread: 'github-2:5', own: true })])
    // The same number in the default repository belongs to nobody, and a PR from the other repository is not this instance's.
    expect(claimPull(h.base, 't1', { ...pr, head: { ...pr.head, repo: { full_name: GADGETS } } })).toMatch(/does not belong/)
    const ended = { ...h.store.tickets.get('t1')!, channels: [{ source: 'feishu', thread: 'feishu:oc_1', address: { chatId: 'oc_1', messageId: 'om_1' } }],
      follows: [{ thread: 'github-2:5', own: true, closed: { outcome: 'merged' as const, at: '2026-11-10T00:00:00Z' } }],
      ended: { outcome: 'merged' as const, at: '2026-11-10T00:00:00Z' } } as unknown as Ticket
    const notices = pullEndNotices(ended, 'fix it', source => repositoryOf(deployment(), source))
    expect(notices).toHaveLength(1)
    expect(notices[0]!.text).toContain(`https://github.com/${GADGETS}/pull/5`)
    h.store.close()
  })
  it('replies through the repository of the Thread it answers, and reads github-<n>/ resources from that repository', async () => {
    const h = host()
    const reads = github({ [`repos/${GADGETS}/issues/3/comments`]: [], [`repos/${GADGETS}/issues/3`]: issue(3, 'body') })
    const kind = githubKindWith(() => undefined)
    const sent = await kind.channel!.send({ commands: h.commands }, { id: 'r1', kind: 'reply', text: 'done',
      channel: { source: 'github-2', thread: 'github-2:3', address: { number: '3' } } })
    expect(sent).toBe('sent')
    expect(reads.filter(path => path.includes('/issues/3/comments'))).not.toHaveLength(0)
    expect(reads.every(path => path.startsWith(`repos/${GADGETS}/`))).toBe(true)
    reads.length = 0
    await readGithub(h.commands, 'github-2/issues/3')
    expect(reads).toEqual([`repos/${GADGETS}/issues/3`])
    await expect(readGithub(h.commands, 'github-9/issues/3')).rejects.toThrow('no repository')
    h.store.close()
  })
})

describe('the repository table', () => {
  it('reads pasted repositories as owner/name or github.com links, once each, and names the entries it cannot read', () => {
    expect(parseRepositories('acme/a\nhttps://github.com/acme/b/pull/3, github.com/Acme/A  acme/c.git nope')).toEqual({
      repositories: ['acme/a', 'acme/b', 'acme/c'], invalid: ['nope'] })
    expect(repeatedRepositories([{ repository: 'acme/a', enabled: true }, { repository: 'ACME/A', enabled: true },
      { repository: 'acme/w', enabled: true }], 'acme/w')).toEqual(['ACME/A', 'acme/w'])
  })
})

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })
describe('saving GitHub instances', () => {
  it('adds, keeps and removes instances under numbers never reused, copies a policy part, and refuses what setup would leave out', async () => {
    h = await startRuntime()
    const restart = vi.spyOn(Setup.prototype, 'restart').mockImplementation(() => {})
    const { settings, store } = h.runtime
    const policy = store.settings().policy
    await settings.save('policy', { ...policy, sources: { ...policy.sources, github: { ...policy.sources.github, allowed: [{ id: 'alice' }] } } },
      store.blockRevision('policy'), 'panel')
    const revision = () => store.blockRevision('instances:github')
    const added = await settings.saveInstances('github', [{ config: { repository: GADGETS, cli: 'ignored' }, policyFrom: 'github' }], revision(), 'panel')
    expect(added).toMatchObject({ saved: true, restarting: true, instances: [{ id: 'github-2', enabled: true, config: { repository: GADGETS } }] })
    expect(restart).toHaveBeenCalled()
    // The account's fields stay on the default instance; the new one starts from its allowed list.
    expect(store.settings().sources['github-2']).toMatchObject({ kind: 'github', config: { repository: GADGETS, cli: '' } })
    expect(store.settings().policy.sources['github-2']?.allowed).toEqual([{ id: 'alice' }])
    await expect(settings.saveInstances('github', [{ id: 'github-2', config: { repository: GADGETS } }, { config: { repository: 'acme/readonly' } }],
      revision(), 'panel')).rejects.toMatchObject({ code: 'repositoriesRefused' })
    await expect(settings.saveInstances('github', [{ config: { repository: 'acme/widgets' } }], revision(), 'panel'))
      .rejects.toMatchObject({ code: 'instanceDuplicate' })
    await expect(settings.saveInstances('feishu', [], revision(), 'panel')).rejects.toBeInstanceOf(UserError)
    // An instance with an open ticket stays until the ticket ends.
    store.tickets.save({ id: 't-gadgets', title: 'gadgets work', decisionId: 'd', mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' },
      actor: { source: 'github-2', id: 'alice' }, scope: '' }, channels: [{ source: 'github-2', thread: 'github-2:3', address: { number: '3' } }],
    assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: 'none', triggerIds: [] } })
    await expect(settings.saveInstances('github', [], revision(), 'panel')).rejects.toMatchObject({ code: 'instanceInUse' })
    store.tickets.save({ ...store.tickets.get('t-gadgets')!, ended: { outcome: 'done', at: '2026-11-10T00:00:00Z' } } as unknown as Ticket)
    await settings.saveInstances('github', [], revision(), 'panel')
    expect(store.settings().sources['github-2']).toBeUndefined()
    const again = await settings.saveInstances('github', [{ config: { repository: GADGETS } }], revision(), 'panel')
    expect(again.instances.map(row => row.id)).toEqual(['github-3'])
    // The settings view lists the instance with its kind's fields less the account's, and the block's revision.
    const view = h.runtime.settings.view()
    expect(view.instances.github?.revision).toBe(revision())
    expect(settings.block('instances:github').value).toEqual(again.instances)
  })
})
