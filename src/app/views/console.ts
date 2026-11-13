/** The monitoring console's snapshot: the Executor slots and queue, what each Session does now, the Sources, the outbox and the rates. */
import { latestAssignment, ticketStage, type Ticket } from '../../core/index.ts'
import type { Health } from '../../sources/host.ts'
import type { Activity, LiveHub } from '../live.ts'
import type { Store } from '../store.ts'

export interface ConsoleHost {
  store: Store; live: LiveHub; health: Record<string, Health>; masterId: string; running: number
}
const slot = (ticket: Ticket, live: Map<string, Activity>) => {
  const stage = ticketStage(ticket), assignment = latestAssignment(ticket), sessionId = `worker-${ticket.id}`
  return { ticketId: ticket.id, title: ticket.title, stage: stage.stage, action: 'action' in stage ? stage.action ?? null : null,
    sessionId, startedAt: assignment?.startedAt ?? assignment?.createdAt ?? ticket.createdAt,
    report: assignment?.report ? { state: assignment.report.state, at: assignment.report.at } : null,
    activity: live.get(sessionId) ?? null }
}
export function consoleSnapshot({ store, live, health, masterId, running }: ConsoleHost) {
  const settings = store.settings()
  const activities = new Map(live.sessions().map(activity => [activity.sessionId, activity]))
  const open = store.tickets.open().map(ticket => slot(ticket, activities))
  const queued = open.filter(item => item.stage === 'working' && item.action === 'queued')
  return {
    seq: live.last(), at: new Date().toISOString(), paused: settings.paused,
    load: { running, queued: queued.length, maxWorkers: settings.executor.maxWorkers },
    main: { sessionId: masterId, preset: settings.eval.agentPreset, mode: settings.eval.mode, activity: activities.get(masterId) ?? null },
    workers: open.filter(item => item.stage === 'working' && item.action !== 'queued' || item.stage === 'idle'),
    queue: queued, waiting: open.filter(item => item.stage === 'person'),
    outbox: { pending: store.receipts.waiting().length },
    health: Object.entries(health).map(([name, entry]) => ({ name, ...entry })),
    rates: live.rates(60), events: live.recent(150),
  }
}
export type ConsoleView = ReturnType<typeof consoleSnapshot>
