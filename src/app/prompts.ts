/** Manages versioned role prompts, behavioral policies, and operational skills independently of access settings. */
import { z } from 'zod'
import { UserError, key } from '../core/index.ts'
import { policyVersion, type Settings, type SettingsOrigin } from '../policy.ts'
import { masterPrompt, workerPrompt, sharedPrompt, guides, mainAdmissionPolicy, handoffPolicy, teamDefaults, sourceSkills, cliNotes } from './context.ts'
import { environmentLines, type Variable } from './execution-environment.ts'
import { promptsNotice } from './notices.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'
import { Versions } from './versions.ts'
import { PRESET_ID, PromptPresets, applyPresets, type PromptPreset } from './prompt-presets.ts'
import { KV } from '../kv.ts'

/** Prompt sections the team writes; the built-in parts follow dsh-superagent's text until the team overrides them. */
export const TEAM_SECTIONS = ['communication', 'scope', 'delivery'] as const
export type TeamSection = typeof TEAM_SECTIONS[number]
/** Markdown headings for each team section; fixed prompt sections refer to them by these exact names. */
const TEAM_HEADINGS: Record<TeamSection, string> = { communication: 'Communication', scope: 'Ticket scope', delivery: 'Delivery requirements' }
export const SKILL_NAME = /^[a-z][a-z0-9-]*$/
/** Prefix prepended to skill names when registering them in DSH Sessions. */
export const SKILL_PREFIX = 'dsh-superagent-'
const SkillNameSchema = z.string().regex(SKILL_NAME).refine(name => !(Object.keys(sourceSkills) as string[]).includes(name),
  'This name belongs to a built-in skill')
/** The built-in parts a team may override, by key: both roles' parts, the Source skills, and the generated parts' templates. */
const PART_KEYS = ['runtime/shared', 'runtime/orchestrator', 'runtime/worker', 'runtime/subscriptions', 'runtime/replies',
  'runtime/dispatch', 'runtime/work', 'runtime/admission', 'runtime/handoff/orchestrator', 'runtime/handoff/worker', 'runtime/environment',
  'runtime/policy', 'runtime/policy/none', 'skill/feishu', 'skill/github', 'skill/hxrouter'] as const
export type PartKey = typeof PART_KEYS[number]
/** A team's text for a built-in part, and `base`, the key of the built-in text it was edited from. */
const OverrideSchema = z.object({ text: z.string(),
  base: z.string().optional().describe('Key of the built-in text it was edited from; copy as read, or omit.') }).strict()
/**
 * A configuration, whose overrides may name a part a later version no longer has, which `Prompts.validate` drops when the
 * saved version holds it and refuses otherwise.
 */
export const PromptConfigSchema = z.object({ communication: z.string(), scope: z.string(), delivery: z.string(),
  skills: z.record(SkillNameSchema, z.string()), overrides: z.record(z.string(), OverrideSchema).optional()
    .describe('Text in place of a built-in part, by its key in prompts/defaults; a part not named follows its built-in text.'),
  presets: z.array(z.string().regex(PRESET_ID)).max(16).optional()
    .describe('Prompt presets turned on, applied in this order on top of the sections above; see prompt-presets.') }).strict()
export type PromptConfig = z.infer<typeof PromptConfigSchema>
export interface PromptVersion { revision: number; previousRevision: number | null; savedAt: string; source: string; config: PromptConfig;
  /** Original unmigrated config preserved when differences cannot be compared across schema versions. */
  legacy?: { config: unknown } }
export const defaultPrompts = (): PromptConfig => ({ ...teamDefaults, skills: {} })

