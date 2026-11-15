/**
 * The monitoring console: what the pipeline does right now. Throughput over the last hour, the pipeline with live counts, a lane
 * per Executor slot and the main Session with what each runs this moment, the queue, the Sources' and services' health, and the
 * live event log, which a person can pause, filter by step or topic, and export.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Activity, LiveEvent, LiveTopic, Stage } from './live.ts'
import { useLive, useLiveStatus } from './live.ts'
import { usePoll } from './api.ts'
import type { ApiResponse } from '../app/api.ts'
import { PipelineMap, type NodeStat } from './pipeline-view.tsx'
import { position, swimlanesOf } from './swimlanes.ts'
import type { PipelineNode } from './pipeline.ts'
import { usePanel } from './provider.tsx'
import { valueLabel } from './text.ts'
import { IconButton, Button, Icon, Pill, StateDot, Tag, type DotState } from './ui/index.ts'
import { ConfirmButton, Hint, LoadState, SessionButton, StatusHead, Empty } from './widgets.tsx'

type Snapshot = ApiResponse<'GET console/snapshot'>
type Slot = Snapshot['workers'][number]
const TOPICS: readonly LiveTopic[] = ['stage', 'trigger', 'thread', 'decision', 'ticket', 'activity', 'outbox', 'settings', 'prompts', 'health']
/** The topics each pipeline step shows in the log when a person picks it on the map. */
const NODE_TOPICS: Readonly<Record<PipelineNode, readonly LiveTopic[]>> = {
  source: ['trigger', 'thread'], policy: ['settings'], main: ['decision', 'prompts'], executor: ['ticket'],
  reply: ['outbox'],
}
const LOG_LIMIT = 400
/** How much of the feed the time axis remembers: its widest window, and at most this many events. */
const TRAIL_MS = 60 * 60_000, TRAIL_LIMIT = 3000
const WINDOWS = [5, 15, 60] as const
/** How long a step stays lit after a piece of work passed through it. */
const PULSE_MS = 1600
/** The step an event belongs to: a stage names its own, an activity its role, other topics the step that writes them. */
function nodeOf(event: LiveEvent): PipelineNode | undefined {
  if (event.topic === 'stage') return (event.data as Stage | undefined)?.node
  if (event.topic === 'activity') return (event.data as Activity | undefined)?.role === 'orchestrator' ? 'main' : 'executor'
  return (Object.keys(NODE_TOPICS) as PipelineNode[]).find(node => NODE_TOPICS[node].includes(event.topic as LiveTopic))
}
/** The Ticket an event concerns, if any. */
const ticketOf = (event: LiveEvent): string | undefined => (event.data as { ticketId?: string } | undefined)?.ticketId
const sum = (rates: Snapshot['rates'], topic: LiveTopic, minutes = 60) => rates.slice(-minutes).reduce((total, rate) => total + (rate.counts[topic] ?? 0), 0)
/** Seconds since `at`, as m:ss or h:mm:ss. */
function elapsed(at: string | undefined, now: number): string {
  if (!at) return '—'
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000))
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
/**
 * One clock for the whole console, ticking every second while any view reads it and the page is visible, for the lanes' running
 * times (CON-3: one timer rather than one per lane).
 */
