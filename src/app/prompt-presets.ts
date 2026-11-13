/**
 * Prompt presets: named patches of the prompt configuration a team turns on together, in order, on top of its own sections. The
 * bundle ships some (`builtin`, read-only); a team saves its own in the Store under one revision. A preset's team-section text
 * is added after the team's own text (`append`) or takes its place (`replace`); its skills and part overrides take the place of
 * the same names. Turning presets on and their order are part of the prompt configuration (`PromptConfig.presets`), so they
 * are versioned with it.
 */
import { z } from 'zod'
import { UserError } from '../core/index.ts'
import hark from '../../examples/hark-secretary.prompts.json' with { type: 'json' }
import { KV } from '../kv.ts'
import type { Store } from './store.ts'

export const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
export const PRESET_SECTIONS = ['communication', 'scope', 'delivery'] as const
const PresetIdSchema = z.string().regex(PRESET_ID)
/** What a preset changes: team sections, skills by name and built-in parts by key. */
export const PromptPresetPatchSchema = z.object({
  communication: z.string().optional(), scope: z.string().optional(), delivery: z.string().optional(),
  skills: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.string()).optional(),
  overrides: z.record(z.string(), z.object({ text: z.string() }).passthrough()).optional(),
}).strict()
export type PromptPresetPatch = z.infer<typeof PromptPresetPatchSchema>
export const PromptPresetSchema = z.object({
  id: PresetIdSchema, name: z.string().trim().min(1).max(80), description: z.string().max(400).default(''),
  mode: z.enum(['append', 'replace']).default('append'), patch: PromptPresetPatchSchema,
}).strict()
export type PromptPreset = z.infer<typeof PromptPresetSchema> & { builtin?: true }
/** A preset as the panel lists it: what it changes, by section name as the editor names it (`skill/x`, `part/y`). */
export interface PromptPresetView extends PromptPreset { touches: string[]; chars: number }

/** Presets the bundle ships, read-only; a team may copy one and edit the copy. */
export const BUILTIN_PRESETS: readonly PromptPreset[] = [
  { id: 'hark-secretary', name: 'Hark secretary', builtin: true, mode: 'replace',
    description: 'Deliver in the source conversation; interrupt a person only for a ready result, a decision or a blocker.',
    patch: PromptPresetPatchSchema.parse({ communication: hark.communication, scope: hark.scope, delivery: hark.delivery,
      skills: hark.skills, overrides: Object.fromEntries(Object.entries(hark.overrides ?? {}).map(([part, value]) => [part,
        { text: (value as { text: string }).text }])) }) },
]

/** The sections a preset touches, as the editor names them. */
export const presetTouches = (patch: PromptPresetPatch): string[] => [
  ...PRESET_SECTIONS.filter(name => patch[name] !== undefined && patch[name] !== ''),
  ...Object.keys(patch.skills ?? {}).map(name => `skill/${name}`), ...Object.keys(patch.overrides ?? {}).map(key => `part/${key}`)]
export const presetView = (preset: PromptPreset): PromptPresetView => ({ ...preset, touches: presetTouches(preset.patch),
  chars: JSON.stringify(preset.patch).length })

interface Config { communication: string; scope: string; delivery: string; skills: Record<string, string>
  overrides?: Record<string, { text: string; base?: string | undefined }> | undefined }
/**
 * Apply `presets` to `config` in order and return the configuration the agents read, with, for each section a preset wrote,
 * the presets that wrote it, in order. A part a preset overrides takes the base the team's override recorded, if any.
 */
export function applyPresets<C extends Config>(config: C, presets: readonly PromptPreset[]): { config: C; sources: Record<string, string[]> } {
  const sources: Record<string, string[]> = {}
  const mark = (name: string, id: string) => { (sources[name] ??= []).push(id) }
  let result: C = { ...config, skills: { ...config.skills }, ...config.overrides ? { overrides: { ...config.overrides } } : {} }
  for (const preset of presets) {
    const { patch } = preset
    for (const name of PRESET_SECTIONS) {
      const text = patch[name]
      if (text === undefined || text === '') continue
      const own = result[name]
      result = { ...result, [name]: preset.mode === 'replace' || !own.trim() ? text : `${own}\n\n${text}` }
      if (preset.mode === 'replace') sources[name] = []
      mark(name, preset.id)
    }
    for (const [name, text] of Object.entries(patch.skills ?? {})) { result.skills[name] = text; mark(`skill/${name}`, preset.id) }
    for (const [part, { text }] of Object.entries(patch.overrides ?? {})) {
      result = { ...result, overrides: { ...result.overrides, [part]: { ...result.overrides?.[part], text } } }
      mark(`part/${part}`, preset.id)
    }
  }
  return { config: result, sources }
}

interface Stored { revision: number; presets: PromptPreset[] }
/**
 * Indicates a save of the team's presets against a revision another save already replaced; the panel reloads and saves again.
 */
export class PresetConflict extends Error {}
/** The bundle's presets and the team's own, which it saves as one list against its revision. */
export class PromptPresets {
  constructor(private readonly store: Pick<Store, 'get' | 'set'>, private readonly inUse: () => readonly string[] = () => []) {}
  private stored(): Stored { return this.store.get(KV.prompts.presets) ?? { revision: 0, presets: [] } }
  revision(): number { return this.stored().revision }
  /** Every preset, the bundle's first. */
  list(): PromptPreset[] { return [...BUILTIN_PRESETS, ...this.stored().presets] }
  get(id: string): PromptPreset | undefined { return this.list().find(preset => preset.id === id) }
  /** Resolve preset ids in order; an id no preset has is refused. */
  resolve(ids: readonly string[]): PromptPreset[] {
    return ids.map(id => { const preset = this.get(id); if (!preset) throw new UserError('unknownPromptPreset', { preset: id }); return preset })
  }
  view() { return { revision: this.revision(), presets: this.list().map(presetView) } }
  /**
   * Replace the team's presets against `revision`. An id must be unique and not one of the bundle's, and a preset the prompt
   * configuration turns on cannot go.
   */
  save(value: unknown, revision: number): { revision: number } {
    const presets = z.array(PromptPresetSchema).max(64).parse(value)
    const ids = presets.map(preset => preset.id)
    const taken = ids.find((id, index) => ids.indexOf(id) !== index || BUILTIN_PRESETS.some(preset => preset.id === id))
    if (taken) throw new UserError('promptPresetTaken', { preset: taken })
    const missing = this.inUse().filter(id => !ids.includes(id) && !BUILTIN_PRESETS.some(preset => preset.id === id))
    if (missing.length) throw new UserError('promptPresetInUse', { presets: missing.join(', ') })
    const current = this.stored()
    if (current.revision !== revision) throw new PresetConflict(`Prompt presets changed to revision ${current.revision}; reload before saving`)
    const next = { revision: current.revision + 1, presets }
    this.store.set(KV.prompts.presets, next)
    return { revision: next.revision }
  }
}
