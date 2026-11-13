/** Prompt presets: applying several in order, the team's own saved against a revision, and the configuration turning them on. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { Prompts, defaultPrompts } from '../src/app/prompts.ts'
import { BUILTIN_PRESETS, PresetConflict, applyPresets, presetTouches, type PromptPreset } from '../src/app/prompt-presets.ts'
import { UserError } from '../src/core/index.ts'

function withPrompts(body: (prompts: Prompts) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-presets-')); const store = new Store(join(dir, 'db'))
  try { body(new Prompts(store, () => 100000, () => [], () => true)) } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
}
const preset = (id: string, patch: PromptPreset['patch'], mode: PromptPreset['mode'] = 'append'): PromptPreset =>
  ({ id, name: id, description: '', mode, patch })

it('applies presets in order: appending adds to a section, replacing takes it over, and the later preset wins a skill or a part', () => {
  const base = { ...defaultPrompts(), scope: 'Team scope.', skills: { release: 'Team release.' } }
  const { config, sources } = applyPresets(base, [
    preset('a', { scope: 'A scope.', skills: { release: 'A release.' }, overrides: { 'runtime/work': { text: 'A work.' } } }),
    preset('b', { scope: 'B scope.', communication: 'B talk.' }, 'replace'),
    preset('c', { scope: 'C scope.', overrides: { 'runtime/work': { text: 'C work.' } } }),
  ])
  expect(config.scope).toBe('B scope.\n\nC scope.')
  expect(config.communication).toBe('B talk.')
  expect(config.skills.release).toBe('A release.')
  expect(config.overrides?.['runtime/work']?.text).toBe('C work.')
  expect(sources).toMatchObject({ scope: ['b', 'c'], communication: ['b'], 'skill/release': ['a'], 'part/runtime/work': ['a', 'c'] })
  // The team's configuration is left as it was.
  expect(base.scope).toBe('Team scope.')
  expect(presetTouches({ scope: 'x', delivery: '', skills: { s: 'y' } })).toEqual(['scope', 'skill/s'])
})

it('composes the prompts the agents read with the presets the configuration turns on, and refuses one that does not exist', () => withPrompts(prompts => {
  prompts.presets.save([preset('reviewer', { delivery: 'Ask Dave to review.' })], 0)
  const saved = prompts.save({ ...defaultPrompts(), presets: ['reviewer', 'reviewer'] }, 0, 'panel')
  expect(saved.config.presets).toEqual(['reviewer'])
  expect(prompts.compose(saved.config, 'worker')).toContain('Ask Dave to review.')
  expect(prompts.preview(saved.config).presetSources).toEqual({ delivery: ['reviewer'] })
  expect(() => prompts.validate({ ...defaultPrompts(), presets: ['missing'] })).toThrow(UserError)
  // A built-in preset can be turned on as any other.
  expect(prompts.compose({ ...defaultPrompts(), presets: [BUILTIN_PRESETS[0]!.id] }, 'orchestrator'))
    .toContain(BUILTIN_PRESETS[0]!.patch.communication!.slice(0, 40))
}))

it('saves the team\'s presets against their revision, refusing a taken id or the removal of one the configuration turns on', () => withPrompts(prompts => {
  expect(prompts.presets.save([preset('one', { scope: 'x' })], 0)).toEqual({ revision: 1 })
  expect(() => prompts.presets.save([], 0)).toThrow(PresetConflict)
  expect(() => prompts.presets.save([preset('hark-secretary', {})], 1)).toThrow(expect.objectContaining({ code: 'promptPresetTaken' }))
  expect(() => prompts.presets.save([preset('a', {}), preset('a', {})], 1)).toThrow(expect.objectContaining({ code: 'promptPresetTaken' }))
  prompts.save({ ...defaultPrompts(), presets: ['one'] }, 0, 'panel')
  expect(() => prompts.presets.save([], 1)).toThrow(expect.objectContaining({ code: 'promptPresetInUse' }))
  expect(prompts.presets.view().presets.map(item => item.id)).toEqual(['hark-secretary', 'one'])
  expect(prompts.history().revisions[0]!.changed).toEqual(['presets'])
}))
