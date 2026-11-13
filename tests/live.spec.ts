/** The live feed: numbering and resuming, redaction, the topics Store writes report, and its server-sent event stream. */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LiveHub, summarize, toolSummary } from '../src/app/live.ts'
import { streamEvents } from '../src/app/http.ts'
import { Store } from '../src/app/store.ts'

it('numbers events, resumes after the last one read, and asks for a reload once that one is gone', () => {
  const hub = new LiveHub()
  for (let index = 0; index < 1005; index++) hub.emit('ticket')
  expect(hub.last()).toBe(1005)
  expect(hub.since(1003)!.map(event => event.seq)).toEqual([1004, 1005])
  expect(hub.since(1005)).toEqual([])
  expect(hub.since(2)).toBeUndefined()
  expect(hub.recent(2).map(event => event.seq)).toEqual([1004, 1005])
})

it('keeps each Session\'s latest activity and counts events by minute for the last hour', () => {
  let now = Date.parse('2026-11-14T00:00:30Z')
  const hub = new LiveHub(() => now)
  hub.activity({ sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'bash', summary: 'pnpm test', at: '' })
  hub.activity({ sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'turn', summary: 'turn ended', state: 'idle', at: '' })
  now += 120_000; hub.emit('trigger')
  expect(hub.sessions()).toEqual([expect.objectContaining({ sessionId: 'worker-t1', kind: 'turn', state: 'idle' })])
  const rates = hub.rates(3)
  expect(rates.map(rate => rate.counts)).toEqual([{ activity: 2 }, {}, { trigger: 1 }])
})

it('summarizes a tool call by its command or path on one line, with what looks like a secret masked', () => {
  expect(toolSummary('bash', JSON.stringify({ command: 'gh auth login --with-token ghp_abcdefghijklmnopqrstuvwxyz0123' }))).toBe('gh auth login --with-token ***')
  expect(toolSummary('read', JSON.stringify({ path: '/w/t1/src/app.ts' }))).toBe('/w/t1/src/app.ts')
  expect(summarize('curl -H "Authorization: Bearer abc.def.ghi" https://x')).toBe('curl -H "Authorization: ***" https://x')
  expect(summarize('password=hunter2 next')).toBe('password=*** next')
  expect(summarize('word '.repeat(50))).toHaveLength(120)
  expect(toolSummary('bash', 'not json')).toBe('not json')
})

it('reports the topics committed writes touched once the task yields, and none of a write rolled back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-store-')); const store = new Store(join(dir, 'db'))
  try {
    const seen: string[][] = []
    store.onChange(topics => seen.push([...topics].sort()))
    store.saveSettings({ executor: { maxWorkers: 2 } })
    expect(() => store.atomic(() => { store.set('prompt-revision' as never, 1); throw new Error('rolled back') })).toThrow()
    await Promise.resolve()
    expect(seen).toEqual([['settings']])
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('streams the events after Last-Event-ID, then new ones, or a reset when some are gone, and stops on close', () => {
  const hub = new LiveHub()
  hub.emit('ticket'); hub.emit('thread')
  const stream = (headers: Record<string, string>, since: string | null = null) => {
    const req = Object.assign(new EventEmitter(), { headers }), chunks: string[] = []
    const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), write: (chunk: string) => { chunks.push(chunk); return true } })
    streamEvents(req as never, res as never, hub, since)
    return { req, res, text: () => chunks.join('') }
  }
  const resumed = stream({ 'last-event-id': '1' })
  expect(resumed.res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'text/event-stream; charset=utf-8' }))
  expect(resumed.text()).toContain('id: 2\nevent: thread\n')
  expect(resumed.text()).not.toContain('event: ticket')
  hub.emit('decision')
  expect(resumed.text()).toContain('id: 3\nevent: decision\n')
  resumed.req.emit('close')
  hub.emit('outbox')
  expect(resumed.text()).not.toContain('event: outbox')
  for (let index = 0; index < 1100; index++) hub.emit('ticket')
  expect(stream({}, '1').text()).toContain('event: reset')
  // A new connection without a position starts from now.
  expect(stream({}).text()).not.toContain('event: ticket')
})
