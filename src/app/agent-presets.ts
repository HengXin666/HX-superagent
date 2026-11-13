/** The agent presets the main Session and the Executor Sessions may run under, and which role may take which. */
import { DEFAULT_ROUTER_PRESET as ROUTER_PRESET, DEFAULT_WORKER_PRESET as WORKER_PRESET } from '../policy.ts'

/** One agent preset of DSH's registry as the panel offers it, and whether each role may run under it. */
export interface AgentPresetView {
  id: string; name: string; description: string; builtin: boolean
  compatible: { worker: boolean; orchestrator: boolean }
  /** Why a role may not run under it, or what changes when it does. */
  notes: { worker?: string; orchestrator?: string }
}
/** The part of DSH's preset registry read here; each method is optional, as registry versions differ. */
export interface PresetRegistry {
  select(agent: object, preset: string): Promise<string>
  presetForSession?(session: object): string | null
  list?(): Iterable<unknown>
  values?(): Iterable<unknown>
  get?(id: string): unknown
}
function presetRow(value: unknown): { id: string; name: string; description: string } | undefined {
  const row = (value ?? {}) as { id?: unknown; name?: unknown; description?: unknown; config?: { id?: unknown; name?: unknown; description?: unknown } }
  const source = typeof row.config?.id === 'string' ? row.config : row
  if (typeof source.id !== 'string' || !source.id) return undefined
  return { id: source.id, name: typeof source.name === 'string' && source.name ? source.name : source.id,
    description: typeof source.description === 'string' ? source.description : '' }
}
/** The presets DSH's registry holds, with the bundle's two always listed, as the registry may not enumerate. */
export function listAgentPresets(registry: Partial<PresetRegistry> | undefined): AgentPresetView[] {
  const rows = new Map<string, { id: string; name: string; description: string }>()
  try {
    const source = registry?.list?.() ?? registry?.values?.() ?? []
    for (const value of source) { const row = presetRow(value); if (row) rows.set(row.id, row) }
  } catch { /* an unreadable registry offers only the bundle's presets */ }
  for (const id of [WORKER_PRESET, ROUTER_PRESET, 'standard']) if (!rows.has(id)) rows.set(id, { id, name: id, description: '' })
  return [...rows.values()].map(row => ({ ...row, ...presetCompatibility(row.id) }))
}
/**
 * Whether each role may run under preset `id`. Every preset is allowed: a worker's tools are always cut down to the work tools
 * it has (`WORK_TOOLS`), and a main Session under any preset but the bundle's router keeps the stricter wait guard (`noWait`
 * with `routed` false), which asks each command for a timeout. A worker under the router preset could not edit files, so it is
 * refused for workers, and the worker preset is refused for the main Session, whose shell would not route.
 */
export function presetCompatibility(id: string): Pick<AgentPresetView, 'builtin' | 'compatible' | 'notes'> {
  const builtin = id === WORKER_PRESET || id === ROUTER_PRESET
  const notes: AgentPresetView['notes'] = {}
  if (id === ROUTER_PRESET) notes.worker = 'presetNoWrite'
  if (id === WORKER_PRESET) notes.orchestrator = 'presetWorkerOnly'
  if (!builtin) { notes.worker = 'presetToolsCut'; notes.orchestrator = 'presetStrictWait' }
  return { builtin, compatible: { worker: id !== ROUTER_PRESET, orchestrator: id !== WORKER_PRESET }, notes }
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** DSH's agent preset registry selected `agentPreset` for a Session. */
    'agent-preset/selected'(sessionId: string, agentPreset: string): void
  }
}
