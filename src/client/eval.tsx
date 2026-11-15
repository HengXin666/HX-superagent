/** Eval status view (Decision log) and Eval settings group (Policy rules, per-Source admission, and assessor settings). */
import { useState } from 'react'
import { ADMISSION_DEFAULTS, ADMISSION_OPTIONS, type Admission, type AdmissionCell } from '../admission.ts'
import type { AdmissionRowView } from '../sources/kind.ts'
import { LIMITS } from '../limits.ts'
import { DECISION_FILTERS, DECISION_KINDS, usePoll, type DecisionFilter, type Settings, type SourceView } from './api.ts'
import { AgentPresetField } from './agent-preset.tsx'
import { AgentOverlayField } from './agent-overlays.tsx'
import { SaveBar } from './draft.tsx'
import { useAction, usePanel } from './provider.tsx'
import { usePause } from './actions.tsx'
import { DecisionLine } from './rows.tsx'
import { ConfigHistory, Field, Fields, ModelField, SourceField, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { localized, valueLabel, when } from './text.ts'
import { Hint, LabelValue, ListRegion, LoadMore, LoadState, Section, StatusHead, Empty } from './widgets.tsx'
import type { DecisionWindow } from './route.ts'
import { Tabs, TabPanel, Button, ControlGroup, DisclosureRow, FilterTabs, Icon, InfoTip, Input, SegmentedControl, Switch, Select, Textarea } from './ui/index.ts'

export function EvalStatus({ filter, window, paused }: { filter: DecisionFilter; window: DecisionWindow | undefined; paused: boolean }) {
  const { t, call, navigate } = usePanel()
  const [limit, setLimit] = useState(30)
  const pause = usePause()
  const { data, error, stale } = usePoll(() => call('GET decisions', { query: { limit, kind: DECISION_KINDS[filter],
    ...window ? { window } : {} } }), [filter, limit, window], undefined, { live: ['decision', 'trigger', 'ticket'] })
  const show = (key: DecisionFilter, range: DecisionWindow | undefined) => navigate({ page: 'eval', query: { ...key === 'work' ? {}
    : { filter: key }, ...range ? { window: range } : {} } }, true)
  const ranges = [{ value: 'all' as const, label: t('decisionWindow.all') }, { value: '24h' as const, label: t('decisionWindow.24h') },
    { value: '7d' as const, label: t('decisionWindow.7d') }]
  return <>
    <StatusHead hint={t('evalStatusIntro')} settings="eval" />
    {paused && <p className="dt-banner">
      {t('evalRecordsPaused')} <Button variant="secondary" size="sm" icon={<Icon name="play" size={14} />} busy={pause.busy}
        onClick={() => { void pause.set(false) }}>{t('resumeProcessing')}</Button> <button type="button" className="dt-textlink"
        onClick={() => navigate({ page: 'execution' })}>{t('resumeWhere')}</button>
    </p>}
    <div className="dt-filters">
      <FilterTabs label={t('filtersLabel')} value={filter} onChange={key => { setLimit(30); show(key, window) }}
        items={DECISION_FILTERS.map(key => ({ value: key, label: t(`decisionFilter.${key}`) }))} />
      <span className="dt-filter-gap" />
      <Select size="sm" className="dt-select dt-window" label={t('decisionWindowLabel')} options={ranges} value={window ?? 'all'}
        onChange={next => { setLimit(30); show(filter, next === 'all' ? undefined : next) }} />
    </div>
    <LoadState error={error} loading={!data} have={!!data} />
    {data && <ListRegion stale={stale}>{data.items.length ? <ul className="dt-list">{data.items.map(decision => <DecisionLine key={decision.id}
      decision={decision} />)}</ul> : <Empty icon="decision" action={filter !== 'all' || window ? <Button variant="secondary" size="sm"
        onClick={() => show('all', undefined)}>{t('showAll')}</Button> : undefined}>{t('none')}</Empty>}</ListRegion>}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 30)} />}
  </>
}

