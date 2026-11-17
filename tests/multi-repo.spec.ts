/** One GitHub Source instance per repository: registry, settings, polling, PR binding, replies, reads and the execution environment. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type Assessor, type Executor, type Ticket, type Trigger } from '../src/core/index.ts'
import { SettingsSchema, allowedSender, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { githubKind, githubKindWith, instanceContext, instanceContexts, pollRound, readInbox, watch } from '../src/sources/github.ts'
import { LISTING_INTERVAL_MS, RepositoryPatterns } from '../src/sources/github-patterns.ts'
import { memberId, patternRowOf } from '../src/infra/repository-pattern.ts'
import { issueTrigger } from '../src/sources/github-trigger.ts'
import { claimPull, observePull, pullEndNotices, type Pull } from '../src/sources/github-pull.ts'
import { readGithub } from '../src/sources/github-read.ts'
import { Store } from '../src/app/store.ts'
import { Commands } from '../src/infra/commands.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import { githubInstances, instanceOf, matchesPattern, patternMembers, repositoryOf, withMembers, type Deployment } from '../src/deployment.ts'
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
      notifications: [{ repository: { full_name: 'acme/Gadgets' }, subject: { url: `https://api.github.com/repos/${GADGETS}/issues/3` } }],
      [`repos/${GADGETS}/issues/3`]: issue(3, '@agent-bot please fix'),
    })
    await pollRound(h.gadgets)
    // The inbox is the account's; every other read is of the instance's own repository.
    expect(reads.filter(path => !path.startsWith('notifications?')).every(path => path.startsWith(`repos/${GADGETS}/`))).toBe(true)
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
  it('reads the account\'s inbox once for every repository, from the earliest cursor, and gives each repository its own notifications',
    async () => {
    const h = host()
    const now = Date.now()
    h.store.set(KV.github.since, new Date(now - 30 * 60_000).toISOString())
    h.store.set(`github-2/${KV.github.since}` as typeof KV.github.since, new Date(now - 60_000).toISOString())
    const fresh = new Date(now - 5_000).toISOString(), stale = new Date(now - 25 * 60_000).toISOString()
    const reads = github({
      notifications: [
        { repository: { full_name: 'acme/widgets' }, updated_at: stale, subject: { url: 'https://api.github.com/repos/acme/widgets/issues/1' } },
        { repository: { full_name: GADGETS }, updated_at: stale, subject: { url: `https://api.github.com/repos/${GADGETS}/issues/2` } },
        { repository: { full_name: GADGETS }, updated_at: fresh, subject: { url: `https://api.github.com/repos/${GADGETS}/issues/3` } }],
      'repos/acme/widgets/issues/1': { ...issue(1, '@agent-bot one'), html_url: 'https://github.com/acme/widgets/issues/1' },
      [`repos/${GADGETS}/issues/3`]: issue(3, '@agent-bot three'),
    })
    const inbox = readInbox(h.commands, new Date(now - 30 * 60_000).toISOString())
    await pollRound(h.base, undefined, inbox)
    await pollRound(h.gadgets, undefined, inbox)
    expect(reads.filter(path => path.startsWith('notifications?'))).toHaveLength(1)
    // #2 was listed only because the default instance's cursor is earlier; the extra instance read up to its own cursor already.
    expect(reads.some(path => path.endsWith(`${GADGETS}/issues/2`))).toBe(false)
    expect(h.receive.mock.calls.map(([trigger]) => [trigger.source, trigger.meta.number])).toEqual([['github', 1], ['github-2', 3]])
    h.store.close()
  })
  it('takes in an Issue whose notification GitHub listed only after the cursor passed the Issue, once, and skips it in later rounds', async () => {
    const h = host()
    const now = Date.now()
    // The previous round moved the cursor past the Issue before its notification was listed (#44 on 2026-11-10: Issue 15:52:28,
    // cursor about 15:52:40, notification listed in the round of 15:53:48).
    h.store.set(`github-2/${KV.github.since}` as typeof KV.github.since, new Date(now - 20_000).toISOString())
    const created = new Date(now - 32_000).toISOString()
    const opened = { ...issue(44, '@agent-bot reply with one sentence'), created_at: created }
    const reads = github({
      notifications: [{ repository: { full_name: GADGETS }, updated_at: new Date(now - 10_000).toISOString(),
        subject: { url: `https://api.github.com/repos/${GADGETS}/issues/44` } }],
      [`repos/${GADGETS}/issues/44`]: opened,
    })
    await pollRound(h.gadgets)
    const listed = reads.find(path => path.startsWith('notifications?'))!
    expect(Date.parse(decodeURIComponent(/since=([^&]+)/.exec(listed)![1]!))).toBeLessThan(Date.parse(created))
    expect(h.receive.mock.calls.map(([trigger]) => trigger.source)).toEqual(['github-2'])
    expect(h.store.threads.get('github-2:44')).toBeDefined()
    // The next round lists the same notification again (the list looks back) but does not read or deliver it again.
    reads.length = 0
    await pollRound(h.gadgets)
    expect(reads.some(path => path.includes('/issues/44'))).toBe(false)
    expect(h.receive).toHaveBeenCalledTimes(1)
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
    // The inbox is the account's; every other read is of the instance's own repository.
    expect(reads.filter(path => !path.startsWith('notifications?')).every(path => path.startsWith(`repos/${GADGETS}/`))).toBe(true)
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
    // Adding a repository applies in place: no restart, and the running deployment polls it from the next round.
    expect(added).toMatchObject({ saved: true, restarting: false, instances: [{ id: 'github-2', enabled: true,
      config: { repository: GADGETS, observeIssues: true, observePulls: true, observeComments: true, observeCi: false } }] })
    expect(restart).not.toHaveBeenCalled()
    expect(h.runtime.deployment.repositories).toEqual({ 'github-2': 'acme/Gadgets' })
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
    expect(h.runtime.deployment.repositories).toEqual({ 'github-3': 'acme/Gadgets' })
    // The settings view lists the instance with its kind's fields less the account's, and the block's revision.
    const view = h.runtime.settings.view()
    expect(view.instances.github?.revision).toBe(revision())
    expect(settings.block('instances:github').value).toEqual(again.instances)
  })
})

describe('repository patterns', () => {
  it('matches an owner and a name glob, case-insensitively', () => {
    expect(matchesPattern('acme/**', 'ACME/tools')).toBe(true)
    expect(matchesPattern('acme/*', 'acme/tools')).toBe(true)
    expect(matchesPattern('acme/hx-*', 'acme/HX-ui')).toBe(true)
    expect(matchesPattern('acme/hx-*', 'acme/ui')).toBe(false)
    expect(matchesPattern('acme/**', 'other/tools')).toBe(false)
    expect(parseRepositories('HengXin666/** acme/a').repositories).toEqual(['HengXin666/**', 'acme/a'])
    // A covered repository's instance ID is the same for every spelling of its name, fits the Source ID format, and names its row.
    expect(memberId('github-4', 'acme/Tools')).toBe(memberId('github-4', 'ACME/tools'))
    expect(memberId('github-4', 'acme/tools')).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(patternRowOf(memberId('github-4', 'acme/tools'))).toBe('github-4')
    expect(patternRowOf('github-4')).toBeUndefined()
  })
  it('keeps a pattern row one row when saved, checks only its owner, and applies it without a restart', async () => {
    h = await startRuntime()
    const restart = vi.spyOn(Setup.prototype, 'restart').mockImplementation(() => {})
    const { settings, store } = h.runtime
    const saved = await settings.saveInstances('github', [{ config: { repository: 'acme/**' }, policyFrom: 'github' }],
      store.blockRevision('instances:github'), 'panel')
    expect(saved.restarting).toBe(false)
    expect(restart).not.toHaveBeenCalled()
    expect(saved.instances).toEqual([{ id: 'github-2', enabled: true, config: expect.objectContaining({ repository: 'acme/**',
      observeIssues: true, observePulls: true, observeComments: true }) }])
    expect(store.settings().sources['github-2']?.config.repository).toBe('acme/**')
    // Setup lists no repository for it: the GitHub Source finds the repositories it covers at runtime.
    expect(h.runtime.deployment.patterns).toEqual({ 'github-2': 'acme/**' })
    expect(h.runtime.deployment.repositories).toEqual({})
    // Saving again keeps the one row.
    const again = await settings.saveInstances('github', saved.instances, store.blockRevision('instances:github'), 'panel')
    expect(again.instances.map(row => [row.id, row.config.repository])).toEqual([['github-2', 'acme/**']])
    await expect(settings.saveInstances('github', [...again.instances, { config: { repository: 'nobody/**' } }], store.blockRevision('instances:github'),
      'panel')).rejects.toMatchObject({ code: 'repositoriesRefused' })
    // A pattern row with an open ticket in a repository it covers stays until the ticket ends.
    const covered = memberId('github-2', 'acme/tools')
    store.tickets.save({ id: 't-tools', title: 'tools work', decisionId: 'd', mandate: { strength: 'explicit', policyVersion: '', basis: { via: 'listed' },
      actor: { source: covered, id: 'alice' }, scope: '' }, channels: [{ source: covered, thread: `${covered}:3`, address: { number: '3' } }],
    assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: 'none', triggerIds: [] } })
    await expect(settings.saveInstances('github', [], store.blockRevision('instances:github'), 'panel')).rejects.toMatchObject({ code: 'instanceInUse' })
  })
})

const PATTERN_ROW = 'github-3'
const TOOLS = 'acme/tools'
/** The default repository, an explicit row for acme/gadgets, and a pattern row acme/** whose policy part allows carol. */
function patternHost(config: Record<string, unknown> = {}) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'multi-repo-')), 'db.sqlite'))
  store.saveSettings(SettingsSchema.parse({ ...stored, sources: { ...stored.sources,
    [PATTERN_ROW]: { enabled: true, kind: 'github', config: { repository: 'acme/**', ...config } } },
  policy: { sources: { ...stored.policy.sources, [PATTERN_ROW]: { allowed: [{ id: 'carol' }] } } } }))
  const board = new HealthBoard()
  const verified = testDeployment({ repositories: { 'github-2': GADGETS }, patterns: { [PATTERN_ROW]: 'acme/**' } })
  const members = new Map<string, Record<string, string>>()
  let current = verified
  const sources = new SourceRegistry(() => store.settings(), board, undefined, () => patternMembers(current))
  sources.register(githubKind)
  const assessor: Assessor = { request: vi.fn(async () => {}) }
  const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const commands = new Commands(() => current, {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger) => engine.receive(trigger))
  const deps: SourceContextDeps = { store, engine, outbox: { send: () => {} }, commands, sources, get deployment() { return current },
    ready: Promise.resolve(), configured: () => true, receive,
    adopt: (row, covered) => { members.set(row, covered); current = withMembers(verified, members) } }
  const base = sourceContextOf(deps, { kind: 'github', health: ['github'] })
  const patterns = new RepositoryPatterns(base, row => sources.instanceHealth(row).get(`github@${row}`))
  return { store, sources, board, base, patterns, receive, commands, deployment: () => current,
    contexts: () => instanceContexts({ sources, context: () => base }, base, patterns) }
}
/** Runs the GitHub Source's loop until `done` holds, then stops it. */
async function watching(h: ReturnType<typeof patternHost>, done: () => boolean): Promise<void> {
  const controller = new AbortController()
  const running = watch(h.base, controller.signal, h.contexts, h.patterns)
  await vi.waitFor(() => { if (!done()) throw new Error('not yet') })
  controller.abort()
  await running
}
const listed = (name: string, push = true, extra: Record<string, unknown> = {}) => ({ full_name: name, permissions: { push }, fork: false,
  archived: false, ...extra })