const ENVIRONMENT_HEADING = 'Execution environment (from this installation\'s settings; it takes precedence over any repository or account named elsewhere in these instructions; an empty value means that part is not configured here). The prepare command of a ticket directory reads the same variables:'
const POLICY_HEAD = '## Policy\nPolicy version {version}; accept mode {mode}. The accept mode and the rules decide proactive candidates only: an explicit request is routed as dispatch says, in any mode and whatever the rules.'
type Role = 'orchestrator' | 'worker'
/** A built-in part a team may override: the roles that read it, its text, and the placeholders a template's override keeps. */
interface BuiltInPart { roles: readonly Role[]; text: string; placeholders?: readonly string[] }
const BOTH: readonly Role[] = ['orchestrator', 'worker'], MAIN: readonly Role[] = ['orchestrator'], WORKER: readonly Role[] = ['worker']
let parts: Readonly<Record<PartKey, BuiltInPart>> | undefined
/**
 * The built-in parts of both roles' prompts, the two Source skills, and the templates of the generated parts, whose data the
 * system fills in, by the key an override names them by. Built on first use, as the texts it reads are imported in a cycle.
 */
export const builtInParts = (): Readonly<Record<PartKey, BuiltInPart>> => parts ??= {
  'runtime/shared': { roles: BOTH, text: sharedPrompt }, 'runtime/orchestrator': { roles: MAIN, text: masterPrompt },
  'runtime/worker': { roles: WORKER, text: workerPrompt },
  'runtime/subscriptions': { roles: BOTH, text: `## subscriptions\n${guides.subscriptions}` },
  'runtime/replies': { roles: BOTH, text: `## replies\n${guides.replies}` },
  'runtime/dispatch': { roles: MAIN, text: `## dispatch\n${guides.dispatch}` }, 'runtime/work': { roles: WORKER, text: `## work\n${guides.work}` },
  'runtime/admission': { roles: MAIN, text: mainAdmissionPolicy },
  'runtime/handoff/orchestrator': { roles: MAIN, text: handoffPolicy('orchestrator') },
  'runtime/handoff/worker': { roles: WORKER, text: handoffPolicy('worker') },
  'runtime/environment': { roles: BOTH, text: `${ENVIRONMENT_HEADING}\n{variables}`, placeholders: ['{variables}'] },
  'runtime/policy': { roles: MAIN, text: `${POLICY_HEAD} The enabled rules, by name and id:\n{rules}`, placeholders: ['{version}', '{mode}', '{rules}'] },
  'runtime/policy/none': { roles: MAIN, text: `${POLICY_HEAD} No rule is enabled: a proactive candidate can only be ignored.`,
    placeholders: ['{version}', '{mode}'] },
  'skill/feishu': { roles: BOTH, text: `${sourceSkills.feishu}\n\n## CLI usage\n${cliNotes}` },
  'skill/github': { roles: BOTH, text: `${sourceSkills.github}\n\n## CLI usage\n${cliNotes}` },
  'skill/hxrouter': { roles: BOTH, text: sourceSkills.hxrouter },
}
/** The key of a built-in text, which an override's `base` records. */
export const builtInBase = (text: string): string => key('prompt-built-in', text)
/** The built-in part a key names, if any; a name an object's prototype has names none. */
export const builtInPart = (part: string): BuiltInPart | undefined =>
  Object.hasOwn(builtInParts(), part) ? builtInParts()[part as PartKey] : undefined
/** The text of a built-in part: the team's override, else the built-in one. */
const builtIn = (config: PromptConfig, part: PartKey): string =>
  (config.overrides && Object.hasOwn(config.overrides, part) ? config.overrides[part]!.text : undefined) ?? builtInParts()[part].text
/** Fill a template's placeholders in one pass, so text filled in is not read for placeholders again. */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? values[name]! : match)
/** The execution environment part: its template with the variables, or, while setup waits, that it waits. */
export function environmentSection(config: PromptConfig, variables: Variable[] | undefined): string {
  return variables ? fill(builtIn(config, 'runtime/environment'), { variables: environmentLines(variables) })
    : 'Execution environment: dsh-superagent is waiting for setup; the management panel names what is missing.'
}
/**
 * The main Session's Policy section: the Policy version and accept mode it judges proactive candidates by, and every enabled
 * rule, as the settings hold them, each on one line, so a line of an instruction reads as no rule or heading of its own; the
 * settings bound each instruction (`LIMITS.ruleInstruction`). `key` names the template it was filled from.
 */
