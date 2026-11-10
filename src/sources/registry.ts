/** Registry of installed Source kinds, their configured instances, and the Engine's SourceScope implementation. */
import type { ChannelRef, OutboundMessage, ScopeResult, SourceScope, Trigger } from '../core/index.ts'
import type { Commands } from '../infra/commands.ts'
import { HealthBoard, type HealthEntry } from '../infra/health.ts'
import { AdmissionTableSchema, type Settings } from '../policy.ts'
import type { ChannelLink, ChannelLinks, SourceInstance, SourceKind, TriggerContext, VariableSpec } from './kind.ts'

/** The number of an extra instance ID such as `github-2`, ordering instances by creation. */
const extraNumber = (id: string): number => Number(/-(\d+)$/.exec(id)?.[1] ?? 0)


/**
 * Manages registered SourceKind plugins, validates their instance and policy configurations, and implements SourceScope for the Engine.
 * Claims each registered kind's health entries on HealthBoard and mediates access to source channels, links, environment variables, and thread context readers for Runtime, Settings, Outbox, and MasterAssessor.
 */
export class SourceRegistry implements SourceScope {
  private readonly kinds = new Map<string, SourceKind>()
  private readonly health = new Map<string, HealthEntry>()
  /** Health entries claimed for extra instances, by kind, released with the kind's registration. */
  private readonly extraHealth = new Map<string, Set<string>>()
  constructor(private readonly settings: () => Settings, private readonly board: Pick<HealthBoard, 'claim'> = new HealthBoard(),
    private readonly registered: (kind: SourceKind) => () => void = () => () => {}) {}