type Rule = Settings['policy']['rules'][number]
function RuleRow({ rule, expanded, onToggle, onChange, onDuplicate, onRemove }: {
  rule: Rule; expanded: boolean; onToggle: () => void; onChange: (rule: Rule) => void; onDuplicate: () => void; onRemove: () => void
}) {
  const { t } = usePanel()
  const name = rule.name.trim() || t('newRule')
  return <li className="dt-rule">
    <DisclosureRow icon={<span className="dt-rule-dot" data-enabled={rule.enabled
      || undefined} />} title={name} open={expanded} onToggle={onToggle}
      collapsedContent={<span className="dt-rule-preview">{rule.instruction}</span>}>
      <div className="dt-rule-body">
        <Field label={t('ruleName')}><Input value={rule.name} required maxLength={LIMITS.ruleName} onChange={event => onChange({ ...rule,
          name: event.target.value })} /></Field>
        <Field label={t('ruleInstruction')}>
          <Textarea rows={4} autoGrow={false} required maxLength={LIMITS.ruleInstruction} value={rule.instruction}
            placeholder={t('ruleInstructionPlaceholder')}
            onChange={event => onChange({ ...rule, instruction: event.target.value })} />
        </Field>
        <div className="dt-actions">
          <Button variant="ghost" size="sm" icon={<Icon name="copy" />} onClick={onDuplicate}>{t('duplicate')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="trash" />} onClick={onRemove}>{t('remove')}</Button>
        </div>
      </div>
    </DisclosureRow>
    <Switch className="dt-rule-switch" checked={rule.enabled} onChange={enabled => onChange({ ...rule, enabled })} label={t('ruleEnable',
      { name })} />
  </li>
}

type Part = Record<string, unknown>
function SourcePart({ source, part, saved, dirty, onChange, reload }: {
  source: SourceView; part: Part; saved: Part; dirty: boolean; onChange: (next: Part) => void; reload: () => Promise<void>
}) {
  const { t, call, notify } = usePanel()
  const policy = source.policy!
  const sync = policy.sync
  const run = useAction(() => call('POST policy-sync/:id', { id: source.id }), { reload })
  // Syncing saves the Policy block, so it waits for unsaved edits to be saved or discarded: the button says why it is off (SET-7).
  const syncNow = () => { if (!dirty) void run.run() }
  void notify
  return <div className="dt-part" data-pipeline-block="admission" data-pipeline-part="admission" data-pipeline-title={`${t('term.policy')} · ${localized(t, source.title)}`}>
    {policy.fields.map(field => <SourceField key={field.key} field={field} value={part[field.key]} saved={saved[field.key]} fact={undefined}
      labels={source.labels}
      onChange={next => onChange({ ...part, [field.key]: next })} />)}
    {sync && <div className="dt-row-buttons">
      <Button variant="secondary" size="sm" icon={<Icon name="refresh" />} disabled={run.busy || !sync.ready || dirty} onClick={syncNow}
        title={dirty ? t('syncNeedsSave') : undefined} aria-describedby={dirty ? `${source.id}-sync-why` : undefined}>{localized(t,
        sync.label)}</Button>
      {dirty && <span className="dt-hint" id={`${source.id}-sync-why`}>{t('syncNeedsSave')}</span>}
      {sync.health?.state === 'ready' && sync.health.at && <LabelValue label={t('syncDone')} value={when(sync.health.at, t('lang'))} />}
      {sync.health?.state === 'error' && <span className="dt-error dt-clamp">{sync.health.detail}</span>}
    </div>}
    {policy.rows ? <AdmissionTable rows={policy.rows} labels={source.labels} table={(part.admission ?? {}) as AdmissionTable}
      explicit={localized(t, policy.explicit)}
      onChange={admission => onChange({ ...part, admission })} />
      : <ControlGroup className="dt-field" label={t('explicitRequest')}><span>{localized(t, policy.explicit)}</span></ControlGroup>}
  </div>
}

