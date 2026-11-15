/**
 * The realtime contract's event sources (docs/panel-realtime.md): health changes reach the live feed once per real change, removed
 * settings and prompts are writes like any other, and an Assignment's steps carry the Assignment they concern.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { HealthBoard, sameHealth } from '../src/infra/health.ts'
import { LiveHub, stageOf } from '../src/app/live.ts'
import { Store } from '../src/app/store.ts'

it('tells its listeners when a health reading really changes, not when only its time does, and when an entry goes', () => {
  const board = new HealthBoard()
  const seen: [string, string | undefined][] = []
  board.onChange((name, health) => seen.push([name, health?.state]))
  const github = board.claim('github', { state: 'starting', detail: '' })
  github.set({ state: 'ready', detail: 'polling', at: '2026-11-15T01:00:00Z' })
  github.set({ state: 'ready', detail: 'polling', at: '2026-11-15T01:00:05Z' })
  github.set({ state: 'error', detail: 'gh: 502', at: '2026-11-15T01:00:10Z' })
  github.release()
  github.set({ state: 'ready', detail: 'polling' })
  expect(seen).toEqual([['github', 'ready'], ['github', 'error'], ['github', undefined]])
  expect(sameHealth({ state: 'ready', detail: 'a', values: { n: '1' } }, { state: 'ready', detail: 'a', values: { n: '2' } })).toBe(false)
})

it('emits one health event per burst of changes, naming every entry that changed', async () => {
  const hub = new LiveHub()
  const board = new HealthBoard()
  board.onChange(name => hub.health(name))
  const models = board.claim('models'), worker = board.claim('worker')
  models.set({ state: 'error', detail: 'no adapter' }); worker.set({ state: 'ready', detail: '' }); models.set({ state: 'ready', detail: '' })
  expect(hub.last()).toBe(0)
  await Promise.resolve()
  expect(hub.recent().map(event => [event.topic, event.data])).toEqual([['health', { entries: ['models', 'worker'] }]])
  worker.set({ state: 'ready', detail: '' })
  await Promise.resolve()
  expect(hub.last()).toBe(1)
})

it('reports a removed setting or prompt to the live feed like a written one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-delete-')); const store = new Store(join(dir, 'db'))
  try {
    const seen: string[][] = []
    store.set('prompt-revision' as never, 1); store.set('settings-history' as never, [])
    await Promise.resolve()
    store.onChange(topics => seen.push([...topics].sort()))
    store.delete('prompt-revision'); store.delete('settings-history')
    await Promise.resolve()
    expect(seen).toEqual([['prompts', 'settings']])
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('keeps the Assignment an executor step concerns, so the console can place it on its slot', () => {
  const at = '2026-11-15T01:00:00Z'
  expect(stageOf({ type: 'assignment.started', at, data: { ticketId: 't1', assignmentId: 'a7' } }))
    .toEqual({ type: 'assignment.started', node: 'executor', at, ticketId: 't1', assignmentId: 'a7' })
  expect(stageOf({ type: 'assignment.ended', at, data: { ticketId: 't1', assignmentId: 'a7', reason: 'done' } }))
    .toEqual({ type: 'assignment.ended', node: 'executor', at, ticketId: 't1', assignmentId: 'a7', detail: 'done' })
})
