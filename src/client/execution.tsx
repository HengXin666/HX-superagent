/** Execution status view (active Tickets and pause control) and Execution settings group (Executor capacity and workspace environment). */
import { useRef, useState } from 'react'
import { TICKET_FILTERS, type TicketFilter } from '../app/api.ts'
import { LIMITS } from '../limits.ts'
import { usePoll, type SettingsView, type SourceView, type StateView } from './api.ts'
import { usePause } from './actions.tsx'
import { AgentPresetField } from './agent-preset.tsx'
import { AgentOverlayField } from './agent-overlays.tsx'
import { CodeEditor, type CodeEditorHandle } from './code-editor.tsx'
import { TagInput } from './tag-input.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { TicketLine } from './rows.tsx'
import { ConfigHistory, Field, Fields, ModelField, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { localized } from './text.ts'
import { Hint, LabelValue, ListRegion, LoadMore, LoadState, Section, StatusHead, Empty } from './widgets.tsx'
import { Button, DisclosureRow, FilterTabs, Icon, InfoTip, Input, Switch } from './ui/index.ts'

export function ExecutionStatus({ filter: current, state, reload }: {
  filter: TicketFilter; state: StateView; reload: () => Promise<void>
}) {
  const { t, call, navigate } = usePanel()
  const [limit, setLimit] = useState(20)
  const { data, error, stale, reload: reloadTickets } = usePoll(() => call('GET tickets', { query: { state: current, limit } }), [current, limit],
    undefined, { live: ['ticket', 'outbox'] })
  const { load: { maxWorkers } } = state
  // Pausing uses its own block revision so toggling pause does not invalidate an open Execution settings draft. It can be undone, so
  // the switch moves at once and the notice offers Undo instead of asking first.
  const pause = usePause()
  const paused = pause.paused
  void reload
  const status = state.setup.problem ? { tone: 'warning', label: t('executorWaitingSetup') } : paused ? { tone: 'warning',
    label: t('processingPaused') }
    : { tone: 'ongoing', label: t('executorRunning') }
  return <>
    <StatusHead hint={t('executionStatusIntro')} settings="execution" />
    <div className="dt-row-meta dt-status-line">
      <span className="dt-status-text" data-state={status.tone}>{status.label}</span>
      {!state.setup.problem && <>
        <LabelValue label={t('executingLabel')}
          value={`${state.load.running} / ${maxWorkers}`} /><LabelValue label={t('queuedLabel')} value={state.load.queued} />
      </>}
      <span className="dt-switch-field"><Switch checked={!paused} label={t('processingSwitch')} disabled={pause.busy}
        onChange={() => { void pause.toggle() }} /><span aria-hidden="true">{t('processingSwitch')}</span></span>
    </div>
    <div className="dt-filters">
      <FilterTabs label={t('filtersLabel')} value={current} onChange={value => { setLimit(20); navigate({ page: 'execution',
        query: value === 'open' ? {} : { filter: value } }, true) }} items={TICKET_FILTERS.map(value => ({ value, label: t(`ticketFilter.${value}`) }))} />
    </div>
    {current === 'idle' && <Hint>{t('idleHint')}</Hint>}
    <LoadState error={error} loading={!data} have={!!data} />
    {data && <ListRegion stale={stale}>{data.items.length ? <ul className="dt-list">{data.items.map(ticket => ticket.stage === 'person'
      ? <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reloadTickets} /> : <TicketLine key={ticket.id} ticket={ticket} />)}</ul> : <Empty icon="queue" action={current !== 'ended'
        ? <Button variant="secondary" size="sm" onClick={() => navigate({ page: 'execution', query: { filter: 'ended' } }, true)}>{t('ticketsShowEnded')}</Button>
        : undefined}>{t('none')}</Empty>}</ListRegion>}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 20)} />}
  </>
}