const clock = (() => {
  let now = Date.now(), timer: ReturnType<typeof setInterval> | undefined
  const listeners = new Set<() => void>()
  const tick = () => { now = Date.now(); for (const listener of listeners) listener() }
  const sync = () => {
    const run = listeners.size > 0 && !(typeof document !== 'undefined' && document.hidden)
    if (run && !timer) { tick(); timer = setInterval(tick, 1000) } else if (!run && timer) { clearInterval(timer); timer = undefined }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
  return { get: () => now, subscribe: (listener: () => void) => { listeners.add(listener); sync(); return () => { listeners.delete(listener); sync() } } }
})()
function useNow(): number { return useSyncExternalStore(clock.subscribe, clock.get, clock.get) }


/** How the dispatch reads right now, worst first: what blocks it, what waits for a person, and what runs. */
export interface Verdict { tone: DotState; key: string; values: Record<string, string | number> }
/** How bad each tone is: the strip sorts by it, so a Source that is down leads even while processing is paused. */
const SEVERITY: Readonly<Record<DotState, number>> = { error: 0, warning: 1, ongoing: 2, done: 3, idle: 3 }
export function verdictOf(data: Pick<Snapshot, 'paused' | 'load' | 'waiting' | 'outbox' | 'health' | 'queue'>): Verdict[] {
  const out: Verdict[] = []
  const down = data.health.filter(item => item.state === 'error').map(item => item.name)
  if (down.length) out.push({ tone: 'error', key: 'consoleVerdict.down', values: { names: down.join(', ') } })
  if (data.paused) out.push({ tone: 'warning', key: 'consoleVerdict.paused', values: { queued: data.load.queued } })
  if (!data.paused && data.load.maxWorkers > 0 && data.load.running >= data.load.maxWorkers && data.load.queued > 0)
    out.push({ tone: 'warning', key: 'consoleVerdict.full', values: { max: data.load.maxWorkers, queued: data.load.queued } })
  if (data.waiting.length) out.push({ tone: 'warning', key: 'consoleVerdict.person', values: { count: data.waiting.length } })
  if (data.outbox.pending) out.push({ tone: 'warning', key: 'consoleVerdict.outbox', values: { count: data.outbox.pending } })
  if (data.load.running) out.push({ tone: 'ongoing', key: 'consoleVerdict.running', values: { running: data.load.running, max: data.load.maxWorkers } })
  if (!out.length) out.push({ tone: 'done', key: 'consoleVerdict.idle', values: {} })
  // Stable sort: within one tone the order above stands (blocking before waiting before backlog).
  return out.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone])
}
function VerdictStrip({ items }: { items: Verdict[] }) {
  const { t } = usePanel()
  return <div className="dt-verdict" role="status" aria-live="polite" data-tone={items[0]!.tone}>
    {items.map(item => <span key={item.key} className="dt-verdict-item" data-tone={item.tone}><StateDot state={item.tone} />
      {t(item.key as never, item.values as never)}</span>)}
  </div>
}

