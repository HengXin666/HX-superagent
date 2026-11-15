/** The console's time axis, read from the live feed. */
import { expect, it } from 'vitest'
import type { LiveEvent } from '../src/app/live.ts'
import { position, swimlanesOf } from '../src/client/swimlanes.ts'

const T0 = Date.parse('2026-11-15T10:00:00Z')
let seq = 0
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()
const stage = (minutes: number, type: string, extra: Record<string, string> = {}): LiveEvent =>
  ({ seq: ++seq, at: at(minutes), topic: 'stage', data: { type, node: 'executor', at: at(minutes), ...extra } })
const tool = (minutes: number, ticketId: string): LiveEvent =>
  ({ seq: ++seq, at: at(minutes), topic: 'activity', data: { sessionId: `s-${ticketId}`, role: 'worker', ticketId, kind: 'tool', tool: 'bash',
    summary: 'pnpm test', at: at(minutes), state: 'running' } })

it('draws a bar from an Assignment start to its end, and an open one to now', () => {
  const lanes = swimlanesOf([stage(1, 'assignment.started', { ticketId: 'a', assignmentId: 'x' }), tool(2, 'a'),
    stage(3, 'assignment.ended', { ticketId: 'a', assignmentId: 'x', detail: 'ready' }), stage(4, 'assignment.started', { ticketId: 'a' })],
  T0 + 10 * 60_000)
  const lane = lanes.lanes.find(item => item.ticketId === 'a')!
  expect(lane.bars).toEqual([{ start: T0 + 60_000, end: T0 + 180_000, open: false, assignmentId: 'x', outcome: 'ready' },
    { start: T0 + 240_000, end: T0 + 600_000, open: true }])
  expect(lane.ticks.some(tick => tick.kind === 'tool')).toBe(true)
})

it('puts the main Session first, clips to the window, and orders Tickets by recent activity', () => {
  const lanes = swimlanesOf([stage(0, 'assignment.started', { ticketId: 'old' }), stage(1, 'assignment.started', { ticketId: 'b' }),
    stage(2, 'decision.recorded', { detail: 'accept' }), tool(25, 'old')], T0 + 30 * 60_000, 15 * 60_000)
  expect(lanes.lanes.map(lane => lane.id)).toEqual(['main', 'old', 'b'])
  expect(lanes.lanes[1]!.bars[0]!.start).toBe(lanes.from)
  expect(lanes.lanes[0]!.ticks).toEqual([])
})

it('opens a bar for a Ticket a slot is working on whose start the feed no longer holds', () => {
  const lanes = swimlanesOf([tool(5, 'c')], T0 + 6 * 60_000)
  expect(lanes.lanes.find(item => item.ticketId === 'c')!.bars).toEqual([{ start: T0 + 5 * 60_000, end: T0 + 6 * 60_000, open: true }])
  expect(position(lanes, T0 + 6 * 60_000)).toBe(100)
})

it('draws an event stamped a little after now at now, rather than dropping it', () => {
  const lanes = swimlanesOf([stage(10.01, 'assignment.started', { ticketId: 'd' })], T0 + 10 * 60_000)
  expect(lanes.lanes.find(item => item.ticketId === 'd')!.bars).toEqual([{ start: T0 + 10 * 60_000, end: T0 + 10 * 60_000, open: true }])
})