export function policySection(settings: Settings, config: PromptConfig = defaultPrompts()): { key: string; text: string } {
  const line = (text: string) => text.replace(/\s*\n\s*/g, ' ')
  const rules = settings.policy.rules.filter(rule => rule.enabled).map(({ id, name, instruction }) => `- ${line(name)} (${id}): ${line(instruction)}`)
  const part = rules.length ? 'runtime/policy' : 'runtime/policy/none'
  return { key: part, text: fill(builtIn(config, part), { version: policyVersion(settings), mode: settings.eval.mode, rules: rules.join('\n') }) }
}
/**
 * Assemble a role's system prompt sections in order from fixed templates, team sections, the generated execution environment
 * and, last, the main Session's generated Policy section, which nothing follows, and whose change leaves the rest unchanged.
 */
export function promptParts(config: PromptConfig, role: Role, environment?: string, policy?: { key: string; text: string }) {
  // A built-in part names the key its text is overridden by, which for the handoff names the role.
  const fixed = (name: string, part = name) => ({ name, kind: 'fixed' as const, key: part, text: builtIn(config, part as PartKey) })
  const team = (name: TeamSection) => ({ name, kind: 'team' as const, heading: `## ${TEAM_HEADINGS[name]}`,
    text: config[name] ? `## ${TEAM_HEADINGS[name]}\n${config[name]}` : '' })
  return [
    fixed('runtime/shared'), fixed(`runtime/${role}`),
    ...TEAM_SECTIONS.map(team),
    ...['subscriptions', 'replies', role === 'orchestrator' ? 'dispatch' : 'work'].map(name => fixed(`runtime/${name}`)),
    ...role === 'orchestrator' ? [fixed('runtime/admission')] : [],
    fixed('runtime/handoff', `runtime/handoff/${role}`),
    ...environment ? [{ name: 'runtime/environment', kind: 'generated' as const, key: 'runtime/environment', text: environment }] : [],
    ...role === 'orchestrator' && policy ? [{ name: 'runtime/policy', kind: 'generated' as const, ...policy }] : [],
  ].filter(part => part.text)
}
export function composePrompt(config: PromptConfig, role: Role, environment?: string, policy?: { key: string; text: string }): string {
  return promptParts(config, role, environment, policy).map(part => part.text).join('\n\n')
}
export function composeSkill(config: PromptConfig, name: string): string {
  return name === 'feishu' || name === 'github' || name === 'hxrouter' ? builtIn(config, `skill/${name}`) : config.skills[name] ?? ''
}

/**
 * One layer of a role's final prompt as the assembly view draws it, in reading order: who wrote it (`origin`: built in, the
 * team, a prompt preset, a capability pack), `by` the preset or pack, `section` the editor's name for what it edits
 * (`communication`, `part/<key>`, `skill/<name>`), and the exact text it adds. The prompt's layers joined by a blank line are
 * the composed prompt; the packs' layers follow it; skills are registered beside it and read by name.
 */
export interface PromptLayer {
  id: string; group: 'prompt' | 'packs' | 'skills'; section: string
  origin: 'builtin' | 'team' | 'preset' | 'pack'; by?: string; generated?: true; chars: number; text: string
}
/**
 * The layers of `role`'s prompt from the team's own configuration and the presets it turns on, in order, so a section a preset
 * appends to splits into the team's text and each preset's; then the capability packs' instructions, then the skills.
 */
