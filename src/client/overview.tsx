/** Overview page: pending Tickets requiring human action, active system problems, 24-hour flow counts, and Executor load. */
import { useState, type ReactNode } from 'react'
import { KeptOutDrawer } from './filtered.tsx'
import { usePoll, type Problem } from './api.ts'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { useDeferredRemoval, usePause } from './actions.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, Hint, LoadState, Section, SetupMessage, Empty } from './widgets.tsx'
import { Button, Icon } from './ui/index.ts'

function ProblemLine({ problem, onChanged, onDismiss }: { problem: Problem; onChanged: () => Promise<void>; onDismiss: (id: string) => void }) {
  const { t, call, navigate } = usePanel()
  // Requeue has its own busy state; Dismiss leaves at once and offers Undo (OV-3).
  const requeue = useAction((id: string) => call('POST triggers/:id/requeue', { id }), { reload: onChanged })
  const pause = usePause()
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="secondary" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <Button variant="secondary" size="sm" icon={<Icon name="play" size={14} />} busy={pause.busy}
        onClick={() => { void pause.set(false).then(onChanged) }}>{t('resumeProcessing')}</Button>)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="secondary" size="sm" icon={<Icon name="refresh" size={14} />} busy={requeue.busy}
          onClick={() => { void requeue.run(problem.triggerId) }}>{t('requeue')}</Button>
        <Button variant="secondary" size="sm" icon={<Icon name="dismiss" size={14} />}
          onClick={() => onDismiss(problem.decisionId)}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

/** A problem's own identity, so a row's busy state stays with its problem when the list changes under it (X-16). */
function problemKey(problem: Problem): string {
  switch (problem.kind) {
    case 'source-error': return `${problem.kind}:${problem.source.id}:${problem.source.health.code ?? problem.source.health.detail ?? ''}`
    case 'eval-overdue': return `${problem.kind}:${problem.thread.key}`
    case 'eval-unavailable': return `${problem.kind}:${problem.decisionId}`
    case 'runtime-error': return `${problem.kind}:${problem.name}`
    case 'setup': return `${problem.kind}:${problem.place}`
    case 'outgoing': return `${problem.kind}:${problem.outgoing.id}`
    default: return problem.kind
  }
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET overview'), [], undefined, { live: ['trigger', 'thread', 'ticket', 'decision', 'outbox', 'settings', 'health'] })
  // A dismissed problem leaves at once; the dismissal is sent when its notice's Undo has lapsed.
  const dismissal = useDeferredRemoval(id => call('POST decisions/:id/dismiss', { id }), reload, t('dismissedNotice'))
  const [keptOut, setKeptOut] = useState<'filtered' | 'dropped'>()
  if (!data) return <LoadState error={error} loading shape="cards" />
  const problems = data.problems.filter(problem => problem.kind !== 'eval-unavailable' || !dismissal.hidden.has(problem.decisionId))
  // A count opens what it counts: a list's page, or the messages kept out in a drawer over the overview (OV-1).
  const stat = (label: string, value: ReactNode, route?: Route | 'filtered' | 'dropped') => <span className="dt-stat">
    <span className="dt-stat-label">{label}</span>
    {route ? <button type="button" className="dt-textlink dt-stat-value" onClick={() => typeof route === 'string' ? setKeptOut(route)
      : navigate(route)}>{value}</button> : <span className="dt-stat-value">{value}</span>}
  </span>
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  return <>
    <LoadState error={error} loading={false} have />
    <Section title={t('pendingTickets')} count={data.person.length}>
      {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reload} />)}</ul>
        : <Empty icon="decision">{t('needsYouNone')}</Empty>}
    </Section>
    {problems.length > 0 && <Section title={t('problems')} count={problems.length}>
      <ul className="dt-list dt-cards">{problems.map(problem => <ProblemLine key={problemKey(problem)} problem={problem}
        onChanged={reload} onDismiss={dismissal.start} />)}</ul>
    </Section>}
    <Section title={t('lastDay')} action={more({ page: 'trigger', query: { filter: 'recent' } })}>
      {/* Received and evaluated counts operate on Triggers rather than Threads or Decisions, so they do not link to filtered views. */}
      <div className="dt-stats">
        {stat(t('flowReceivedLabel'), data.flow.received)}
        {stat(t('flowFilteredLabel'), data.flow.filtered, data.flow.filtered ? 'filtered' : undefined)}
        {stat(t('flowJudgedLabel'), data.flow.judged)}
        {stat(t('flowAcceptedLabel'), data.flow.accepted, { page: 'eval', query: { window: '24h' } })}
        {data.flow.dropped > 0 && stat(t('flowDroppedLabel'), data.flow.dropped, 'dropped')}
      </div>
    </Section>
    <KeptOutDrawer key={keptOut} open={!!keptOut} kind={keptOut ?? 'filtered'} onClose={() => setKeptOut(undefined)} />
    <Section title={t('term.executor')} action={more({ page: 'execution' })}>
      {/* Pauses surface in `problems` above, so Executor counts render the same in both states; while setup waits, nothing runs. */}
      {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <div className="dt-stats">
        {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
        {stat(t('queuedLabel'), data.executor.queued)}
        {stat(t('idleLabel'), data.executor.idle)}
      </div>}
    </Section>
  </>
}