const firstSentence = (text: string): string => /^[^。；;.]*(?:[。；;]|\.(?=\s|$))?/.exec(text)?.[0] ?? text
function EnvironmentVariables({ groups, sources,
  onPick }: { groups: SettingsView['environment']['variables']; sources: SourceView[]; onPick: (key: string) => void }) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const owner = (id: string) => id === 'executor' ? t('term.executor') : localized(t, sources.find(source => source.id === id)?.title ?? id)
  const count = groups.reduce((sum, group) => sum + group.variables.length, 0)
  return <DisclosureRow icon={<Icon name="hash" />} title={<>{t('environmentVariables')} <span className="dt-count">{count}</span></>}
    open={open} onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      <Hint>{t('environmentPick')}</Hint>
      <table className="dt-table">
        <thead><tr><th>{t('environmentKey')}</th><th>{t('environmentDescription')}</th><th>{t('environmentOwner')}</th></tr></thead>
        <tbody>{groups.flatMap(group => group.variables.map(variable => <tr key={variable.key}>
          <td><button type="button" className="dt-textlink dt-mono" onClick={() => onPick(variable.key)}>{variable.key}</button></td>
          <td title={localized(t, variable.description)}>{firstSentence(localized(t, variable.description))}</td>
          <td>{owner(group.owner)}{!group.enabled && <span className="dt-hint"> · {t('sourceOff')}</span>}</td>
        </tr>))}</tbody>
      </table>
    </div>
  </DisclosureRow>
}
export function ExecutionSettings() {
  const { t } = usePanel()
  const { blocks, environment, sources } = useSettings().settings
  // Keep raw user text (such as separators between blocked commands) in the draft and parse only on save.
  const executor = blocks.executor.value
  const saved = { ...executor, maxWorkers: String(executor.maxWorkers), blockedCommands: executor.blockedCommands.join(' ') }
  const draft = useBlockDraft('executor', saved, blocks.executor.revision,
    value => ({ ...value, maxWorkers: numberOf(value.maxWorkers), blockedCommands: [...new Set(value.blockedCommands.split(/[\s,]+/).filter(Boolean))] }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const prepare = useRef<CodeEditorHandle>(null)
  const insert = (key: string) => prepare.current?.insert(`"$${key}"`)
  const completions = environment.variables.flatMap(group => group.variables.map(variable => ({ key: variable.key,
    description: firstSentence(localized(t, variable.description)) })))
  return <div className="dt-form">
    <form className="dt-form" onSubmit={event => { void draft.submit(event) }}>
      <Fields disabled={draft.busy}>
        <div className="dt-form dt-block" data-pipeline-block="executor" data-pipeline-title={t('term.executor')}>
          <h2 className="dt-block-title">{t('term.executor')}<InfoTip text={t('executorIntro')} /></h2>
          <div data-pipeline-part="executor-model"><Section title={t('executorModel')} hint={t('executorModelHint')}><ModelField
            id="dt-worker-model" value={value.model} onChange={model => edit({ model })} /></Section></div>
          <div data-pipeline-part="executor-slots"><Field label={t('maxWorkers')} hint={t('maxWorkersHint')}>
            <Input type="number" min={LIMITS.maxWorkers.min} max={LIMITS.maxWorkers.max} required value={value.maxWorkers}
              onChange={event => edit({ maxWorkers: event.target.value })} />
          </Field></div>
          <AgentPresetField role="worker" value={value.agentPreset} saved={executor.agentPreset}
            onChange={agentPreset => edit({ agentPreset })} />
          <AgentOverlayField role="worker" value={value.overlays} saved={executor.overlays} onChange={overlays => edit({ overlays })} />
        </div>
        <div className="dt-form dt-block" data-pipeline-block="environment" data-pipeline-part="environment" data-pipeline-title={t('term.environment')}>
          <h2 className="dt-block-title">{t('term.environment')}<InfoTip text={t('environmentIntro')} /></h2>
          <Field label={t('executionDirectory')} hint={t('executionDirectoryHint')} note={value.directory ? undefined
            : t('executionDirectoryDefault', { root: environment.root })}>
            <Input className="dt-mono" value={value.directory} placeholder={t('executionDirectoryEmpty')} spellCheck={false} pattern="/.*"
              onChange={event => edit({ directory: event.target.value })} />
          </Field>
          <Field label={t('prepareCommand')} hint={t('prepareCommandHint')}>
            <CodeEditor keysHint={t('codeEditorKeys')} ref={prepare} language="shell" label={t('prepareCommand')} minLines={3} maxLength={LIMITS.prepareCommand}
              placeholder={t('prepareCommandEmpty')} value={value.prepare} variables={completions}
              onChange={next => edit({ prepare: next })} />
          </Field>
          <EnvironmentVariables groups={environment.variables} sources={sources} onPick={insert} />
          <Field label={t('blockedCommands')} hint={t('blockedCommandsHint')}>
            <TagInput label={t('blockedCommands')} value={value.blockedCommands} placeholder={t('blockedCommandsNone')}
              pattern={/^[A-Za-z0-9._-]+$/} onChange={blockedCommands => edit({ blockedCommands })} />
          </Field>
        </div>
      </Fields>
      <SaveBar {...draft} onDiscard={draft.discard} />
    </form>
    <ConfigHistory blocks={['executor', 'pause']} />
  </div>
}