type AdmissionTable = Record<string, Partial<Record<AdmissionCell, Admission>>>
const CELLS: readonly AdmissionCell[] = ['listedUnaddressed', 'unlistedAddressed', 'unlistedUnaddressed']
function AdmissionTable({ rows, labels, table, explicit, onChange }: {
  rows: AdmissionRowView[]; labels: Record<string,
    string>; table: AdmissionTable; explicit: string; onChange: (table: AdmissionTable) => void
}) {
  const { t } = usePanel()
  const name = (row: AdmissionRowView) => labels[row.id] ?? localized(t, row.label)
  const set = (row: string, cell: AdmissionCell, value: Admission) => onChange({ ...table, [row]: { ...table[row], [cell]: value } })
  const select = (row: AdmissionRowView, cell: AdmissionCell) => {
    const value = table[row.id]?.[cell] ?? ADMISSION_DEFAULTS[cell]
    // Reserve a fixed-width slot for the warning icon so selecting a value never shifts column widths.
    return <td key={cell}><span className="dt-admission-cell">
      <Select size="sm" className="dt-select" label={`${name(row)} · ${t(`admissionCell.${cell}`)}`} value={value} onChange={next => set(row.id, cell, next as Admission)}
        options={ADMISSION_OPTIONS[cell].map(option => ({ value: option as string, label: t(`admissionValue.${option}`) }))} />
      <span className="dt-admission-slot">{cell === 'unlistedAddressed' && value === 'explicit' && <InfoTip
        text={t('admissionAnyoneWarning')} icon="alert" warn />}</span>
    </span></td>
  }
  return <Section title={t('admission')} hint={t('admissionHint')}>
    <Hint>{explicit}</Hint>
    <table className="dt-table dt-admission">
      <thead>
        <tr><th rowSpan={2}>{t('admissionScope')}</th><th>{t('admissionListed')}</th><th colSpan={2}>{t('admissionUnlisted')}</th></tr>
        <tr><th>{t('admissionUnaddressed')}</th><th>{t('admissionAddressed')}</th><th>{t('admissionUnaddressed')}</th></tr>
      </thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td className="dt-admission-scope">{name(row)}<small>{localized(t, row.note)}</small></td>
        {CELLS.map(cell => row.cells[cell] ? select(row, cell) : <td key={cell} className="dt-admission-na"
          aria-label={t('admissionNotReceived')}>—</td>)}
      </tr>)}</tbody>
    </table>
    <Hint>{t('admissionFootnote')}</Hint>
  </Section>
}