export function ConsolePage() {
  const { t, call } = usePanel()
  const status = useLiveStatus()
  // Activity streams too often to reload for: the lanes take it from the feed; the rest reloads on its topics.
  const { data, error, reload } = usePoll(() => call('GET console/snapshot'), [], 5000,
    { live: ['ticket', 'trigger', 'decision', 'outbox', 'settings', 'health'] })
  const [log, setLog] = useState<LiveEvent[]>([])
  const [activity, setActivity] = useState<Record<string, Activity>>({})
  const [paused, setPaused] = useState(false)
  const held = useRef<LiveEvent[]>([])
  const dropped = useRef(0)
  const [heldCount, setHeldCount] = useState(0)
  const [pulses, setPulses] = useState<Partial<Record<PipelineNode, number>>>({})
  const [traced, setTraced] = useState<string>()
  // The time axis keeps its own memory of steps and activity, apart from the log: pausing or filtering the log leaves it whole.
  const [trail, setTrail] = useState<LiveEvent[]>([])
  // Ticks every second, so a step's light goes out once the work passed it.
  const now = useNow()
  const seeded = useRef(false)
  // When the console last heard anything true about the pipeline: a snapshot or a live event. While the feed is down the page
  // says so with this age, rather than showing yesterday's numbers as if they were now.
  const [freshAt, setFreshAt] = useState(() => new Date().toISOString())
  useEffect(() => { if (data) setFreshAt(new Date().toISOString()) }, [data])
  useEffect(() => { if (data && !seeded.current) { seeded.current = true; setLog(data.events.slice(-LOG_LIMIT).reverse())
    setTrail(data.events.filter(event => event.topic === 'stage' || event.topic === 'activity')) } }, [data])
  useLive('*', event => {
    if (event.topic === 'reset') { void reload(); return }
    setFreshAt(new Date().toISOString())
    if (event.topic === 'stage' || event.topic === 'activity') setTrail(current => {
      const cut = Date.now() - TRAIL_MS
      return [...current.filter(item => Date.parse(item.at) >= cut), event].slice(-TRAIL_LIMIT)
    })
    const step = nodeOf(event)
    if (step && !paused) setPulses(current => ({ ...current, [step]: Date.now() }))
    if (event.topic === 'activity' && event.data) {
      const item = event.data as Activity
      setActivity(current => ({ ...current, [item.sessionId]: item }))
    }
    // While paused the console holds at most a log's worth of events; older ones are dropped and counted (CON-1).
    if (paused) {
      held.current.push(event)
      if (held.current.length > LOG_LIMIT) { held.current.splice(0, held.current.length - LOG_LIMIT); dropped.current++ }
      setHeldCount(held.current.length + dropped.current); return
    }
    setLog(current => [event, ...current].slice(0, LOG_LIMIT))
  })
  const resume = () => {
    const waiting = held.current.reverse(); held.current = []; dropped.current = 0; setHeldCount(0); setPaused(false)
    setLog(current => [...waiting, ...current].slice(0, LOG_LIMIT))
  }
  const [node, setNode] = useState<PipelineNode>()
  const [topic, setTopic] = useState<LiveTopic>()
  if (!data) return <><StatusHead hint={t('consoleIntro')} /><ConsoleSkeleton /><LoadState error={error} loading={false} /></>
  const live = (slot: { sessionId: string; activity: Activity | null }) => activity[slot.sessionId] ?? slot.activity ?? undefined
  const shown = log.filter(event => (!topic || event.topic === topic) && (!node || nodeOf(event) === node))
  const pulsing = (step: PipelineNode) => (pulses[step] ?? 0) > now - PULSE_MS
  const triggers = sum(data.rates, 'trigger'), tickets = sum(data.rates, 'ticket'), decisions = sum(data.rates, 'decision')
  const stats: Partial<Record<PipelineNode, NodeStat>> = {
    source: { value: t('consoleRate', { count: triggers }), state: data.health.some(item => item.state === 'error') ? 'error' : 'idle' },
    policy: { value: t('consoleDecisions', { count: decisions }) },
    main: { value: live(data.main)?.summary ?? valueLabel(t, 'mode', data.main.mode), state: live(data.main)?.state === 'running' ? 'ongoing' : 'idle' },
    executor: { value: t('pipelineStat.executor', { running: data.load.running, max: data.load.maxWorkers, queued: data.load.queued }),
      state: data.paused ? 'warning' : data.load.running ? 'ongoing' : 'idle' },
    reply: { value: t('consoleOutbox', { count: data.outbox.pending }), state: data.outbox.pending ? 'warning' : 'idle' },
  }
  for (const step of Object.keys(stats) as PipelineNode[]) if (pulsing(step)) stats[step] = { ...stats[step]!, pulse: pulses[step] }
  const empty = Math.max(0, data.load.maxWorkers - data.workers.length)
  return <div className="dt-console">
    <StatusHead hint={t('consoleIntro')} />
    {data.paused && <p className="dt-banner">{t('consolePaused')}</p>}
    {status === 'polling' && <p className="dt-banner dt-console-stale" role="status" data-status={status}>
      <Icon name="alert" size={14} />{t('consoleStale', { ago: elapsed(freshAt, now) })}</p>}
    <VerdictStrip items={verdictOf(data)} />
    <div className="dt-kpis">
      <Kpi label={t('consoleKpiRunning')} value={`${data.load.running}/${data.load.maxWorkers}`} tone={data.load.running ? 'ongoing' : 'idle'} />
      <Kpi label={t('consoleKpiQueued')} value={data.load.queued} tone={data.load.queued ? 'warning' : 'idle'} />
      <Kpi label={t('consoleKpiPerson')} value={data.waiting.length} tone={data.waiting.length ? 'warning' : 'idle'} />
      <Kpi label={t('consoleKpiOutbox')} value={data.outbox.pending} tone={data.outbox.pending ? 'warning' : 'idle'} />
      <Kpi label={t('consoleKpiTriggers')} value={triggers} spark={data.rates.map(rate => rate.counts.trigger ?? 0)} />
      <Kpi label={t('consoleKpiTickets')} value={tickets} spark={data.rates.map(rate => rate.counts.ticket ?? 0)} />
    </div>
    <PipelineMap compact stats={stats} onPick={next => setNode(node === next ? undefined : next)} />
    <section className="dt-section" aria-label={t('consoleLanes')}>
      <h2 className="dt-section-title"><span className="dt-section-name">{t('consoleLanes')}</span>
        <span className="dt-count">{data.workers.length + 1}</span></h2>
      <ul className="dt-lanes">
        <Lane name={t('term.mainSession')} tag={data.main.preset} sessionId={data.main.sessionId} activity={live(data.main)} />
        {data.workers.map(slot => <Lane key={slot.ticketId} slot={slot} name={slot.title} sessionId={slot.sessionId} activity={live(slot)}
          onStopped={reload} traced={traced === slot.ticketId} onTrace={() => setTraced(traced === slot.ticketId ? undefined : slot.ticketId)} />)}
        {Array.from({ length: empty }, (_, index) => <li key={`free-${index}`} className="dt-lane dt-lane-free">{t('consoleFreeSlot')}</li>)}
      </ul>
      {data.queue.length > 0 && <div className="dt-queue"><span className="dt-hint">{t('consoleQueue', { count: data.queue.length })}</span>
        {data.queue.map(slot => <Tag key={slot.ticketId} tone="neutral">{slot.title}</Tag>)}</div>}
    </section>
    <Timeline events={trail} now={now} titles={Object.fromEntries([...data.workers, ...data.queue, ...data.waiting].map(slot => [slot.ticketId, slot.title]))}
      traced={traced} onTrace={id => setTraced(traced === id ? undefined : id)} />
    {traced && <TicketTrace ticketId={traced} title={[...data.workers, ...data.queue, ...data.waiting].find(slot => slot.ticketId === traced)?.title
      ?? traced} events={log} onClose={() => setTraced(undefined)} />}
    <div className="dt-console-grid">
      <section className="dt-section dt-log-panel" aria-label={t('consoleLog')}>
        <h2 className="dt-section-title"><span className="dt-section-name">{t('consoleLog')}</span>
          <span className="dt-count">{shown.length}</span>
          <span className="dt-log-tools">
            <span className="dt-live-mini" data-status={status}>{t(`live.${status}`)}</span>
            <Button variant="ghost" size="sm" icon={<Icon name={paused ? 'play' : 'pause'} size={14} />}
              onClick={() => paused ? resume() : setPaused(true)}>{t(paused ? 'consoleResume' : 'consolePause')}
              {paused && heldCount ? ` (${heldCount})` : ''}</Button>
            <Button variant="ghost" size="sm" icon={<Icon name="external" size={14} />} disabled={!shown.length}
              onClick={() => download(shown)}>{t('consoleExport')}</Button>
          </span></h2>
        <div className="dt-filters">
          {node && <Pill active onClick={() => setNode(undefined)}>{t(`pipeline.${node}`)} ×</Pill>}
          <Pill active={!topic} onClick={() => setTopic(undefined)}>{t('consoleAllTopics')}</Pill>
          {TOPICS.map(item => <Pill key={item} active={topic === item} onClick={() => setTopic(topic === item ? undefined : item)}>
            {t(`liveTopic.${item}`)}</Pill>)}
        </div>
        {shown.length ? <ol className="dt-log">{shown.map(event => <LogLine key={event.seq} event={event}
          onTrace={ticketOf(event) ? () => setTraced(ticketOf(event)) : undefined} />)}</ol>
          : <Hint>{t(status === 'live' ? 'consoleLogEmpty' : 'consoleLogOffline')}</Hint>}
      </section>
      <section className="dt-section dt-health-panel" aria-label={t('consoleHealth')}>
        <h2 className="dt-section-title"><span className="dt-section-name">{t('consoleHealth')}</span></h2>
        {data.health.length ? <ul className="dt-health">{data.health.map(item => <li key={item.name} className="dt-health-row">
          <StateDot state={healthState(item.state)} />
          <span className="dt-health-name">{valueLabel(t, 'health', item.name)}</span>
          <span className="dt-health-detail" title={item.detail}>{item.detail || t(`consoleHealthState.${item.state}`)}</span>
        </li>)}</ul> : <Hint>{t('none')}</Hint>}
      </section>
    </div>
  </div>
}
const healthState = (state: string): DotState => state === 'ready' ? 'done' : state === 'error' ? 'error' : state === 'paused' ? 'warning' : 'ongoing'
function download(events: LiveEvent[]) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' }))
  link.download = `dsh-superagent-events-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  link.click(); URL.revokeObjectURL(link.href)
}
function Kpi({ label, value, tone = 'idle', spark }: { label: string; value: number | string; tone?: DotState; spark?: number[] }) {
  const max = Math.max(1, ...spark ?? [])
  return <div className="dt-kpi" data-tone={tone}>
    <span className="dt-kpi-label">{label}</span>
    <span className="dt-kpi-value">{value}</span>
    {spark && <svg className="dt-spark" viewBox={`0 0 ${spark.length} 20`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0 20${spark.map((count, index) => `L${index} ${20 - (count / max) * 18}`).join('')}L${spark.length - 1} 20Z`} className="dt-spark-fill" />
      <path d={spark.map((count, index) => `${index ? 'L' : 'M'}${index} ${20 - (count / max) * 18}`).join('')} className="dt-spark-line" />
    </svg>}
  </div>
}
function Lane({ name, tag, slot, sessionId, activity, onStopped, traced, onTrace }: {
  name: string; tag?: string; slot?: Slot; sessionId: string; activity: Activity | undefined; onStopped?: () => Promise<void>
  traced?: boolean; onTrace?: () => void
}) {
  const { t, call, navigate } = usePanel()
  const now = useNow()
  const running = activity?.state === 'running'
  return <li className="dt-lane" data-running={running || undefined}>
    <div className="dt-lane-head">
      <StateDot state={running ? 'ongoing' : slot?.stage === 'idle' ? 'idle' : slot ? 'ongoing' : 'idle'} />
      {onTrace ? <button type="button" className="dt-lane-name dt-lane-trace" title={t('consoleTraceOpen', { title: name })}
        aria-pressed={traced} onClick={onTrace}>{name}</button> : <span className="dt-lane-name" title={name}>{name}</span>}
      {tag && <Tag tone="outline">{tag}</Tag>}
      {slot && <Tag tone={slot.stage === 'idle' ? 'quiet' : 'info'}>{t(slot.stage === 'idle' ? 'consoleIdle' : 'consoleWorking')}</Tag>}
      {slot && <span className="dt-lane-time" title={t('consoleElapsed')}>{elapsed(slot.startedAt, now)}</span>}
    </div>
    <div className="dt-lane-now">
      {activity ? <><span className="dt-lane-kind">{activity.kind === 'tool' ? activity.tool : t(`consoleKind.${activity.kind}`)}</span>
        <code className="dt-lane-cmd" title={activity.summary}>{activity.summary}</code>
        <span className="dt-lane-ago">{elapsed(activity.at, now)}</span></> : <span className="dt-hint">{t('consoleNoActivity')}</span>}
    </div>
    <div className="dt-lane-actions">
      <SessionButton sessionId={sessionId} />
      {/* From the running work straight to its Ticket, in the drawer over the console (CON-2). */}
      {slot && <IconButton icon="external" size="sm" label={t('consoleOpenTicket', { title: slot.title })}
        onClick={() => navigate({ page: 'execution', id: slot.ticketId })} />}
      {slot && <ConfirmButton danger iconOnly label={t('decision.stop')} icon="stop" title={t('consoleStopTitle', { title: slot.title })}
        message={t('consoleStopMessage')} onConfirm={async () => { await call('POST tickets/:id/stop', { id: slot.ticketId }); await onStopped?.() }} />}
    </div>
  </li>
}
function LogLine({ event, onTrace }: { event: LiveEvent; onTrace?: (() => void) | undefined }) {
  const { t } = usePanel()
  const activity = event.topic === 'activity' ? event.data as Activity | undefined : undefined
  const stage = event.topic === 'stage' ? event.data as Stage | undefined : undefined
  const time = useMemo(() => new Date(event.at).toLocaleTimeString(t('lang') === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }), [event.at, t])
  return <li className="dt-log-line" data-topic={event.topic}>
    <time className="dt-log-time" dateTime={event.at}>{time}</time>
    <span className="dt-log-topic">{t(`liveTopic.${event.topic}` as never)}</span>
    <span className="dt-log-text">{activity ? <>{activity.role === 'orchestrator' ? t('term.mainSession') : activity.ticketId ?? activity.sessionId}
      {' · '}{activity.kind === 'tool' ? <b>{activity.tool}</b> : t(`consoleKind.${activity.kind}`)} {activity.summary}</>
      : stage ? <><b>{stageLabel(t, stage.type)}</b>{stage.ticketId ? ` · ${stage.ticketId}` : stage.threadKey ? ` · ${stage.threadKey}` : ''}
        {stage.detail ? ` · ${stage.detail}` : ''}</>
      : t('consoleChanged', { topic: t(`liveTopic.${event.topic}` as never) })}</span>
    {onTrace && <button type="button" className="dt-log-trace" onClick={onTrace} aria-label={t('consoleTrace')}><Icon name="history" size={12} /></button>}
  </li>
}
function ConsoleSkeleton() {
  return <div className="dt-console" aria-busy="true">
    <div className="dt-kpis">{Array.from({ length: 6 }, (_, index) => <span key={index} className="dt-skeleton dt-kpi" />)}</div>
    <span className="dt-skeleton dt-skeleton-block" />
    <span className="dt-skeleton dt-skeleton-block" />
  </div>
}

