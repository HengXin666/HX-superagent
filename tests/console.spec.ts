/** The console's snapshot: the Executor slots, what each Session runs as its events say, with secrets masked, and the rates. */
import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host | undefined
afterEach(async () => { await h?.stop(); h = undefined })

it('reads what the main Session runs from its events, masking a secret, and counts Store writes by topic', async () => {
  h = await startRuntime()
  const { runtime, ctx } = h
  ctx.emit('session/event', { id: runtime.masterId } as never, { type: 'assistant/message', data: { message: { content: [
    { type: 'tool-call', id: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'gh pr list --token ghp_abcdefghijklmnop1234' }) }] } } } as never)
  ctx.emit('session/event', { id: 'someone-else' } as never, { type: 'turn/start', data: {} } as never)
  const executor = runtime.store.settings().executor
  await runtime.settings.save('executor', { ...executor, maxWorkers: 4 }, runtime.store.blockRevision('executor'), 'panel')
  await new Promise(resolve => setTimeout(resolve, 0))
  const { status, body } = await h.api('GET', 'console/snapshot')
  expect(status).toBe(200)
  expect(body).toMatchObject({ load: { maxWorkers: 4, running: 0 }, workers: [], queue: [],
    main: { sessionId: runtime.masterId, preset: 'dsh-superagent-router',
      activity: { role: 'orchestrator', kind: 'tool', tool: 'bash', summary: 'gh pr list --token ***' } } })
  const events = (body.events as { topic: string }[]).map(event => event.topic)
  expect(events).toContain('activity'); expect(events).toContain('settings')
  // Only dsh-superagent's own Sessions are watched.
  expect((body.events as { data?: { sessionId?: string } }[]).some(event => event.data?.sessionId === 'someone-else')).toBe(false)
  expect((body.rates as unknown[]).length).toBe(60)
})
