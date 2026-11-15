/**
 * The console's time axis: what each piece of work did over the last minutes, read from the live feed. Each Ticket is a lane
 * whose bars are the stretches an Executor slot worked on it (an Assignment from `assignment.started` to `assignment.ended`, or
 * to now while it runs); the main Session has a lane of its own. Tool calls and decisions are ticks on their lane. A pure
 * function of the events, so the view and the tests read the same thing.
 */
import type { Activity, LiveEvent, Stage } from './live.ts'

export interface LaneBar { start: number; end: number; open: boolean; assignmentId?: string | undefined; outcome?: string | undefined }
export interface LaneTick { at: number; kind: 'tool' | 'message' | 'decision' | 'stage'; label: string }
export interface Lane { id: string; ticketId?: string | undefined; role: 'main' | 'ticket'; bars: LaneBar[]; ticks: LaneTick[]; last: number }
export interface Swimlanes { from: number; to: number; lanes: Lane[] }

const time = (at: string | undefined): number => { const value = at ? Date.parse(at) : NaN; return Number.isFinite(value) ? value : 0 }
const MAIN = 'main'

/**
 * The lanes for `events` (any order) over the `window` milliseconds before `now`: the main Session's lane first, then one per
 * Ticket, the most recently active first, at most `limit` of them. A bar that started before the window is clipped to it, and
 * one still open runs to `now`.
 */
export function swimlanesOf(events: readonly LiveEvent[], now: number, window = 15 * 60_000, limit = 12): Swimlanes {
  const from = now - window
  const lanes = new Map<string, Lane>()
  const lane = (id: string, ticketId?: string): Lane => {
    let found = lanes.get(id)
    if (!found) { found = { id, ...ticketId ? { ticketId } : {}, role: id === MAIN ? 'main' : 'ticket', bars: [], ticks: [], last: 0 }; lanes.set(id, found) }
    return found
  }
  lane(MAIN)
  const sorted = [...events].sort((a, b) => time(a.at) - time(b.at) || a.seq - b.seq)
  for (const event of sorted) {
    // An event stamped after `now` (the browser's clock ticks once a second, and the service's clock may run ahead of it) is drawn
    // at now rather than dropped: it happened, the axis just has not caught up with it.
    const stamped = time(event.at)
    if (!stamped) continue
    const at = Math.min(stamped, now)
    if (event.topic === 'stage' && event.data) {
      const stage = event.data as Stage
      if (stage.type === 'decision.recorded') {
        const target = lane(MAIN)
        if (at >= from) target.ticks.push({ at, kind: 'decision', label: stage.detail ?? stage.type })
        target.last = Math.max(target.last, at)
      }
      if (!stage.ticketId) continue
      const target = lane(stage.ticketId, stage.ticketId)
      target.last = Math.max(target.last, at)
      if (stage.type === 'assignment.started') {
        // A new start closes a bar the feed never ended (an end lost to a restart), at the new start.
        const open = target.bars.find(bar => bar.open)
        if (open) { open.end = at; open.open = false }
        target.bars.push({ start: at, end: now, open: true, ...stage.assignmentId ? { assignmentId: stage.assignmentId } : {} })
      } else if (stage.type === 'assignment.ended' || stage.type === 'ticket.ended') {
        const open = [...target.bars].reverse().find(bar => bar.open && (!stage.assignmentId || !bar.assignmentId || bar.assignmentId === stage.assignmentId))
        if (open) { open.end = at; open.open = false; if (stage.detail) open.outcome = stage.detail }
        else if (stage.type === 'assignment.ended' && at >= from) target.bars.push({ start: from, end: at, open: false, ...stage.detail ? { outcome: stage.detail } : {} })
        if (at >= from) target.ticks.push({ at, kind: 'stage', label: stage.detail ? `${stage.type} · ${stage.detail}` : stage.type })
      } else if (at >= from) target.ticks.push({ at, kind: 'stage', label: stage.type })
    } else if (event.topic === 'activity' && event.data) {
      const activity = event.data as Activity
      if (activity.kind === 'turn') continue
      const target = activity.role === 'orchestrator' ? lane(MAIN) : activity.ticketId ? lane(activity.ticketId, activity.ticketId) : undefined
      if (!target) continue
      target.last = Math.max(target.last, at)
      if (at >= from) target.ticks.push({ at, kind: activity.kind === 'tool' ? 'tool' : 'message',
        label: activity.tool ? `${activity.tool} · ${activity.summary}` : activity.summary })
      // Activity on a Ticket with no bar yet (its start fell before the feed's memory) means a slot is on it now.
      if (activity.role === 'worker' && activity.state !== 'idle' && !target.bars.some(bar => bar.open)) {
        const last = target.bars[target.bars.length - 1]
        if (!last || last.end < at) target.bars.push({ start: Math.max(from, at), end: now, open: true })
      }
    }
  }
  const visible = (item: Lane) => item.role === 'main' || item.bars.some(bar => bar.end >= from) || item.ticks.length > 0
  const tickets = [...lanes.values()].filter(item => item.role === 'ticket' && visible(item)).sort((a, b) => b.last - a.last).slice(0, limit)
  for (const item of [lane(MAIN), ...tickets]) {
    item.bars = item.bars.filter(bar => bar.end >= from).map(bar => ({ ...bar, start: Math.max(from, bar.start), end: bar.open ? now : bar.end }))
  }
  return { from, to: now, lanes: [lane(MAIN), ...tickets] }
}

/** Where `at` falls across the window, as a percentage from its left edge. */
export const position = (lanes: Pick<Swimlanes, 'from' | 'to'>, at: number): number =>
  Math.min(100, Math.max(0, ((at - lanes.from) / Math.max(1, lanes.to - lanes.from)) * 100))
