/** Which agent presets the panel offers each role, read from DSH's preset registry. */
import { expect, it } from 'vitest'
import { listAgentPresets, presetCompatibility } from '../src/app/agent-presets.ts'
import { EvalConfigSchema, ExecutorConfigSchema } from '../src/policy.ts'

it('defaults each role to the bundle\'s own preset, so stored settings need no migration', () => {
  expect(ExecutorConfigSchema.parse({}).agentPreset).toBe('dsh-superagent-worker')
  expect(EvalConfigSchema.parse({}).agentPreset).toBe('dsh-superagent-router')
  expect(() => ExecutorConfigSchema.parse({ agentPreset: 'two words' })).toThrow()
})

it('lists the registry\'s presets with the bundle\'s, and marks which role may take each', () => {
  const rows = listAgentPresets({ list: () => [{ config: { id: 'team-reviewer', name: 'Reviewer', description: 'Reads only' } }, { bogus: true }] })
  expect(rows.map(row => row.id)).toEqual(['team-reviewer', 'dsh-superagent-worker', 'dsh-superagent-router', 'standard'])
  expect(rows[0]).toMatchObject({ name: 'Reviewer', builtin: false, compatible: { worker: true, orchestrator: true },
    notes: { worker: 'presetToolsCut', orchestrator: 'presetStrictWait' } })
  expect(presetCompatibility('dsh-superagent-router').compatible).toEqual({ worker: false, orchestrator: true })
  expect(presetCompatibility('dsh-superagent-worker').compatible).toEqual({ worker: true, orchestrator: false })
})

it('offers the bundle\'s presets when the registry cannot list', () => {
  expect(listAgentPresets(undefined).map(row => row.id)).toEqual(['dsh-superagent-worker', 'dsh-superagent-router', 'standard'])
  expect(listAgentPresets({ list: () => { throw new Error('no') } })).toHaveLength(3)
})
