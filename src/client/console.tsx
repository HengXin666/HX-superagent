/**
 * The monitoring console: what the pipeline does right now. Throughput over the last hour, the pipeline with live counts, a lane
 * per Executor slot and the main Session with what each runs this moment, the queue, the Sources' and services' health, and the
 * live event log, which a person can pause, filter by step or topic, and export.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, LiveEvent, LiveTopic } from './live.ts'
import { useLive, useLiveStatus } from './live.ts'
import { usePoll } from './api.ts'
import type { ApiResponse } from '../app/api.ts'
import { Button, Icon, Pill, StateDot, Tag, type DotState } from './controls.tsx'
import { PipelineMap, type NodeStat } from './pipeline-view.tsx'
import type { PipelineNode } from './pipeline.ts'
import { usePanel } from './provider.tsx'
import { valueLabel } from './text.ts'
import { ConfirmButton, Hint, LoadState, SessionButton, StatusHead } from './widgets.tsx'

type Snapshot = ApiResponse<'GET console/snapshot'>
type Slot = Snapshot['workers'][number]
const TOPICS: readonly LiveTopic[] = ['trigger', 'thread', 'decision', 'ticket', 'activity', 'outbox', 'settings', 'prompts', 'health']
/** The topics each pipeline step shows in the log when a person picks it on the map. */
const NODE_TOPICS: Readonly<Record<PipelineNode, readonly LiveTopic[]>> = {
  source: ['trigger', 'thread'], policy: ['decision', 'settings'], main: ['activity', 'decision', 'prompts'], executor: ['ticket', 'activity'],
  reply: ['outbox'],
}
const LOG_LIMIT = 400
const sum = (rates: Snapshot['rates'], topic: LiveTopic, minutes = 60) => rates.slice(-minutes).reduce((total, rate) => total + (rate.counts[topic] ?? 0), 0)
/** Seconds since `at`, as m:ss or h:mm:ss. */
function elapsed(at: string | undefined, now: number): string {
  if (!at) return '—'
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000))
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
/** A clock that ticks every second while mounted, for the lanes' running times. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return now
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
  const [heldCount, setHeldCount] = useState(0)
  const seeded = useRef(false)
  useEffect(() => { if (data && !seeded.current) { seeded.current = true; setLog(data.events.slice(-LOG_LIMIT).reverse()) } }, [data])
  useLive('*', event => {
    if (event.topic === 'reset') { void reload(); return }
    if (event.topic === 'activity' && event.data) {
      const item = event.data as Activity
      setActivity(current => ({ ...current, [item.sessionId]: item }))
    }
    if (paused) { held.current.push(event); setHeldCount(held.current.length); return }
    setLog(current => [event, ...current].slice(0, LOG_LIMIT))
  })
  const resume = () => {
    const waiting = held.current.reverse(); held.current = []; setHeldCount(0); setPaused(false)
    setLog(current => [...waiting, ...current].slice(0, LOG_LIMIT))
  }
  const [node, setNode] = useState<PipelineNode>()
  const [topic, setTopic] = useState<LiveTopic>()
  if (!data) return <><StatusHead hint={t('consoleIntro')} /><ConsoleSkeleton /><LoadState error={error} loading={false} /></>
  const live = (slot: { sessionId: string; activity: Activity | null }) => activity[slot.sessionId] ?? slot.activity ?? undefined
  const shown = log.filter(event => (!topic || event.topic === topic) && (!node || NODE_TOPICS[node].includes(event.topic as LiveTopic)))
  const triggers = sum(data.rates, 'trigger'), tickets = sum(data.rates, 'ticket'), decisions = sum(data.rates, 'decision')
  const stats: Partial<Record<PipelineNode, NodeStat>> = {
    source: { value: t('consoleRate', { count: triggers }), state: data.health.some(item => item.state === 'error') ? 'error' : 'idle' },
    policy: { value: t('consoleDecisions', { count: decisions }) },
    main: { value: live(data.main)?.summary ?? valueLabel(t, 'mode', data.main.mode), state: live(data.main)?.state === 'running' ? 'ongoing' : 'idle' },
    executor: { value: t('pipelineStat.executor', { running: data.load.running, max: data.load.maxWorkers, queued: data.load.queued }),
      state: data.paused ? 'warning' : data.load.running ? 'ongoing' : 'idle' },
    reply: { value: t('consoleOutbox', { count: data.outbox.pending }), state: data.outbox.pending ? 'warning' : 'idle' },
  }
  const empty = Math.max(0, data.load.maxWorkers - data.workers.length)
  return <div className="dt-console">
    <StatusHead hint={t('consoleIntro')} />
    {data.paused && <p className="dt-banner">{t('consolePaused')}</p>}
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
          onStopped={reload} />)}
        {Array.from({ length: empty }, (_, index) => <li key={`free-${index}`} className="dt-lane dt-lane-free">{t('consoleFreeSlot')}</li>)}
      </ul>
      {data.queue.length > 0 && <div className="dt-queue"><span className="dt-hint">{t('consoleQueue', { count: data.queue.length })}</span>
        {data.queue.map(slot => <Tag key={slot.ticketId} tone="neutral">{slot.title}</Tag>)}</div>}
    </section>
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
        {shown.length ? <ol className="dt-log">{shown.map(event => <LogLine key={event.seq} event={event} />)}</ol>
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
function Lane({ name, tag, slot, sessionId, activity, onStopped }: {
  name: string; tag?: string; slot?: Slot; sessionId: string; activity: Activity | undefined; onStopped?: () => Promise<void>
}) {
  const { t, call } = usePanel()
  const now = useNow()
  const running = activity?.state === 'running'
  return <li className="dt-lane" data-running={running || undefined}>
    <div className="dt-lane-head">
      <StateDot state={running ? 'ongoing' : slot?.stage === 'idle' ? 'idle' : slot ? 'ongoing' : 'idle'} />
      <span className="dt-lane-name" title={name}>{name}</span>
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
      {slot && <ConfirmButton label={t('decision.stop')} icon="stop" title={t('consoleStopTitle', { title: slot.title })}
        message={t('consoleStopMessage')} onConfirm={async () => { await call('POST tickets/:id/stop', { id: slot.ticketId }); await onStopped?.() }} />}
    </div>
  </li>
}
function LogLine({ event }: { event: LiveEvent }) {
  const { t } = usePanel()
  const activity = event.topic === 'activity' ? event.data as Activity | undefined : undefined
  const time = useMemo(() => new Date(event.at).toLocaleTimeString(t('lang') === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }), [event.at, t])
  return <li className="dt-log-line" data-topic={event.topic}>
    <time className="dt-log-time" dateTime={event.at}>{time}</time>
    <span className="dt-log-topic">{t(`liveTopic.${event.topic}` as never)}</span>
    <span className="dt-log-text">{activity ? <>{activity.role === 'orchestrator' ? t('term.mainSession') : activity.ticketId ?? activity.sessionId}
      {' · '}{activity.kind === 'tool' ? <b>{activity.tool}</b> : t(`consoleKind.${activity.kind}`)} {activity.summary}</>
      : t('consoleChanged', { topic: t(`liveTopic.${event.topic}` as never) })}</span>
  </li>
}
function ConsoleSkeleton() {
  return <div className="dt-console" aria-busy="true">
    <div className="dt-kpis">{Array.from({ length: 6 }, (_, index) => <span key={index} className="dt-skeleton dt-kpi" />)}</div>
    <span className="dt-skeleton dt-skeleton-block" />
    <span className="dt-skeleton dt-skeleton-block" />
  </div>
}
