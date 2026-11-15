/** Capability packs: several per role, in order, over its agent preset. */
import { describe, expect, it } from 'vitest'
import { AgentOverlaySchema, AgentOverlays, BUILTIN_OVERLAYS, ROLE_TOOLS, effectiveRole, overlayPrompt, type AgentOverlay } from '../src/app/agent-overlays.ts'
import { EvalConfigSchema, ExecutorConfigSchema } from '../src/policy.ts'

const memory = () => { const values = new Map<string, unknown>()
  return { get: (key: string) => values.get(key) as never, set: (key: string, value: unknown) => { values.set(key, value) } } }
const own = (patch: Partial<AgentOverlay>): AgentOverlay => ({ id: 'mine', name: 'Mine', description: '', roles: ['worker'], deny: [], allow: [],
  instructions: '', ...patch })

describe('effective tools', () => {
  it('takes tools away in order and says which pack took each', () => {
    const library = [...BUILTIN_OVERLAYS, own({ id: 'quiet', deny: ['web_search', 'todo_write'] })]
    const effective = effectiveRole('worker', ['no-web', 'quiet'], library)
    expect(effective.tools).not.toContain('web_search')
    expect(effective.tools).not.toContain('todo_write')
    expect(effective.removed).toEqual(expect.arrayContaining([{ tool: 'web_search', by: ['no-web', 'quiet'] }, { tool: 'todo_write', by: ['quiet'] }]))
    expect(effective.problems).toEqual([])
    expect(effective.instructions.map(item => item.id)).toEqual(['no-web'])
    expect(overlayPrompt(effective)).toContain('## Capability packs')
  })
  it('grants tools beyond the role\'s own in order, and a later pack takes a granted tool back', () => {
    const library = [...BUILTIN_OVERLAYS, own({ id: 'jira', allow: ['mcp__jira__search', 'mcp__jira__create'] }),
      own({ id: 'read-only-jira', deny: ['mcp__jira__create'] }), own({ id: 'web-again', allow: ['web_search'] })]
    const effective = effectiveRole('worker', ['jira', 'read-only-jira'], library)
    expect(effective.tools).toContain('mcp__jira__search')
    expect(effective.tools).not.toContain('mcp__jira__create')
    expect(effective.added).toEqual([{ tool: 'mcp__jira__search', by: ['jira'] }])
    expect(effective.problems).toEqual([])
    // A role's own tool a pack took away comes back with a later pack that grants it, and is not counted as added.
    const back = effectiveRole('worker', ['no-web', 'web-again'], library)
    expect(back.tools).toContain('web_search')
    expect(back.removed.map(item => item.tool)).not.toContain('web_search')
    expect(back.added).toEqual([])
  })
  it('keeps the role as it is with no packs', () => {
    expect(effectiveRole('orchestrator', [], BUILTIN_OVERLAYS).tools).toEqual([...ROLE_TOOLS.orchestrator])
    expect(overlayPrompt(effectiveRole('orchestrator', [], BUILTIN_OVERLAYS))).toBe('')
  })
  it('refuses a set the role cannot work under', () => {
    const library = [...BUILTIN_OVERLAYS, own({ id: 'nowrite', deny: ['write', 'edit'] }), own({ id: 'noshell', roles: ['orchestrator'], deny: ['bash'] })]
    expect(effectiveRole('worker', ['nowrite'], library).problems[0]?.key).toBe('overlayNoWrite')
    expect(effectiveRole('orchestrator', ['noshell'], library).problems[0]?.key).toBe('overlayRequired')
    expect(effectiveRole('orchestrator', ['no-web'], library).problems[0]?.key).toBe('overlayRole')
    expect(effectiveRole('worker', ['gone'], library).problems[0]?.key).toBe('unknownOverlay')
  })
})

describe('library', () => {
  it('saves the team\'s packs against a revision, refusing a taken id and a pack in use', () => {
    let used = { worker: [] as string[], orchestrator: [] as string[] }
    const packs = new AgentOverlays(memory(), () => used)
    expect(packs.save([own({})], 0)).toEqual({ revision: 1 })
    expect(packs.list().map(item => item.id)).toContain('mine')
    expect(() => packs.save([own({})], 0)).toThrow(/revision 1/)
    expect(() => packs.save([own({ id: 'no-web' })], 1)).toThrow(/taken/)
    used = { worker: ['mine'], orchestrator: [] }
    expect(() => packs.save([], 1)).toThrow(/turn them off/)
    expect(() => packs.save([own({ deny: ['write', 'edit'] })], 1)).toThrow(/write or edit/)
    expect(() => packs.check('worker', ['mine', 'no-web'])).not.toThrow()
  })
  it('defaults each role to no packs, so stored settings need no migration', () => {
    expect(EvalConfigSchema.parse({}).overlays).toEqual([])
    expect(ExecutorConfigSchema.parse({ overlays: ['no-web', 'careful-review'] }).overlays).toEqual(['no-web', 'careful-review'])
    expect(() => ExecutorConfigSchema.parse({ overlays: ['no-web', 'no-web'] })).toThrow()
  })
})

describe('a preset that names a base', () => {
  const library = [...BUILTIN_OVERLAYS,
    { id: 'base-a', name: 'A', description: '', roles: ['worker', 'orchestrator'], deny: [], allow: [], instructions: '', base: 'standard' },
    { id: 'base-b', name: 'B', description: '', roles: ['worker'], deny: [], allow: [], instructions: '', base: 'reviewer' },
    { id: 'router', name: 'R', description: '', roles: ['worker'], deny: [], allow: [], instructions: '', base: 'dsh-superagent-router' },
  ] as AgentOverlay[]
  it('puts the role on the base of the last preset in the chain that names one', () => {
    expect(effectiveRole('worker', ['base-a', 'no-web', 'base-b'], library).base).toEqual({ id: 'reviewer', by: 'base-b' })
    expect(effectiveRole('worker', ['no-web'], library).base).toBeUndefined()
  })
  it('refuses a base the role cannot run under', () => {
    expect(effectiveRole('worker', ['router'], library).problems[0]?.key).toBe('overlayBase')
  })
  it('keeps a base through a save of the library', () => {
    expect(AgentOverlaySchema.parse({ id: 'x', name: 'X', base: 'standard' }).base).toBe('standard')
    expect(() => AgentOverlaySchema.parse({ id: 'x', name: 'X', base: 'bad id' })).toThrow()
  })
})
