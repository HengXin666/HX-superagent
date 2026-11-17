/** Plugin configuration and startup verification for repository access and agent CLI identities. */
import { LIMITS } from './limits.ts'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { runAsWorker, sameDirectory, withoutDirectory, workerBin } from './infra/environment.ts'
import { SetupError } from './setup.ts'
import { ACCOUNT_REPOSITORIES } from './infra/commands.ts'
import { isRepositoryPattern, patternOwner, patternRowOf } from './infra/repository-pattern.ts'

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error)
const absolute = (description: string) => s.string().pattern(/^\//).description(`${description} Absolute path.`)
/** Plugin configuration of the dsh-superagent entry. Volatile fields apply without a restart because dsh-superagent reads them on each use; changing `stateDir` remounts the plugin. */
export const Config = s.object({
  stateDir: absolute('Directory for the database, locks, worker shims, the agent\'s git configuration and, by default, the ticket directories.').required(),
  promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(100000)
    .description('Largest saved prompt configuration, in characters.').volatile(),
  admissionContextMaxPages: s.number().min(LIMITS.admissionContextMaxPages.min).max(LIMITS.admissionContextMaxPages.max).step(1).default(10)
    .description('Pages of thread context one assessment may read.').volatile(),
  admissionContextTimeoutMs: s.number().min(LIMITS.admissionContextTimeoutMs.min).max(LIMITS.admissionContextTimeoutMs.max).step(1)
    .default(15000).description('Time limit of one context read during an assessment, in milliseconds.').volatile(),
})
export type DeploymentConfig = ReturnType<typeof Config>
export interface Machine {
  stateDir: string
  promptMaxChars: Volatile<number>
  admissionContextMaxPages: Volatile<number>
  admissionContextTimeoutMs: Volatile<number>
}
const MOVED: Record<string, string> = {
  repository: 'on the GitHub Source', branchPrefix: 'in the prepare command of the Execution settings', github: 'on the GitHub Source',
  feishu: 'on the Feishu Source', author: 'prompt text', repositoryPath: 'in the prepare command of the Execution settings',
  worktreeRoot: 'the ticket directory of the Execution settings', blockedCommands: 'in the Execution settings',
}

/** Read machine settings and reject unknown configuration keys (naming where deprecated keys moved). */
export function machineOf(config: DeploymentConfig): Machine {
  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))
  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)
  const { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs } = config
  return { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs }
}

export const GithubAccountsSchema = z.object({
  /** owner/name, or on an extra instance a pattern such as owner/** (`isRepositoryPattern`). */
  repository: z.string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.*-]+)?$/, 'owner/name or owner/**').default(''),
  cli: z.string().trim().default(''),
})
export const FeishuBotSchema = z.object({ cli: z.string().trim().default('') })
/** Source configuration keys that affect deployment setup and trigger a restart when changed. */
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { github: Object.keys(GithubAccountsSchema.shape), feishu: Object.keys(FeishuBotSchema.shape) }

export interface Deployment extends Machine {
  /** Canonical repository of the default GitHub instance (`github`). */
  repository: string
  /** Canonical repository of each extra GitHub instance (such as `github-2`) whose push access setup verified. */
  repositories?: Record<string, string>
  /**
   * The pattern of each extra GitHub instance whose repository is a pattern (such as `owner/**`), by instance ID. Such a row is
   * one instance in the settings; the repositories it covers right now are in `repositories` under their own IDs (`memberId`).
   */
  patterns?: Record<string, string>
  /** Why setup left an extra GitHub instance out, by instance ID; the other instances run. */
  repositoryProblems?: Record<string, string>
  github: { cli: string; login: string; noreply: string }
  feishu?: FeishuBot
}
export interface FeishuBot { cli: string; appId: string; brand: 'feishu' | 'lark'; botId: string; name: string }

