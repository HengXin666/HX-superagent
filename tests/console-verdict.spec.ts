/** The console's one-line verdict: what blocks the dispatch, what waits for a person and what runs, worst first. */
import { expect, it } from 'vitest'
import { verdictOf } from '../src/client/console.tsx'

const base = { paused: false, load: { running: 0, maxWorkers: 2, queued: 0 }, waiting: [], outbox: { pending: 0 }, health: [], queue: [] }
const keys = (data: Partial<typeof base> & Record<string, unknown>) => verdictOf({ ...base, ...data } as never).map(item => item.key)

it('says all clear when nothing runs, waits or fails', () => {
  expect(keys({})).toEqual(['consoleVerdict.idle'])
})

it('names a full set of slots with a queue, a Source that is down and Tickets waiting for a person, worst first', () => {
  expect(keys({ load: { running: 2, maxWorkers: 2, queued: 3 }, waiting: [{}] as never, health: [{ name: 'github', state: 'error', detail: '' }] as never }))
    .toEqual(['consoleVerdict.down', 'consoleVerdict.full', 'consoleVerdict.person', 'consoleVerdict.running'])
})

it('does not call the slots full while processing is paused, and reports the pause first', () => {
  const items = verdictOf({ ...base, paused: true, load: { running: 2, maxWorkers: 2, queued: 1 } } as never)
  expect(items.map(item => item.key)).toEqual(['consoleVerdict.paused', 'consoleVerdict.running'])
  expect(items[0]!.tone).toBe('warning')
})

it('puts a Source that is down ahead of a pause, so the strip takes the worst tone', () => {
  const items = verdictOf({ ...base, paused: true, load: { running: 1, maxWorkers: 2, queued: 4 }, outbox: { pending: 2 },
    health: [{ name: 'feishu', state: 'error', detail: '' }] } as never)
  expect(items.map(item => item.key)).toEqual(['consoleVerdict.down', 'consoleVerdict.paused', 'consoleVerdict.outbox', 'consoleVerdict.running'])
  expect(items.map(item => item.tone)).toEqual(['error', 'warning', 'warning', 'ongoing'])
})