export function promptLayers(stored: PromptConfig, presets: readonly PromptPreset[], role: Role, environment?: string,
  policy?: { key: string; text: string }, packs: readonly { id: string; name: string; text: string }[] = [],
  skills: readonly [string, string][] = []): PromptLayer[] {
  const { config } = applyPresets(stored, presets)
  const layer = (value: Omit<PromptLayer, 'chars'>): PromptLayer => ({ ...value, chars: value.text.length })
  // The last preset that writes a part or a skill decides its text, else the team's own, else the built-in one.
  const writer = (find: (preset: PromptPreset) => boolean, team: boolean) => {
    const by = [...presets].reverse().find(find)
    return by ? { origin: 'preset' as const, by: by.id } : { origin: team ? 'team' as const : 'builtin' as const }
  }
  const layers: PromptLayer[] = []
  for (const part of promptParts(config, role, environment, policy)) {
    if (part.kind === 'team') {
      const name = part.name as TeamSection
      // The pieces of a team section, as `applyPresets` writes it: the team's text, then each preset's, joined by a blank line.
      let pieces: { origin: 'team' | 'preset'; by?: string; text: string }[] = stored[name] ? [{ origin: 'team', text: stored[name] }] : []
      for (const preset of presets) {
        const text = preset.patch[name]
        if (text === undefined || text === '') continue
        const piece = { origin: 'preset' as const, by: preset.id, text }
        pieces = preset.mode === 'replace' || !pieces.map(item => item.text).join('\n\n').trim() ? [piece] : [...pieces, piece]
      }
      pieces.forEach((piece, index) => layers.push(layer({ id: `${name}#${index}`, group: 'prompt',
        section: piece.origin === 'team' ? name : `preset:${piece.by!}:${name}`, origin: piece.origin, ...piece.by ? { by: piece.by } : {},
        text: index ? piece.text : `${part.heading}\n${piece.text}` })))
      continue
    }
    const key = part.key
    layers.push(layer({ id: key, group: 'prompt', section: `part/${key}`,
      ...writer(preset => !!preset.patch.overrides && Object.hasOwn(preset.patch.overrides, key), !!stored.overrides && Object.hasOwn(stored.overrides, key)),
      ...part.kind === 'generated' ? { generated: true as const } : {}, text: part.text }))
  }
  packs.forEach((pack, index) => layers.push(layer({ id: `pack:${pack.id}`, group: 'packs', section: `pack:${pack.id}`, origin: 'pack',
    by: pack.id, text: `${index ? '' : '## Capability packs\n\n'}### ${pack.name}\n${pack.text}` })))
  for (const [name, text] of skills) {
    const bundled = Object.hasOwn(sourceSkills, name)
    const who = bundled
      ? writer(preset => !!preset.patch.overrides && Object.hasOwn(preset.patch.overrides, `skill/${name}`), !!stored.overrides && Object.hasOwn(stored.overrides, `skill/${name}`))
      : writer(preset => !!preset.patch.skills && Object.hasOwn(preset.patch.skills, name), true)
    const section = who.origin === 'preset' ? `preset:${who.by}:skill/${name}` : bundled ? `part/skill/${name}` : `skill/${name}`
    layers.push(layer({ id: `skill:${name}`, group: 'skills', section, ...who, text }))
  }
  return layers
}

/** An override whose built-in text changed since its `base`, with that text when kept, or whose part this version no longer has. */
export interface DefaultChange { part: string; base?: string; previous?: string; removed?: true }
/**
 * Indicates an optimistic concurrency conflict when saving a prompt configuration against a stale base revision.
 * Thrown by `Prompts.save` and translated into an HTTP 409 response by the management routes.
 */
export class PromptConflict extends Error {}
/**
 * Stores numbered prompt configurations in `Store` via `Versions` and composes role system prompts and skills with the execution environment.
 * `Sessions` reads the composed prompts and skills for orchestrator and worker runs, while management routes and tools validate, preview, and save revisions through it.
 */