/** A domain event's name as the panel words it, or the event type itself for one it does not know. */
function stageLabel(t: ReturnType<typeof usePanel>['t'], type: string): string {
  const key = `stage.${type}`
  const text = t(key as never)
  return text === key ? type : text
}
/**
 * One Ticket's call chain, oldest first: the steps its work took through the pipeline and each tool call and turn of its
 * Executor, with the time since the step before, as the live feed carried them. New steps append as they arrive.
 */
function TicketTrace({ ticketId, title, events, onClose }: { ticketId: string; title: string; events: LiveEvent[]; onClose: () => void }) {
  const { t, navigate } = usePanel()
  // A step's own time, which the feed's envelope may stamp later than it happened.
  const when = (event: LiveEvent) => Date.parse((event.data as { at?: string } | undefined)?.at ?? event.at)
  const steps = useMemo(() => events.filter(event => ticketOf(event) === ticketId).slice().reverse(), [events, ticketId])
  const total = steps.length > 1 ? when(steps.at(-1)!) - when(steps[0]!) : 0
  const gap = (ms: number) => ms < 1000 ? `+${ms}ms` : ms < 60_000 ? `+${(ms / 1000).toFixed(1)}s` : `+${Math.floor(ms / 60_000)}m${Math.round(ms / 1000) % 60}s`
  return <section className="dt-section dt-trace" aria-label={t('consoleTraceTitle', { title })}>
    <h2 className="dt-section-title"><span className="dt-section-name">{t('consoleTraceTitle', { title })}</span>
      <span className="dt-count">{steps.length}</span>
      {total > 0 && <span className="dt-hint">{t('consoleTraceSpan', { time: gap(total).slice(1) })}</span>}
      <span className="dt-log-tools">
        <Button variant="ghost" size="sm" icon={<Icon name="external" size={14} />} onClick={() => navigate({ page: 'execution', id: ticketId })}>
          {t('consoleTraceTicket')}</Button>
        <Button variant="ghost" size="sm" icon={<Icon name="close" size={14} />} onClick={onClose}>{t('close')}</Button>
      </span></h2>
    {steps.length ? <ol className="dt-trace-steps">{steps.map((event, index) => {
      const step = nodeOf(event), activity = event.topic === 'activity' ? event.data as Activity : undefined
      const stage = event.topic === 'stage' ? event.data as Stage : undefined
      const since = index ? when(event) - when(steps[index - 1]!) : 0
      return <li key={event.seq} className="dt-trace-step" data-node={step} data-topic={event.topic}>
        <span className="dt-trace-node">{step ? t(`pipeline.${step}`) : t(`liveTopic.${event.topic}` as never)}</span>
        <span className="dt-trace-what">{stage ? <b>{stageLabel(t, stage.type)}</b> : activity ? <>{activity.kind === 'tool'
          ? <b>{activity.tool}</b> : t(`consoleKind.${activity.kind}`)} <code className="dt-lane-cmd">{activity.summary}</code></>
          : t('consoleChanged', { topic: t(`liveTopic.${event.topic}` as never) })}{stage?.detail ? ` · ${stage.detail}` : ''}</span>
        <span className="dt-trace-gap">{index ? gap(since) : new Date(when(event)).toLocaleTimeString(t('lang') === 'zh' ? 'zh-CN' : 'en-US', { hour12: false })}</span>
      </li>
    })}</ol> : <Empty icon="clock">{t('consoleTraceEmpty')}</Empty>}
  </section>
}

