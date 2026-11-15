/**
 * Agent capability packs: named, team-defined layers a role's Sessions run under on top of its agent preset. A pack takes tools
 * away (`deny`) and adds standing instructions; each role turns several on at once, in order (`eval.overlays`,
 * `executor.overlays`). Unlike an agent preset, which DSH registers from the profile, a pack lives in the Store, so a person
 * writes their own in the panel. The bundle ships a few read-only packs; a team may copy one and edit the copy.
 */
import { z } from 'zod'
import { UserError } from '../core/index.ts'
import { KV } from '../kv.ts'
import { DEFAULT_ROUTER_PRESET, DEFAULT_WORKER_PRESET } from '../policy.ts'
import type { Store } from './store.ts'

export type OverlayRole = 'worker' | 'orchestrator'
export const OVERLAY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const ToolName = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/)
export const AgentOverlaySchema = z.object({
  id: z.string().regex(OVERLAY_ID), name: z.string().trim().min(1).max(80), description: z.string().max(400).default(''),
  /** The roles a pack may be turned on for. */
  roles: z.array(z.enum(['worker', 'orchestrator'])).min(1).max(2).default(['worker', 'orchestrator']),
  /** Tools the role's Sessions lose; a name the role does not have is ignored. */
  deny: z.array(ToolName).max(64).default([]),
  /**
   * Tools the role's Sessions gain beyond the role's own: any tool DSH has registered for the profile (an MCP server's tools, a
   * plugin's), by name. A Session gets a granted tool only where DSH knows it; a name DSH does not know is reported, not invented.
   */
  allow: z.array(ToolName).max(64).default([]),
  /** Instructions added to the role's prompt after the team's own, under the pack's name. */
  instructions: z.string().max(8000).default(''),
  /**
   * The DSH agent preset (the role's base) a pack puts its Sessions on, by id as DSH's registry names it. The last turned-on
   * pack that names a base decides it; with none, the role keeps the base its settings name. DSH registers bases from the
   * profile, so a pack cannot invent one: it picks among the registry's, or names one another profile plugin registers.
   */
  base: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/).optional(),
}).strict()
export type AgentOverlay = z.infer<typeof AgentOverlaySchema> & { builtin?: true }

/** The tools each role has before any pack: what `Sessions` restricts a main Session and an Executor Session to. */
export const ROLE_TOOLS: Readonly<Record<OverlayRole, readonly string[]>> = {
  orchestrator: ['skill', 'bash', 'read', 'read_image', 'job_output', 'job_list', 'job_kill'],
  worker: ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill', 'web_search',
    'web_fetch', 'skill', 'todo_write', 'subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'],
}
/** Tools a role cannot work without: a pack set that takes one away is refused for that role. */
export const REQUIRED_TOOLS: Readonly<Record<OverlayRole, readonly string[]>> = {
  orchestrator: ['bash', 'read'],
  worker: ['read', 'bash'],
}
/** Whether `role` may run on base `id`: the same rule the base picker applies (`presetCompatibility`). */
export const baseAllowed = (role: OverlayRole, id: string): boolean =>
  role === 'worker' ? id !== DEFAULT_ROUTER_PRESET : id !== DEFAULT_WORKER_PRESET
/** A worker must keep one way to change files. */
const WORKER_WRITES = ['write', 'edit']

export const BUILTIN_OVERLAYS: readonly AgentOverlay[] = [
  { id: 'no-web', name: '离线 / No web', builtin: true, roles: ['worker'], allow: [], deny: ['web_search', 'web_fetch'],
    description: 'The Executor works from the repository alone: no web search or fetch.',
    instructions: 'You have no web access in this Session. Work from the repository, its history and the ticket; say so when an answer needs the web.' },
  { id: 'no-subagents', name: '不派子 Agent / No subagents', builtin: true, roles: ['worker'], allow: [],
    deny: ['subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'],
    description: 'The Executor does the work itself, without starting or messaging other agents.', instructions: '' },
  { id: 'careful-review', name: '谨慎改动 / Careful changes', builtin: true, roles: ['worker'], allow: [], deny: [],
    description: 'Smaller diffs, tests first, and a summary of risk in every report.',
    instructions: 'Keep each change as small as the task allows. Run the relevant tests before and after the change, and end every report with the risks a reviewer should check.' },
  { id: 'terse-replies', name: '简洁回复 / Terse replies', builtin: true, roles: ['orchestrator', 'worker'], allow: [], deny: [],
    description: 'Replies in the source conversation stay short: the result first, at most five lines.',
    instructions: 'When you reply in the source conversation, lead with the result and keep it to at most five lines unless asked for detail.' },
]

/** What a role runs with once its packs are applied in order. */
export interface EffectiveRole {
  role: OverlayRole; overlays: string[]
  /** The base the packs put the role on, and the pack that decided it; absent when no pack names one. */
  base?: { id: string; by: string } | undefined
  /** Tools the role keeps, and those the packs took away, each with the packs that took it. */
  tools: string[]; removed: { tool: string; by: string[] }[]
  /** Tools the packs added beyond the role's own, each with the packs that added it; a later pack's deny takes it back. */
  added: { tool: string; by: string[] }[]
  instructions: { id: string; name: string; text: string }[]
  /** Why the set cannot be saved for this role, as `UserError` keys with their values; empty when it can. */
  problems: { key: 'overlayRole' | 'overlayRequired' | 'overlayNoWrite' | 'unknownOverlay' | 'overlayBase'; values: Record<string, string> }[]
}

