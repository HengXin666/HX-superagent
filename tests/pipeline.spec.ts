/** The dispatch pipeline the panel draws: every settings block and every prompt part reaches at least one step. */
import { expect, it } from 'vitest'
import { builtInParts } from '../src/app/prompts.ts'
import { BLOCK_NODES, EDGES, PIPELINE, STEPS, groupNodes, lineAt, promptNodes } from '../src/client/pipeline.ts'
import { SETTINGS_GROUPS } from '../src/client/route.ts'

it('maps every built-in prompt part to the steps of the roles that read it, and a team section to both Sessions', () => {
  for (const [key, part] of Object.entries(builtInParts())) {
    const nodes = promptNodes(`part/${key}`, part.roles)
    expect(nodes.length, key).toBeGreaterThan(0)
    expect(nodes).toEqual([...part.roles.includes('orchestrator') ? ['main'] : [], ...part.roles.includes('worker') ? ['executor'] : []])
  }
  expect(promptNodes('communication')).toEqual(['main', 'executor'])
})

it('opens a settings group from every step but deployment\'s, and names a step for every block the panel marks', () => {
  expect(SETTINGS_GROUPS.filter(group => group !== 'prompts' && group !== 'deployment' && !groupNodes(group).length)).toEqual([])
  for (const nodes of Object.values(BLOCK_NODES)) expect(nodes.every(node => PIPELINE.includes(node))).toBe(true)
  expect(Object.values(STEPS).map(step => step.id)).toEqual([...PIPELINE])
  expect(EDGES.every(edge => PIPELINE.includes(edge.from) && PIPELINE.includes(edge.to))).toBe(true)
  expect(lineAt('a\nb\nc', 3)).toBe(2)
})