describe('repository pattern rows', () => {
  it('takes a mention in a repository no instance has yet into the pattern row\'s instance, with the row\'s policy', async () => {
    const h = patternHost()
    const fresh = 'acme/fresh'
    const reads = github({
      // The listing predates the repository; its first mention brings it in.
      'user/repos': [listed(GADGETS)],
      notifications: [{ repository: { full_name: fresh }, updated_at: new Date().toISOString(), subject: { url: `https://api.github.com/repos/${fresh}/issues/7` } }],
      [`repos/${fresh}/issues/7`]: { ...issue(7, '@agent-bot please fix', 'carol'), html_url: `https://github.com/${fresh}/issues/7` },
    })
    await watching(h, () => h.receive.mock.calls.length > 0)
    const id = memberId(PATTERN_ROW, fresh)
    const [trigger] = h.receive.mock.calls[0]!
    expect(trigger).toMatchObject({ source: id, actor: { source: id, id: 'carol' }, addressed: 'mention' })
    expect(reads.filter(path => path.startsWith(`repos/${fresh}/`)).length).toBeGreaterThan(0)
    // The row's Policy part, switches and kind are the instance's; the allowed list of the default repository is not.
    const settings = h.store.settings()
    expect(allowedSender(settings, { source: id, id: 'carol' })).toBeDefined()
    expect(allowedSender(settings, { source: id, id: 'alice' })).toBeUndefined()
    expect(settingsPolicy(settings, h.sources).gate(trigger, h.store.threads.get(`${id}:7`)!, [])).toMatchObject({ admissible: true, strength: 'explicit' })
    expect(h.sources.kind(id)).toBe(githubKind)
    expect(h.sources.title(id)).toEqual({ zh: `GitHub · ${fresh}`, en: `GitHub · ${fresh}` })
    expect(h.sources.find('#7').threads).toContain(`${id}:7`)
    // The settings keep one row; the deployment lists the repository it covers, and so does the execution environment.
    expect(Object.keys(settings.sources)).toEqual(['github', 'github-2', PATTERN_ROW])
    expect(repositoryOf(h.deployment(), id)).toBe(fresh)
    expect(githubKind.environment!.values({ deployment: h.deployment(), config: {} as never, trigger }).DSH_SUPERAGENT_GITHUB_REPOSITORIES)
      .toBe(`acme/widgets ${GADGETS} ${fresh}`)
    // The membership survives a restart, and the row reports one health entry for its repositories.
    expect(h.store.get(`${PATTERN_ROW}/${KV.github.members}` as typeof KV.github.members)).toEqual({ [id]: fresh })
    expect(h.board.all[`github@${PATTERN_ROW}`]).toMatchObject({ state: 'ready', detail: expect.stringContaining(fresh) })
    expect(h.board.all[`github@${id}`]).toBeUndefined()
    h.store.close()
  })
  it('leaves a repository on its explicit row and the default repository to the default instance', async () => {
    const h = patternHost()
    github({
      'user/repos': [listed('acme/widgets'), listed('acme/Gadgets')],
      notifications: [{ repository: { full_name: 'acme/Gadgets' }, updated_at: new Date().toISOString(), subject: { url: `https://api.github.com/repos/${GADGETS}/issues/3` } }],
      [`repos/${GADGETS}/issues/3`]: issue(3, '@agent-bot please fix'),
    })
    await watching(h, () => h.receive.mock.calls.length > 0)
    expect(h.receive.mock.calls.map(([trigger]) => trigger.source)).toEqual(['github-2'])
    expect(patternMembers(h.deployment())).toEqual({})
    // A repository a pattern took before its explicit row was added goes back to that row.
    expect(withMembers(testDeployment({ repositories: { 'github-2': GADGETS }, patterns: { [PATTERN_ROW]: 'acme/**' } }),
      new Map([[PATTERN_ROW, { [memberId(PATTERN_ROW, GADGETS)]: GADGETS, [memberId(PATTERN_ROW, TOOLS)]: TOOLS }]])).repositories)
      .toEqual({ 'github-2': GADGETS, [memberId(PATTERN_ROW, TOOLS)]: TOOLS })
    h.store.close()
  })
  it('lists the account\'s repositories at most once an interval, and starts watching the new ones its switches receive', async () => {
    const h = patternHost({ observeIssues: true })
    const reads = github({ 'user/repos': [listed('acme/widgets'), listed(TOOLS), listed('acme/forked', true, { fork: true }),
      listed('acme/old', true, { archived: true }), listed('acme/readonly', false), listed('other/thing')],
    [`repos/${TOOLS}/subscription`]: { subscribed: false, ignored: false } })
    const start = Date.now()
    expect(await h.patterns.list(h.commands, start)).toBe(true)
    expect(await h.patterns.list(h.commands, start + 60_000)).toBe(false)
    expect(reads.filter(path => path.startsWith('user/repos'))).toHaveLength(1)
    const id = memberId(PATTERN_ROW, TOOLS)
    expect(patternMembers(h.deployment())).toEqual({ [id]: TOOLS })
    // The new repository's instance starts its watch in its first round.
    const member = h.contexts().find(context => context.instance === id)!
    await pollRound(member)
    expect(reads).toContain(`repos/${TOOLS}/subscription`)
    expect(h.store.get(`${id}/${KV.github.watching}` as typeof KV.github.watching)).toEqual({ by: 'agent' })
    expect(await h.patterns.list(h.commands, start + LISTING_INTERVAL_MS)).toBe(true)
    expect(reads.filter(path => path.startsWith('user/repos'))).toHaveLength(2)
    h.store.close()
  })
  it('lets go of a repository the account lost push access to, or that no longer matches, and of its watch', async () => {
    const h = patternHost({ observeIssues: true })
    let repositories = [listed(TOOLS), listed('acme/gone')]
    const reads = github({ get 'user/repos'() { return repositories } })
    const start = Date.now()
    await h.patterns.list(h.commands, start)
    const tools = memberId(PATTERN_ROW, TOOLS)
    h.store.set(`${tools}/${KV.github.watching}` as typeof KV.github.watching, { by: 'agent' })
    expect(Object.values(patternMembers(h.deployment()))).toEqual([TOOLS, 'acme/gone'])
    repositories = [listed(TOOLS, false)]
    await h.patterns.list(h.commands, start + LISTING_INTERVAL_MS)
    expect(patternMembers(h.deployment())).toEqual({})
    expect(reads).toContain(`repos/${TOOLS}/subscription`)
    expect(h.store.get(`${tools}/${KV.github.watching}` as typeof KV.github.watching)).toBeUndefined()
    // A mention from a repository the last listing showed it cannot push to does not bring it back.
    expect(h.patterns.take({ since: new Date().toISOString(), interval: 60, notifications: [{ repository: { full_name: TOOLS }, subject: {} }] })).toBe(false)
    // A repository the default instance takes over leaves the row.
    repositories = [listed('acme/widgets'), listed(TOOLS)]
    await h.patterns.list(h.commands, start + 2 * LISTING_INTERVAL_MS)
    expect(Object.values(patternMembers(h.deployment()))).toEqual([TOOLS])
    h.store.close()
  })
})