export class Prompts {
  private readonly versions: Versions<PromptVersion>
  /** The bundle's prompt presets and the team's own; the current configuration's are in use and cannot be removed. */
  readonly presets: PromptPresets
  constructor(private readonly store: Store, private readonly maxChars: () => number, private readonly environment: () => Variable[] | undefined,
    private readonly feishu: () => boolean, private readonly hxrouter: () => boolean = () => false) {
    this.versions = new Versions(store, KV.prompts.revision, KV.prompts.version)
    this.presets = new PromptPresets(store, () => this.current().config.presets ?? [])
  }
  /**
   * The configuration the agents read: `config` with its presets applied in order, and the presets that wrote each section. A
   * preset removed since a version was saved is skipped.
   */
  effective(config: PromptConfig): { config: PromptConfig; sources: Record<string, string[]> } {
    const presets = (config.presets ?? []).flatMap(id => this.presets.get(id) ?? []) as PromptPreset[]
    return presets.length ? applyPresets(config, presets) : { config, sources: {} }
  }
  /** A role's prompt; the main Session's Policy section follows the settings as they are now, at each model request. */
  compose(stored: PromptConfig, role: Role, variables = this.environment()): string {
    const config = this.effective(stored).config
    return composePrompt(config, role, environmentSection(config, variables), role === 'orchestrator' ? policySection(this.store.settings(), config) : undefined)
  }
  /**
   * Returns skills to register in every Session: built-in Source skills (`feishu` only when a Feishu bot is configured, `hxrouter`
   * only while the HX-Email Source is installed and on) followed by team skills.
   */
  skills(stored: PromptConfig): [string, string][] {
    const config = this.effective(stored).config
    return [...this.feishu() ? ['feishu'] : [], 'github', ...this.hxrouter() ? ['hxrouter'] : [], ...Object.keys(config.skills)].map(name => [name, composeSkill(config, name)])
  }
  current(): PromptVersion {
    const revision = this.versions.revision()
    return revision ? this.version(revision) : { revision: 0, previousRevision: null, savedAt: '', source: 'defaults', config: defaultPrompts() }
  }
  /** Reads a revision by number; revision 0 resolves to built-in defaults before the first save persists it. */
  version(revision: number): PromptVersion {
    const version = this.versions.get(revision) ?? (revision === 0 && this.versions.revision() === 0 ? this.current() : undefined)
    if (!version) throw new UserError('unknownPromptRevision', { revision: String(revision) })
    return version
  }
  /**
   * Parse a configuration: an override names a built-in part, holds text and keeps its template's placeholders, and records the
   * built-in text it was edited from: the saved override's unless it names one, else the current one. It goes once its text is
   * the built-in text again, and so does one of a part this version no longer has, which the saved version holds.
   */
  validate(value: unknown): PromptConfig {
    const { overrides, presets, ...config } = PromptConfigSchema.parse(value)
    if (presets) this.presets.resolve(presets)
    const saved = this.current().config.overrides ?? {}
    const kept = Object.entries(overrides ?? {}).flatMap(([name, override]) => {
      const part = builtInPart(name)
      if (!part && Object.hasOwn(saved, name)) return []
      if (!part) throw new UserError('unknownPromptPart', { part: name })
      if (!override.text.trim()) throw new UserError('promptPartEmpty', { part: name })
      const missing = (part.placeholders ?? []).filter(placeholder => !override.text.includes(placeholder))
      if (missing.length) throw new UserError('promptPlaceholders', { part: name, placeholders: missing.join(', ') })
      const base = override.base ?? (Object.hasOwn(saved, name) ? saved[name]!.base : undefined) ?? builtInBase(part.text)
      return override.text === part.text ? [] : [[name, { text: override.text, base }] as const]
    })
    const result: PromptConfig = { ...config, ...kept.length ? { overrides: Object.fromEntries(kept) } : {},
      ...presets?.length ? { presets: [...new Set(presets)] } : {} }
    const limit = this.maxChars()
    if (JSON.stringify(result).length > limit) throw new UserError('promptTooLong', { limit: String(limit) })
    return result
  }
  /**
   * The overrides of `config` whose built-in part changed since the team edited it, by the `base` they were edited from, each
   * with the built-in text of that base when this installation kept it, and those of a part this version no longer has.
   */
  defaultChanged(config: PromptConfig): DefaultChange[] {
    return Object.entries(config.overrides ?? {}).flatMap(([part, { base }]): DefaultChange[] => {
      const now = builtInPart(part)
      if (!now) return [{ part, ...base === undefined ? {} : { base }, removed: true as const }]
      if (base === undefined || base === builtInBase(now.text)) return []
      const previous = this.store.get(KV.prompts.builtIn(base))
      return [{ part, base, ...previous === undefined ? {} : { previous } }]
    })
  }
  /**
   * Compose a draft as each role would read it, with its parts, its skills and, for the assembly view, its layers; `packs` are
   * the capability packs' instructions each role's Sessions add after the prompt.
   */
  preview(value: unknown, packs: Partial<Record<Role, readonly { id: string; name: string; text: string }[]>> = {}) {
    const stored = this.validate(value)
    const { config, sources } = this.effective(stored)
    const presets = (stored.presets ?? []).flatMap(id => this.presets.get(id) ?? [])
    const environment = environmentSection(config, this.environment()), policy = policySection(this.store.settings(), config)
    const skills = this.skills({ ...config, presets: [] })
    return { orchestrator: composePrompt(config, 'orchestrator', environment, policy), worker: composePrompt(config, 'worker', environment),
      parts: { orchestrator: promptParts(config, 'orchestrator', environment, policy), worker: promptParts(config, 'worker', environment) },
      skills: Object.fromEntries(skills), presetSources: sources,
      layers: { orchestrator: promptLayers(stored, presets, 'orchestrator', environment, policy, packs.orchestrator, skills),
        worker: promptLayers(stored, presets, 'worker', environment, undefined, packs.worker, skills) }, scope: 'Team sections, skills, and overrides of built-in parts, which follow their built-in text until overridden. Workers additionally inherit the host prompt and repository AGENTS.md. Prompt text changes what the agents are told, not what dsh-superagent allows: tool permissions, the gate and account wrappers stay.' }
  }
  save(value: unknown, baseRevision: number, source: SettingsOrigin): PromptVersion {
    const config = this.validate(value)
    return this.store.atomic(() => {
      const previous = this.current()
      if (previous.revision !== baseRevision) throw new PromptConflict(`Prompt version changed to ${previous.revision}; compare the latest version before saving`)
      // Persist the built-in defaults as revision 0 before recording the first custom revision.
      if (previous.revision === 0 && !this.versions.get(0)) this.versions.keep(previous)
      // The built-in text each override was edited from, kept to show what an upgrade changed in it.
      for (const [part, { base }] of Object.entries(config.overrides ?? {})) {
        const text = builtInParts()[part as PartKey].text
        if (base === builtInBase(text) && this.store.get(KV.prompts.builtIn(base)) === undefined) this.store.set(KV.prompts.builtIn(base), text)
      }
      return this.versions.save(revision => ({ revision, previousRevision: previous.revision, savedAt: new Date().toISOString(), source, config }))
    })
  }
  history(offset = 0, limit = 20) {
    const current = this.current()
    const revisions = Array.from({ length: Math.min(limit, Math.max(0, current.revision + 1 - offset)) }, (_, i) => {
      const version = current.revision - offset - i === 0 && current.revision === 0 ? current : this.version(current.revision - offset - i)
      const { config, ...summary } = version
      const previous = version.previousRevision === null ? undefined : this.versions.get(version.previousRevision)?.config
      // Pre-team-section revisions are not comparable field-by-field.
      const legacy = version.legacy || (version.previousRevision !== null && this.versions.get(version.previousRevision)?.legacy)
      if (legacy) return { ...summary, changed: ['legacy'] }
      const entries = (value: PromptConfig) => ({ communication: value.communication, scope: value.scope, delivery: value.delivery,
        ...Object.fromEntries(Object.entries(value.skills).map(([name, text]) => ['skill/' + name, text])),
        // An override changes with its text or with the built-in text it was edited from.
        ...Object.fromEntries(Object.entries(value.overrides ?? {}).map(([part, override]) => [part, JSON.stringify(override)])),
        ...value.presets?.length ? { presets: value.presets.join(',') } : {} })
      const before = previous ? entries(previous) : {}
      const after = entries(config)
      const changed = previous ? [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => (before as Record<string, string>)[name] !== (after as Record<string, string>)[name]) : []
      return { ...summary, changed }
    })
    return { revisions, next_offset: offset + revisions.length <= current.revision ? offset + revisions.length : null }
  }
}
/** Save a new prompt revision and notify the main Session when the change originated outside its own tool call. */
export async function savePrompts(host: { store: Pick<Store, 'atomic'>; prompts: Pick<Prompts, 'save'>; sessions: Pick<Sessions, 'notify' | 'delivery'> },
  config: unknown, baseRevision: number, origin: SettingsOrigin) {
  const version = host.store.atomic(() => {
    const saved = host.prompts.save(config, baseRevision, origin)
    if (origin !== 'tool') host.sessions.notify(...promptsNotice(saved.revision))
    return saved
  })
  return { revision: version.revision, effect: 'next-request' as const, context_delivery: await host.sessions.delivery('prompts') }
}