/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
export function executable(name: string, path: string, exclude?: string): string {
  if (name.includes('/') && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`)
  const candidates = isAbsolute(name) ? [name] : path.split(delimiter).filter(dir => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude))).map(dir => join(dir, name))
  for (const candidate of candidates) {
    try { if (statSync(candidate).isFile()) { accessSync(candidate, constants.X_OK); return candidate } }
    catch { /* Not an executable file here; try the next PATH directory. */ }
  }
  throw new Error(`${name} is not an executable file${isAbsolute(name) ? '' : ' on PATH'}`)
}

export type Probe = (argv: string[]) => Promise<string>
/** Run startup checks through DSH's worker subprocess service with worker shims removed from PATH so a `gh` wrapper script reaches the real binary. */
export function workerProbe(subprocess: SubprocessRuntime, stateDir: string, cwd: string, signal: AbortSignal): Probe {
  const path = withoutDirectory(process.env.PATH ?? '', workerBin(stateDir))
  return argv => runAsWorker(subprocess, ['env', `PATH=${path}`, ...argv], cwd, AbortSignal.any([signal, AbortSignal.timeout(60_000)]))
}

const GithubUser = z.object({ login: z.string().regex(/^[A-Za-z0-9-]+$/), id: z.number().int().positive() })
const RepositoryAccess = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), push: z.boolean().nullable() })
function parsed<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined /* Non-JSON output; the caller surfaces the setup failure. */ }
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}
/** The repository of GitHub instance `id` (`github` or an extra instance setup verified), or undefined. */
export const repositoryOf = (deployment: Pick<Deployment, 'repository' | 'repositories'>, id: string): string | undefined =>
  id === 'github' ? deployment.repository : deployment.repositories?.[id]
/** The GitHub instance whose repository is `repository` (case-insensitive), or undefined. */
export function instanceOf(deployment: Pick<Deployment, 'repository' | 'repositories'>, repository: string): string | undefined {
  const same = (name: string) => name.toLowerCase() === repository.toLowerCase()
  if (same(deployment.repository)) return 'github'
  return Object.entries(deployment.repositories ?? {}).find(([, name]) => same(name))?.[0]
}
/** Every GitHub instance ID with its repository, the default instance first. */
export const githubInstances = (deployment: Pick<Deployment, 'repository' | 'repositories'>): [id: string, repository: string][] =>
  [['github', deployment.repository], ...Object.entries(deployment.repositories ?? {})]
/** The repositories pattern rows cover right now, by their instances' IDs (`memberId`). */
export const patternMembers = (deployment: Pick<Deployment, 'repositories'>): Record<string, string> =>
  Object.fromEntries(Object.entries(deployment.repositories ?? {}).filter(([id]) => patternRowOf(id) !== undefined))
/**
 * `deployment` with the repositories each pattern row covers (`members`, by row ID) among its repositories. A repository the default
 * instance or an explicit row names stays theirs, one an earlier row already covers stays that row's, and a row setup did not verify
 * as a pattern covers nothing.
 */
export function withMembers(deployment: Deployment, members: ReadonlyMap<string, Record<string, string>>): Deployment {
  if (!members.size) return deployment
  const explicit = Object.fromEntries(Object.entries(deployment.repositories ?? {}).filter(([id]) => patternRowOf(id) === undefined))
  const taken = new Set([deployment.repository, ...Object.values(explicit)].map(name => name.toLowerCase()))
  const covered: Record<string, string> = {}
  for (const row of Object.keys(deployment.patterns ?? {})) {
    for (const [id, repository] of Object.entries(members.get(row) ?? {})) {
      if (patternRowOf(id) !== row || taken.has(repository.toLowerCase())) continue
      taken.add(repository.toLowerCase())
      covered[id] = repository
    }
  }
  return { ...deployment, repositories: { ...explicit, ...covered } }
}
/** How many repositories setup checks at once. */
const ACCESS_CHECKS = 8
/** Checks the agent account's push access to one repository and returns its canonical name. */
async function repositoryAccess(cli: string, login: string, remote: string, probe: Probe): Promise<string> {
  // Use the canonical repository name returned by GitHub so renamed repositories match incoming notifications.
  const access = parsed(RepositoryAccess, await probe([cli, 'api', `repos/${remote}`, '--jq', '{name: .full_name, push: .permissions.push}']).catch((error: unknown) => {
    throw new SetupError('repositoryUnreadable', { account: login, repository: remote, output: reason(error) })
  }))
  if (!access) throw new SetupError('repositoryUnreported', { repository: remote })
  if (access.push !== true) throw new SetupError('repositoryReadOnly', { account: login, repository: access.name })
  return access.name
}
export { isRepositoryPattern, matchesPattern, REPOSITORY_PATTERN } from './infra/repository-pattern.ts'
const ListedRepository = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), push: z.boolean().nullable(),
  fork: z.boolean().nullable().default(false), archived: z.boolean().nullable().default(false) })
/** Checks that the owner a repository pattern covers exists for the agent account; the repositories it covers are found at runtime. */
async function patternAccess(cli: string, pattern: string, probe: Probe): Promise<string> {
  const owner = patternOwner(pattern)
  const login = (await probe([cli, 'api', `users/${owner}`, '--jq', '.login']).catch((error: unknown) => {
    throw new SetupError('patternOwnerUnreadable', { owner, output: reason(error) })
  })).trim()
  if (!login) throw new SetupError('patternOwnerUnreadable', { owner, output: '' })
  return `${login}/${pattern.trim().split('/')[1] ?? ''}`
}
/** Every repository the agent account owns or collaborates on, itself or through an organization, by lowercased name: 100 a read. */
async function reachableRepositories(cli: string, probe: Probe): Promise<Map<string, z.infer<typeof ListedRepository>>> {
  const output = await probe([cli, 'api', '--paginate', ACCOUNT_REPOSITORIES,
    '--jq', '.[] | {name: .full_name, push: .permissions.push, fork: .fork, archived: .archived}'])
  const repositories = new Map<string, z.infer<typeof ListedRepository>>()
  for (const line of output.split('\n')) {
    const repository = line.trim() ? parsed(ListedRepository, line) : undefined
    if (repository) repositories.set(repository.name.toLowerCase(), repository)
  }
  return repositories
}
/**
 * Verify the agent's GitHub CLI identity and push access to the configured repository, and to the repository of each extra GitHub
 * instance in `extras`. An extra repository that fails its check is left out with its reason in `repositoryProblems`, so one
 * unreachable repository does not stop the others; one that repeats another instance's repository is left out the same way.
 */
export async function resolveDeployment(machine: Machine, github: unknown, probe: Probe, path = process.env.PATH ?? '',
  extras: readonly { id: string; repository: string }[] = []): Promise<Deployment> {
  const { stateDir } = machine
  const accounts = GithubAccountsSchema.parse(github ?? {})
  const remote = accounts.repository
  if (!remote) throw new SetupError('repositoryUnset')
  if (isRepositoryPattern(remote)) throw new SetupError('repositoryPatternDefault', { repository: remote })
  if (!accounts.cli) throw new SetupError('agentCliUnset')
  let cli: string
  try { cli = executable(accounts.cli, path, workerBin(stateDir)) } catch (error) { throw new SetupError('agentCliMissing', { output: reason(error) }) }
  const text = await probe([cli, 'api', 'user']).catch((error: unknown) => { throw new SetupError('agentCliSignedOut', { output: reason(error) }) })
  const agent = parsed(GithubUser, text)
  if (!agent) throw new SetupError('agentCliNoAccount')
  const repository = await repositoryAccess(cli, agent.login, remote, probe)
  const repositories: Record<string, string> = {}, repositoryProblems: Record<string, string> = {}, patterns: Record<string, string> = {}
  const taken = new Set([repository.toLowerCase()])
  // A long table is checked against one listing of the account's repositories, 100 a read, instead of one read each; a repository
  // the listing leaves out (renamed or transferred, say) is read alone. Those are read a few at a time, then taken in table order.
  const listed = extras.length > ACCESS_CHECKS ? await reachableRepositories(cli, probe).catch(() => undefined) : undefined
  const access = (remote: string): Promise<string> => {
    const known = listed?.get(remote.toLowerCase())
    if (!known) return repositoryAccess(cli, agent.login, remote, probe)
    if (known.push !== true) return Promise.reject(new SetupError('repositoryReadOnly', { account: agent.login, repository: known.name }))
    return Promise.resolve(known.name)
  }
  const checks: Promise<string>[] = []
  for (let start = 0; start < extras.length; start += ACCESS_CHECKS) {
    const batch = extras.slice(start, start + ACCESS_CHECKS)
      .map(extra => !extra.repository ? Promise.resolve('') : isRepositoryPattern(extra.repository)
        ? patternAccess(cli, extra.repository, probe) : access(extra.repository))
    for (const check of batch) check.catch(() => { /* read below, in table order */ })
    await Promise.allSettled(batch)
    checks.push(...batch)
  }
  for (const [index, extra] of extras.entries()) {
    if (!extra.repository) { repositoryProblems[extra.id] = 'The instance names no repository.'; continue }
    try {
      const name = await checks[index]!
      if (isRepositoryPattern(name)) {
        if (taken.has(name.toLowerCase())) { repositoryProblems[extra.id] = `${name} is already another GitHub instance's pattern.`; continue }
        taken.add(name.toLowerCase())
        patterns[extra.id] = name
        continue
      }
      if (taken.has(name.toLowerCase())) { repositoryProblems[extra.id] = `${name} is already another GitHub instance's repository.`; continue }
      taken.add(name.toLowerCase())
      repositories[extra.id] = name
    } catch (error) {
      if (!(error instanceof SetupError)) throw error
      repositoryProblems[extra.id] = error.message
    }
  }
  return { ...machine, repository, ...extras.length ? { repositories, repositoryProblems } : {},
    ...Object.keys(patterns).length ? { patterns } : {},
    github: { cli, login: agent.login, noreply: `${agent.id}+${agent.login}@users.noreply.github.com` } }
}

