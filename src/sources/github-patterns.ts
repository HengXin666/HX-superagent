/**
 * Pattern rows of the GitHub Source, such as `owner/**`: one row in the settings that covers, live, every repository of the owner
 * matching it. Each repository it covers runs as an instance of its own (`memberId`) with the row's switches and Policy part; the
 * repositories are found from the account's inbox (a notification from a repository no instance has yet) and from a listing of the
 * account's repositories made at most every `LISTING_INTERVAL_MS`.
 */
import { z } from 'zod'
import type { Commands } from '../infra/commands.ts'
import type { HealthEntry } from '../infra/health.ts'
import { matchesPattern, memberId, patternRowOf } from '../infra/repository-pattern.ts'
import { KV, type Key } from '../kv.ts'
import { health, type Health, type SourceContext } from './host.ts'
import { SOURCE } from './github-trigger.ts'
import type { Inbox } from './github.ts'

/** How often the pattern rows list the account's repositories: a new repository with no mention yet joins within this time. */
export const LISTING_INTERVAL_MS = 30 * 60_000
/** Rewrites a state key of extra instance `id` into its own namespace; the default instance keeps the historical keys. */
export const own = (id: string, name: string): string => id === SOURCE ? name : `${id}/${name}`
/** The health entry name of extra GitHub instance `id`, such as `github@github-2`. */
export const healthName = (id: string): string => `${SOURCE}@${id}`
/** The repository's watch of the agent account, read and changed at `repos/{owner}/{repo}/subscription`. */
export const SUBSCRIPTION = 'subscription'
const ownKey = <V>(id: string, name: Key<V>): Key<V> => own(id, name) as Key<V>
const lower = (name: string): string => name.toLowerCase()
/** How many repository names a pattern row's health names before it counts the rest. */
const NAMED = 5
const ListedSchema = z.looseObject({ full_name: z.string(), fork: z.boolean().nullish(), archived: z.boolean().nullish(),
  permissions: z.looseObject({ push: z.boolean().nullish() }).nullish() })
type Listed = z.infer<typeof ListedSchema>
/** A repository a pattern may cover: the agent account can push to it, and it is no fork and not archived. */
const coverable = (repository: Listed): boolean => repository.permissions?.push === true && !repository.fork && !repository.archived

/**
 * Keeps, for each pattern row setup verified, the repositories it covers now: saved in the row's state and handed to the running
 * deployment (`SourceContext.adopt`), so each runs as an instance of its own; and reports the row's one health entry for all of them.
 * The GitHub Source's loop calls `prune`, `list` and `take` at the start of each round and `report` at its end.
 */