/** Apply `overlays`, by id, to `role` in order, against the `library` of packs. */
export function effectiveRole(role: OverlayRole, ids: readonly string[], library: readonly AgentOverlay[]): EffectiveRole {
  const problems: EffectiveRole['problems'] = []
  const removedBy = new Map<string, string[]>(), addedBy = new Map<string, string[]>()
  const instructions: EffectiveRole['instructions'] = []
  // Packs apply in order: each takes its denied tools away and adds its granted ones, so a later pack decides a tool both name.
  const tools = new Set(ROLE_TOOLS[role])
  let base: EffectiveRole['base']
  for (const id of ids) {
    const overlay = library.find(item => item.id === id)
    if (!overlay) { problems.push({ key: 'unknownOverlay', values: { overlay: id } }); continue }
    if (!overlay.roles.includes(role)) problems.push({ key: 'overlayRole', values: { overlay: overlay.name, role } })
    for (const tool of overlay.deny) {
      // Every pack that takes a role's own tool away is named, even when an earlier one already took it.
      if (ROLE_TOOLS[role].includes(tool)) { tools.delete(tool); removedBy.set(tool, [...removedBy.get(tool) ?? [], overlay.id]) }
      else if (tools.delete(tool)) addedBy.delete(tool)
    }
    for (const tool of overlay.allow ?? []) {
      if (ROLE_TOOLS[role].includes(tool)) { if (!tools.has(tool)) { tools.add(tool); removedBy.delete(tool) } continue }
      tools.add(tool); addedBy.set(tool, [...addedBy.get(tool) ?? [], overlay.id])
    }
    if (overlay.instructions.trim()) instructions.push({ id: overlay.id, name: overlay.name, text: overlay.instructions.trim() })
    if (overlay.base) base = { id: overlay.base, by: overlay.id }
  }
  // The router base cannot write files for an Executor, and the worker base does not route the main Session's waits.
  if (base && !baseAllowed(role, base.id)) problems.push({ key: 'overlayBase', values: { overlay: base.by, base: base.id, role } })
  for (const tool of REQUIRED_TOOLS[role]) if (!tools.has(tool)) problems.push({ key: 'overlayRequired', values: { tool, role } })
  if (role === 'worker' && !WORKER_WRITES.some(tool => tools.has(tool))) problems.push({ key: 'overlayNoWrite', values: { role } })
  const own = ROLE_TOOLS[role].filter(tool => tools.has(tool))
  return { role, overlays: [...ids], ...base ? { base } : {}, tools: [...own, ...[...tools].filter(tool => !ROLE_TOOLS[role].includes(tool))],
    removed: [...removedBy].map(([tool, by]) => ({ tool, by })), added: [...addedBy].map(([tool, by]) => ({ tool, by })), instructions, problems }
}

/** The instructions section a role's packs add to its prompt, or empty. */
export function overlayPrompt(effective: Pick<EffectiveRole, 'instructions'>): string {
  if (!effective.instructions.length) return ''
  return ['## Capability packs', ...effective.instructions.map(item => `### ${item.name}\n${item.text}`)].join('\n\n')
}

/** A pack as the panel lists it, with what it touches. */
export interface AgentOverlayView extends AgentOverlay { chars: number }
export const overlayView = (overlay: AgentOverlay): AgentOverlayView => ({ ...overlay, chars: overlay.instructions.length })

/** A save of the team's packs against a revision another save already replaced; the panel reloads and saves again. */
export class OverlayConflict extends Error {}
interface Stored { revision: number; overlays: AgentOverlay[] }

/** The bundle's packs and the team's own, which it saves as one list against its revision. */
export class AgentOverlays {
  constructor(private readonly store: Pick<Store, 'get' | 'set'>,
    private readonly inUse: () => Record<OverlayRole, readonly string[]> = () => ({ worker: [], orchestrator: [] })) {}
  private stored(): Stored { return this.store.get(KV.agents.overlays) ?? { revision: 0, overlays: [] } }
  revision(): number { return this.stored().revision }
  list(): AgentOverlay[] { return [...BUILTIN_OVERLAYS, ...this.stored().overlays] }
  view() { return { revision: this.revision(), overlays: this.list().map(overlayView), roleTools: ROLE_TOOLS, required: REQUIRED_TOOLS } }
  effective(role: OverlayRole, ids: readonly string[]): EffectiveRole { return effectiveRole(role, ids, this.list()) }
  /** Refuse a set of packs `role` cannot run under. */
  check(role: OverlayRole, ids: readonly string[]): void {
    const problem = this.effective(role, ids).problems[0]
    if (problem) throw new UserError(problem.key, problem.values)
  }
  /** Replace the team's packs against `revision`; ids are unique and not the bundle's, and a pack a role uses cannot go. */
  save(value: unknown, revision: number): { revision: number } {
    const overlays = z.array(AgentOverlaySchema).max(64).parse(value)
    const ids = overlays.map(overlay => overlay.id)
    const taken = ids.find((id, index) => ids.indexOf(id) !== index || BUILTIN_OVERLAYS.some(overlay => overlay.id === id))
    if (taken) throw new UserError('overlayTaken', { overlay: taken })
    const used = this.inUse()
    const missing = [...new Set([...used.worker, ...used.orchestrator])]
      .filter(id => !ids.includes(id) && !BUILTIN_OVERLAYS.some(overlay => overlay.id === id))
    if (missing.length) throw new UserError('overlayInUse', { overlays: missing.join(', ') })
    const library = [...BUILTIN_OVERLAYS, ...overlays]
    for (const role of ['worker', 'orchestrator'] as const) {
      const problem = effectiveRole(role, used[role], library).problems[0]
      if (problem) throw new UserError(problem.key, problem.values)
    }
    const current = this.stored()
    if (current.revision !== revision) throw new OverlayConflict(`Capability packs changed to revision ${current.revision}; reload before saving`)
    const next = { revision: current.revision + 1, overlays }
    this.store.set(KV.agents.overlays, next)
    return { revision: next.revision }
  }
}