/**
 * The time axis: a lane for the main Session and one per Ticket worked on in the window, each bar a stretch an Executor slot
 * worked on it (still growing while it runs), each tick a tool call, an answer or a decision. Clicking a lane opens its call chain.
 */
function Timeline({ events, now, titles, traced, onTrace }: { events: LiveEvent[]; now: number; titles: Record<string, string>
  traced: string | undefined; onTrace: (ticketId: string) => void }) {
  const { t } = usePanel()
  const [minutes, setMinutes] = useState<typeof WINDOWS[number]>(15)
  // The axis moves once a second with the clock; the lanes are recomputed only when the events or the window change, then clipped.
  const lanes = useMemo(() => swimlanesOf(events, now, minutes * 60_000), [events, minutes, now])
  const clock = (at: number) => new Date(at).toLocaleTimeString(t('lang') === 'zh' ? 'zh-CN' : 'en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const marks = Array.from({ length: 5 }, (_, index) => lanes.from + ((lanes.to - lanes.from) * index) / 4)
  const busy = lanes.lanes.filter(lane => lane.role === 'ticket').length
  return <section className="dt-section dt-timeline" aria-label={t('consoleTimeline')}>
    <h2 className="dt-section-title"><span className="dt-section-name">{t('consoleTimeline')}</span>
      <span className="dt-count">{busy || ''}</span>
      <span className="dt-log-tools">{WINDOWS.map(item => <Pill key={item} active={minutes === item} onClick={() => setMinutes(item)}>
        {t('consoleWindow', { count: item })}</Pill>)}</span></h2>
    <div className="dt-timeline-grid" role="list">
      <div className="dt-timeline-axis" aria-hidden="true"><span />
        <span className="dt-timeline-scale">{marks.map((at, index) => <span key={index} style={{ left: `${index * 25}%` }}>{clock(at)}</span>)}</span>
      </div>
      {lanes.lanes.map(lane => {
        const name = lane.role === 'main' ? t('term.mainSession') : titles[lane.ticketId!] ?? lane.ticketId!.slice(0, 12)
        const open = lane.bars.some(bar => bar.open)
        return <div key={lane.id} role="listitem" className="dt-timeline-row" data-role={lane.role} data-open={open || undefined}
          data-traced={(!!lane.ticketId && traced === lane.ticketId) || undefined}>
          {lane.ticketId ? <button type="button" className="dt-timeline-name" title={t('consoleTraceOpen', { title: name })}
            aria-pressed={traced === lane.ticketId} onClick={() => onTrace(lane.ticketId!)}>
            <StateDot state={open ? 'ongoing' : 'idle'} /><span>{name}</span></button>
            : <span className="dt-timeline-name"><StateDot state={lane.ticks.length ? 'ongoing' : 'idle'} /><span>{name}</span></span>}
          <span className="dt-timeline-track" onClick={lane.ticketId ? () => onTrace(lane.ticketId!) : undefined}>
            {marks.slice(1, -1).map((_, index) => <span key={index} className="dt-timeline-gridline" style={{ left: `${(index + 1) * 25}%` }} />)}
            {lane.bars.map((bar, index) => <span key={index} className="dt-timeline-bar" data-open={bar.open || undefined}
              data-outcome={bar.outcome?.split(' · ')[0]} style={{ left: `${position(lanes, bar.start)}%`,
                width: `${Math.max(0.6, position(lanes, bar.end) - position(lanes, bar.start))}%` }}
              title={`${clock(bar.start)}–${bar.open ? t('consoleNow') : clock(bar.end)}${bar.outcome ? ` · ${bar.outcome}` : ''}`} />)}
            {lane.ticks.map((tick, index) => <span key={index} className="dt-timeline-tick" data-kind={tick.kind}
              style={{ left: `${position(lanes, tick.at)}%` }} title={`${clock(tick.at)} · ${tick.label}`} />)}
          </span>
        </div>
      })}
      <span className="dt-timeline-now" aria-hidden="true" />
    </div>
    {!busy && <Hint>{t('consoleTimelineEmpty', { count: minutes })}</Hint>}
  </section>
}