function PolicyBlock() {
  const { t, notify } = usePanel()
  const { settings: { blocks, sources, policyVersion }, reload } = useSettings()
  const draft = useBlockDraft('policy', blocks.policy.value, blocks.policy.revision)
  const policy = draft.value
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const parts = sources.filter(source => source.installed && source.policy)
  const [tab, setTab] = useState<string>()
  const current = parts.find(source => source.id === tab) ?? parts[0]
  const edit = (next: Partial<typeof policy>) => draft.edit({ ...policy, ...next })
  const toggle = (id: string) => { const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id); setExpanded(next) }
  const insert = (rule: Rule, at: number) => {
    setExpanded(new Set([...expanded, rule.id]))
    edit({ rules: [...policy.rules.slice(0, at), rule, ...policy.rules.slice(at)] })
  }
  // Expand all rules when native form validation fails inside a collapsed rule.
  const reveal = (target: EventTarget) => { if (target instanceof Element
    && target.closest('.dt-rules')) setExpanded(new Set(policy.rules.map(rule => rule.id))) }
  const part = (id: string) => (policy.sources[id] ?? { allowed: [] }) as Part
  const add = () => insert({ id: crypto.randomUUID(), name: '', enabled: true, instruction: '' }, policy.rules.length)
  return <form className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}
    onInvalidCapture={event => reveal(event.target)} data-pipeline-block="policy" data-pipeline-part="policy" data-pipeline-title={t('term.policy')}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('term.policy')}<InfoTip text={t('policyIntro')} /></h2>
      <p className="dt-flow">
        <LabelValue label={t('policyVersion')} value={<span className="dt-mono">{policyVersion.slice(0, 8)}</span>} /><InfoTip
          text={t('policyVersionHint')} />
      </p>
      <Section title={t('rules')} hint={t('rulesHint')} action={<Button variant="ghost" size="sm" icon={<Icon name="plus" />}
        onClick={add}>{t('addRule')}</Button>}>
        {policy.rules.length ? <ul className="dt-rules">{policy.rules.map((rule, index) => <RuleRow key={rule.id} rule={rule}
          expanded={expanded.has(rule.id)}
          onToggle={() => toggle(rule.id)} onChange={next => edit({ rules: policy.rules.map((item, position) => position === index ? next
            : item) })}
          onDuplicate={() => insert({ ...rule, id: crypto.randomUUID(), name: `${rule.name}${t('copySuffix')}`.slice(0, LIMITS.ruleName) },
            index + 1)}
          onRemove={() => {
            const before = policy.rules
            edit({ rules: policy.rules.filter((_, position) => position !== index) })
            notify(t('rowRemoved', { name: rule.name || t('rules') }), 'info', { label: t('undo'), onClick: () => edit({ rules: before }) })
          }} />)}</ul>
            : <Empty icon="filter" action={<Button variant="secondary" size="sm" icon={<Icon name="plus" />} onClick={add}>{t('addRule')}</Button>}>
              {t('rulesEmpty')}</Empty>}
      </Section>
      {current && <Section title={t('policyPerSource')} hint={t('policyPerSourceHint')}>
        {parts.length > 1 && <Tabs className="dt-subtabs" size="sm" idBase="dt-policy-source" label={t('policyPerSource')} value={current.id}
          onChange={setTab} items={parts.map(source => ({ value: source.id, label: localized(t, source.title) }))} />}
        {/* With one source there is no tab bar, so its part stands alone instead of as a tab panel. */}
        {(sourcePart => parts.length > 1 ? <TabPanel idBase="dt-policy-source" value={current.id} active className="dt-subpanel">{sourcePart}</TabPanel>
          : sourcePart)(<SourcePart key={current.id} source={current} part={part(current.id)}
          saved={(blocks.policy.value.sources[current.id] ?? {}) as Part} dirty={draft.dirty}
          reload={reload} onChange={next => edit({ sources: { ...policy.sources,
            [current.id]: next as typeof policy.sources[string] } })} />)}
      </Section>}
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

function EvalBlock() {
  const { t } = usePanel()
  const block = useSettings().settings.blocks.eval
  const saved = { ...block.value, timeoutSeconds: String(block.value.timeoutSeconds) }
  const draft = useBlockDraft('eval', saved, block.revision, value => ({ ...value, timeoutSeconds: numberOf(value.timeoutSeconds) }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  return <form className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }} data-pipeline-block="eval"
    data-pipeline-title={t('evalSettings')}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('evalSettings')}<InfoTip text={t('evalIntro')} /></h2>
      <Section title={t('acceptMode')} hint={t(`modeOption.${value.mode}`)}>
        <SegmentedControl label={t('acceptMode')} value={value.mode} onChange={mode => edit({ mode })}
          options={(['off', 'observe', 'auto'] as const).map(mode => ({ value: mode, label: valueLabel(t, 'mode', mode),
            title: t(`modeOption.${mode}`) }))} />
      </Section>
      <Field label={t('evalTimeout')} hint={t('evalTimeoutHint')}>
        <Input type="number" min={LIMITS.evalTimeoutSeconds.min} max={LIMITS.evalTimeoutSeconds.max} required value={value.timeoutSeconds}
          onChange={event => edit({ timeoutSeconds: event.target.value })} />
      </Field>
      <div data-pipeline-part="main-model"><Section title={t('assessorModel')} hint={t('assessorModelHint')}>
        <ModelField id="dt-eval-model" value={value.model} onChange={model => edit({ model })} />
      </Section></div>
      <AgentPresetField role="orchestrator" value={value.agentPreset} saved={block.value.agentPreset}
        onChange={agentPreset => edit({ agentPreset })} />
      <AgentOverlayField role="orchestrator" value={value.overlays} saved={block.value.overlays} onChange={overlays => edit({ overlays })} />
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function EvalSettings({ version }: { version?: string | undefined }) {
  return <div className="dt-form">
    <PolicyBlock />
    <EvalBlock />
    <ConfigHistory blocks={['policy', 'eval']} versions {...version ? { focus: version } : {}} />
  </div>
}