const AuthStatus = z.object({ appId: z.string().regex(/^cli_[A-Za-z0-9]+$/), brand: z.enum(['feishu', 'lark']).default('feishu'), identities: z.object({ bot: z.object({ status: z.string() }) }) })
const BotInfo = z.object({ bot: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9]+$/), app_name: z.string().default('') }) })
/**
 * Verify that the configured Feishu CLI is authenticated as a bot and restricted to strict mode `bot`.
 * Workers invoke this CLI as `lark-cli`, so a CLI that also permits a user identity would let workers act as that user.
 */
export async function resolveFeishuBot(machine: Machine, feishu: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<FeishuBot | undefined> {
  const { cli: name } = FeishuBotSchema.parse(feishu ?? {})
  if (!name) return undefined
  const fail = (error: unknown): never => { throw error instanceof SetupError ? error : new SetupError('feishuCliFailed', { output: reason(error) }) }
  let cli = ''
  try { cli = executable(name, path, workerBin(machine.stateDir)) } catch (error) { fail(error) }
  const run = (...args: string[]): Promise<string> => probe(['env', 'LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1', 'LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1', cli, ...args]).catch(fail)
  const text = await run('auth', 'status')
  const status = parsed(AuthStatus, text.slice(text.indexOf('{')))
  if (!status) return fail(new SetupError('feishuNoApp'))
  if (status.identities.bot.status !== 'ready') fail(new SetupError('feishuBotNotReady', { app: status.appId, status: status.identities.bot.status }))
  const mode = /strict-mode:\s*(\w+)/.exec(await run('config', 'strict-mode'))?.[1]
  if (mode !== 'bot') fail(new SetupError('feishuUserIdentity', { mode: mode ?? 'unknown' }))
  // `--format json` unwraps only `data`, whereas this endpoint returns the payload under `bot`.
  const info = parsed(BotInfo, (await run('api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--format', 'ndjson')).split('\n')[0] ?? '')
  if (!info) return fail(new SetupError('feishuNoBot'))
  return { cli, appId: status.appId, brand: status.brand, botId: info.bot.open_id, name: info.bot.app_name }
}