export class RepositoryPatterns {
  /** The last listing of the account's repositories by lowercased name, which keeps a mention from bringing in one it cannot cover. */
  private listing?: Map<string, Listed>
  /** Why the last listing failed, shown on every pattern row until one succeeds. */
  private problem?: string
  /** The latest health each covered repository's instance reported, by instance ID. */
  private readonly readings = new Map<string, Health>()
  /**
   * @param ctx - the default instance's context, whose deployment names the pattern rows setup verified.
   * @param rowHealth - the health entry of pattern row `row`, which every repository it covers reports under.
   */
  constructor(private readonly ctx: SourceContext, private readonly rowHealth: (row: string) => HealthEntry | undefined,
    private readonly every = LISTING_INTERVAL_MS) {}
  /** Every pattern row setup verified, with its pattern, in table order. */
  private all(): [row: string, pattern: string][] { return Object.entries(this.ctx.deployment.patterns ?? {}) }
  /** The enabled pattern rows, which take in new repositories. */
  private enabled(): [row: string, pattern: string][] { return this.all().filter(([row]) => this.ctx.config(row)) }
  /** The repositories row `row` covers, by their instances' IDs, as it last saved them. */
  members(row: string): Record<string, string> { return this.ctx.state.get(ownKey(row, KV.github.members)) ?? {} }
  private save(row: string, members: Record<string, string>): void {
    this.ctx.state.set(ownKey(row, KV.github.members), Object.keys(members).length ? members : undefined)
    this.ctx.adopt?.(row, members)
  }
  /** Hands the repositories each row covered before to the running deployment, as the Source starts. */
  restore(): void { for (const [row] of this.all()) this.ctx.adopt?.(row, this.members(row)) }
  /** Repositories of the default instance and of explicit rows, which a pattern never takes. */
  private taken(): Set<string> {
    const { repository, repositories = {} } = this.ctx.deployment
    return new Set([repository, ...Object.entries(repositories).filter(([id]) => patternRowOf(id) === undefined).map(([, name]) => name)].map(lower))
  }
  /** Lets go of repositories that the default instance or an explicit row names now, or that their row's pattern no longer matches. */
  prune(): void {
    const taken = this.taken()
    for (const [row, pattern] of this.all()) {
      const members = this.members(row)
      const kept = Object.fromEntries(Object.entries(members).filter(([, name]) => !taken.has(lower(name)) && matchesPattern(pattern, name)))
      if (Object.keys(kept).length !== Object.keys(members).length) this.save(row, kept)
    }
  }
  /**
   * Takes each repository of `inbox` that no instance has into the first enabled row whose pattern matches it, unless the last listing
   * showed the account cannot cover it. Its cursor starts where the inbox read started, so the notification that brought it in is read.
   * @returns whether a repository was taken in.
   */
  take(inbox: Inbox): boolean {
    const deployment = this.ctx.deployment
    const known = new Set([deployment.repository, ...Object.values(deployment.repositories ?? {})].map(lower))
    const added = new Map<string, Record<string, string>>()
    for (const { repository: { full_name: name } } of inbox.notifications) {
      if (known.has(lower(name))) continue
      const listed = this.listing?.get(lower(name))
      if (listed && !coverable(listed)) continue
      const row = this.enabled().find(([, pattern]) => matchesPattern(pattern, name))?.[0]
      if (row === undefined) continue
      known.add(lower(name))
      const id = memberId(row, name)
      this.ctx.state.set(ownKey(id, KV.github.since), inbox.since)
      added.set(row, { ...added.get(row), [id]: name })
    }
    for (const [row, members] of added) this.save(row, { ...this.members(row), ...members })
    return added.size > 0
  }
  /**
   * Lists the account's repositories once `every` has passed since the last listing (none while no enabled row exists), then gives each
   * enabled row the repositories it covers: a repository keeps the row that has it while that row still matches, a new one goes to the
   * first row that matches, and one the account can no longer push to, archived, gone or no longer matching is let go, its watch with
   * it when the agent started that watch.
   * @returns whether it listed.
   */
  async list(commands: Commands, now = Date.now()): Promise<boolean> {
    const rows = this.enabled()
    if (!rows.length) return false
    const last = this.ctx.state.get(KV.github.listed)
    if (last !== undefined && now - Date.parse(last) < this.every) return false
    // The attempt counts, so a failing listing waits the interval too; mentions still bring repositories in meanwhile.
    this.ctx.state.set(KV.github.listed, new Date(now).toISOString())
    let repositories: Listed[]
    try { repositories = await commands.accountRepositories(ListedSchema) }
    catch (error) { this.problem = `listing the account's repositories failed: ${String(error)}`; throw error }
    this.problem = undefined
    this.listing = new Map(repositories.map(repository => [lower(repository.full_name), repository]))
    const taken = this.taken()
    const holder = new Map(rows.flatMap(([row]) => Object.values(this.members(row)).map(name => [lower(name), row] as const)))
    const next = new Map(rows.map(([row]) => [row, {} as Record<string, string>]))
    for (const repository of repositories) {
      const name = repository.full_name
      if (!coverable(repository) || taken.has(lower(name))) continue
      const matching = rows.filter(([, pattern]) => matchesPattern(pattern, name)).map(([row]) => row)
      const row = matching.find(row => row === holder.get(lower(name))) ?? matching[0]
      if (row !== undefined) next.get(row)![memberId(row, name)] = name
    }
    for (const [row, members] of next) {
      for (const [id, name] of Object.entries(this.members(row))) if (!(id in members)) await this.release(commands, id, name)
      this.save(row, members)
    }
    return true
  }
  /** Stops the watch the agent started on a repository a row lets go of; a repository it lost access to may refuse, which is fine. */
  private async release(commands: Commands, id: string, repository: string): Promise<void> {
    const watching = ownKey(id, KV.github.watching)
    if (this.ctx.state.get(watching)?.by === 'agent') {
      await commands.forRepository(repository).api(SUBSCRIPTION, '-X', 'DELETE').catch(() => { /* access may be gone already */ })
    }
    this.ctx.state.set(watching, undefined)
    this.readings.delete(id)
  }
  /** The health entry a covered repository's instance reports to: its reading is kept, and `report` sets its row's from all of them. */
  recorder(id: string): HealthEntry {
    return { get: () => this.readings.get(id), set: value => { this.readings.set(id, value) }, release: () => { this.readings.delete(id) } }
  }
  /** Sets each pattern row's health from the readings of the repositories it covers now. */
  report(): void {
    for (const [row] of this.all()) {
      const entry = this.rowHealth(row)
      if (!entry) continue
      if (!this.ctx.config(row)) { entry.set(health('paused', 'sourceOff')); continue }
      const covered = Object.entries(this.ctx.deployment.repositories ?? {}).filter(([id]) => patternRowOf(id) === row)
      const readings = covered.flatMap(([id, name]) => { const value = this.readings.get(id); return value ? [{ name, value }] : [] })
      const at = readings.map(({ value }) => value.at ?? '').sort().at(-1) || new Date().toISOString()
      const failing = readings.filter(({ value }) => value.state === 'error')
      const names = covered.map(([, name]) => name).sort((a, b) => a.localeCompare(b))
      const listed = names.slice(0, NAMED).join(', ') + (names.length > NAMED ? ` and ${names.length - NAMED} more` : '')
      const problem = this.problem ? `; ${this.problem}` : ''
      if (failing.length) {
        const [first] = failing
        entry.set({ state: 'error', detail: `${failing.length} of ${names.length} repositories failing; ${first!.name}: ${first!.value.detail}${problem}`, at })
      } else if (!names.length) {
        entry.set({ state: 'ready', detail: `No repository matches yet; a new one joins on its next mention or the next listing${problem}`, at })
      } else entry.set({ state: 'ready', detail: `${names.length} ${names.length === 1 ? 'repository' : 'repositories'}: ${listed}${problem}`, at })
    }
  }
}