  /** Registers a SourceKind, claims its health entries on HealthBoard (rejecting `sync:` prefixes owned by Settings), and returns an unregister disposer. */
  register<C extends Record<string, unknown>>(kind: SourceKind<C>): () => void {
    if (this.kinds.has(kind.kind)) throw new Error(`Source kind already registered: ${kind.kind}`)
    const refused = (name: string) => new Error(`Source kind ${kind.kind} declares the health entry ${name}, which another part reports`)
    const synced = kind.health.find(name => name.startsWith('sync:'))
    if (synced) throw refused(synced)
    const entries = new Map<string, HealthEntry>()
    const release = () => {
      for (const [name, entry] of entries) { entry.release(); this.health.delete(name) }
      for (const name of this.extraHealth.get(kind.kind) ?? []) { this.health.get(name)?.release(); this.health.delete(name) }
      this.extraHealth.delete(kind.kind)
    }
    for (const name of kind.health) {
      try { entries.set(name, this.board.claim(name, { state: 'starting', detail: '' })) }
      catch { release(); throw refused(name) }
    }
    for (const [name, entry] of entries) this.health.set(name, entry)
    this.kinds.set(kind.kind, kind as unknown as SourceKind)
    this.extraHealth.set(kind.kind, new Set())
    const unregistered = this.registered(kind as unknown as SourceKind)
    return () => { this.kinds.delete(kind.kind); release(); unregistered() }
  }
  /**
   * Returns the active health entries for `names`. A Source context writes through the entries it received when built,
   * so reports sent after that registration ended do nothing even if the kind registers again.
   */
  healthEntries(names: readonly string[]): Map<string, HealthEntry> {
    return new Map(names.flatMap(name => { const entry = this.health.get(name); return entry ? [[name, entry] as const] : [] }))
  }
  /** The kind of Source instance `id`: the kind of that ID, or for an extra instance (such as `github-2`) the kind it was stored with. */
  kind(id: string, settings = this.settings()): SourceKind | undefined {
    const own = this.kinds.get(id)
    if (own) return own
    const stored = settings.sources[id]?.kind
    const kind = stored === undefined ? undefined : this.kinds.get(stored)
    return kind?.multiple ? kind : undefined
  }
  /** IDs of the installed kinds that take extra instances, in ID order. */
  multipleKinds(): string[] { return [...this.kinds.values()].filter(kind => kind.multiple).map(kind => kind.kind).sort() }
  /** IDs of the instances of `kind`: the default instance first, then its extra instances in creation order (`<kind>-<n>`). */
  instancesOf(kind: string, settings = this.settings()): string[] {
    const extra = Object.entries(settings.sources).filter(([id, stored]) => id !== kind && stored.kind === kind && this.kinds.get(kind)?.multiple)
      .map(([id]) => id).sort((a, b) => extraNumber(a) - extraNumber(b) || a.localeCompare(b))
    return this.kinds.has(kind) ? [kind, ...extra] : extra
  }
  /**
   * Every registered kind's default instance ordered by ID, each followed by its extra instances, then stored instances whose kind
   * is not installed (with their config kept as stored).
   */
  instances(settings = this.settings()): (SourceInstance & { installed: boolean })[] {
    const installed = [...this.kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind))
      .flatMap(kind => this.instancesOf(kind.kind, settings).map(id => ({ ...this.resolve(kind, settings.sources[id], id), installed: true })))
    const orphaned = Object.entries(settings.sources).filter(([id]) => !this.kind(id, settings))
      .map(([id, stored]) => ({ id, kind: stored.kind ?? id, enabled: stored.enabled, config: stored.config, installed: false }))
    return [...installed, ...orphaned]
  }
  instance<C extends Record<string, unknown>>(id: string, settings = this.settings()): SourceInstance<C> | undefined {
    const kind = this.kind(id, settings)
    return kind ? this.resolve(kind, settings.sources[id], id) as SourceInstance<C> : undefined
  }
  validate(id: string, value: { enabled: boolean; config: unknown }): { enabled: boolean; config: Record<string, unknown>; kind?: string } {
    const kind = this.kind(id)
    if (!kind) throw new Error(`Source kind not installed: ${id}`)
    return { enabled: value.enabled, config: kind.schema.parse(value.config), ...id === kind.kind ? {} : { kind: kind.kind } }
  }
  /**
   * The display name of instance `id`: the kind's title, followed for an instance of a multi-instance kind by its label (such as
   * the repository), which tells the instances apart.
   */
  title(id: string, settings = this.settings()): { zh: string; en: string } {
    const kind = this.kind(id, settings)
    if (!kind) return { zh: id, en: id }
    const instance = this.resolve(kind, settings.sources[id], id)
    const label = kind.multiple && instance.config ? kind.multiple.label(instance.config) : ''
    return label ? { zh: `${kind.title.zh} · ${label}`, en: `${kind.title.en} · ${label}` } : kind.title
  }
  /** Health entry names of instance `id`: the kind's own for the default instance, `<entry>@<id>` for an extra instance. */
  healthNames(id: string, settings = this.settings()): string[] {
    const kind = this.kind(id, settings)
    if (!kind) return []
    return id === kind.kind ? [...kind.health] : kind.health.map(name => `${name}@${id}`)
  }
  /**
   * Claims (once) and returns the health entries of extra instance `id`; the default instance's entries were claimed with its kind.
   * They are released with the kind's registration.
   */
  instanceHealth(id: string): Map<string, HealthEntry> {
    const kind = this.kind(id)
    if (!kind) return new Map()
    if (id === kind.kind) return this.healthEntries(kind.health)
    for (const name of this.healthNames(id)) {
      if (this.health.has(name)) continue
      const entry = this.board.claim(name, { state: 'starting', detail: '' })
      this.health.set(name, entry)
      this.extraHealth.get(kind.kind)?.add(name)
    }
    return this.healthEntries(this.healthNames(id))
  }
  /** Validates each Source's part of a submitted Policy against its kind; policy parts for uninstalled Source kinds are kept as stored. */
  validatePolicy(parts: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown> & { allowed: { id: string; name?: string }[] }> {
    return Object.fromEntries(Object.entries(parts).map(([id, part]) => {
      const policy = this.kind(id)?.policy
      // `admission` is validated by the Policy's own schema (shared across all kinds), while the kind validates the rest of its part.
      const { admission, ...rest } = part
      return [id, policy ? { ...policy.schema.parse(rest), admission: AdmissionTableSchema.parse(admission ?? {}) } : part as Record<string, unknown> & { allowed: { id: string; name?: string }[] }]
    }))
  }
  policyPart(id: string, settings = this.settings()) {
    const policy = this.kind(id, settings)?.policy
    if (!policy) return undefined
    const { admission, ...rest } = settings.policy.sources[id] ?? {}
    const parsed = policy.schema.safeParse(rest)
    return { ...parsed.success ? parsed.data : policy.schema.parse({}), admission: AdmissionTableSchema.safeParse(admission ?? {}).data ?? {} }
  }
  channelAllowed(channel: { source: string; address: Record<string, string> }, settings = this.settings()): boolean {
    const kind = this.kind(channel.source, settings)
    if (!kind) return false
    const instance = this.resolve(kind, settings.sources[channel.source], channel.source)
    return instance.enabled && (kind.channel?.allowed?.(channel.address, instance.config) ?? true)
  }
  /** Environment variable declarations for every installed kind, whether enabled or disabled. */
  declarations(): { kind: string; variables: readonly VariableSpec[] }[] {
    return [...this.kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind)).flatMap(kind => kind.environment ? [{ kind: kind.kind, variables: kind.environment.variables }] : [])
  }
  environments(settings = this.settings()) {
    return [...this.kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind)).flatMap(kind => {
      const instance = this.resolve(kind, settings.sources[kind.kind], kind.kind)
      return kind.environment && instance.enabled ? [{ kind, environment: kind.environment, config: instance.config }] : []
    })
  }
  /**
   * Sends a message idempotently through its Channel's kind; returns `'waiting'` while the kind is not installed, or
   * `'gone'` when the target (or a kind without channels) can never receive it.
   */
  async send(message: OutboundMessage, commands: Commands): Promise<'sent' | 'gone' | 'waiting'> {
    const kind = this.kind(message.channel.source)
    if (!kind) return 'waiting'
    return kind.channel ? kind.channel.send({ commands }, message) : 'gone'
  }
  link(channel: ChannelRef, links: ChannelLinks): ChannelLink {
    const repository = links.repositories?.[channel.source]
    const link = this.kind(channel.source)?.channel?.link(channel.address, repository ? { ...links, repository } : links)
    return link ?? { url: '', label: { zh: channel.source, en: channel.source } }
  }
  /** A multi-instance kind's Thread keys name its default instance (`github:12`) and stand for the same key on each of its instances. */
  find(query: string): { threads: string[]; terms: string[] } {
    const expand = (kind: SourceKind, keys: string[]) => !kind.multiple ? keys : keys.flatMap(key => key.startsWith(`${kind.kind}:`)
      ? this.instancesOf(kind.kind).map(id => `${id}${key.slice(kind.kind.length)}`) : [key])
    const found = [...this.kinds.values()].flatMap(kind => kind.find ? [(found => ({ ...found, threads: expand(kind, found.threads) }))(kind.find(query))] : [])
    return { threads: [...new Set(found.flatMap(item => item.threads))], terms: [...new Set(found.flatMap(item => item.terms))] }
  }
  repliesTo(trigger: Trigger): string | undefined { return this.kind(trigger.source)?.repliesTo?.(trigger) }
  threadContext(trigger: Trigger, settings = this.settings()): TriggerContext | undefined {
    const kind = this.kind(trigger.source, settings)
    const context = kind?.threadContext
    if (!kind || !context) return undefined
    const { config } = this.resolve(kind, settings.sources[trigger.source], trigger.source)
    return {
      messageId: context.messageId(trigger),
      read: (commands, part, cursor) => context.read(commands, trigger, part, cursor, config),
      images: text => context.images?.(text) ?? [],
      image: async (agent, commands, message, key, stateDir, signal) => {
        if (!context.image) throw new Error(`The ${kind.kind} Source has no images`)
        return context.image(agent, commands, trigger, message, key, stateDir, signal)
      },
    }
  }
  scope(input: { source: string; meta: Record<string, unknown> }, settings = this.settings()): ScopeResult {
    const kind = this.kind(input.source, settings)
    const stored = settings.sources[input.source]
    // Without its kind plugin the stored scope cannot be evaluated, so a configured Source whose plugin is missing listens to nothing.
    if (!kind) return stored ? { listened: false, reason: 'source_not_installed' } : { listened: true, observed: false }
    const instance = this.resolve(kind, stored, input.source)
    if (!instance.enabled) return { listened: false, reason: 'source_disabled' }
    return kind.scope ? kind.scope({ meta: input.meta }, instance.config) : { listened: true, observed: false }
  }
  /** Falls back to schema defaults and disables the instance when stored configuration fails validation. */
  private resolve(kind: SourceKind, stored: { enabled: boolean; config: Record<string, unknown> } | undefined, id = kind.kind): SourceInstance {
    const parsed = kind.schema.safeParse(stored?.config ?? {})
    return { id, kind: kind.kind, enabled: parsed.success && (stored?.enabled ?? true), config: parsed.success ? parsed.data : kind.schema.parse({}) }
  }
}
