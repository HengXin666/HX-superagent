/** Shared settings context, block draft hook, form controls, Source schema field renderer, and configuration history. */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { FieldSpec, Localized } from '../sources/kind.ts'
import { usePoll, type HistoryView, type Settings, type SettingsView, type SourceView } from './api.ts'
import { useDraft } from './draft.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { useLive } from './live.ts'
import { settingsRoute } from './route.ts'
import { errorText, localized, valueLabel, when, type T } from './text.ts'
import { Hint, LoadState, Empty } from './widgets.tsx'
import { Badge, Combobox, Button, ControlGroup, DisclosureRow, FieldHead, FieldRoot, FormField, Icon, InfoTip, Input, Label, SegmentedControl, Switch,
  Select, Field as UiField, type FieldProps } from './ui/index.ts'

/** Parse a numeric input string, returning `null` when empty so the server rejects blank required numbers instead of coercing to 0. */
export const numberOf = (text: string): number | null => text.trim() ? Number(text) : null
interface SettingsData { settings: SettingsView; reload: () => Promise<void> }
const SettingsContext = createContext<SettingsData | undefined>(undefined)
export function useSettings(): SettingsData {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('A settings block rendered outside the settings')
  return value
}
/** The settings the page shares, or `undefined` outside a settings provider. */
export function useSettingsMaybe(): SettingsData | undefined { return useContext(SettingsContext) }
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { call } = usePanel()
  const { restarts } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET settings'), [call, restarts], undefined, { live: ['settings', 'health'] })
  if (!data) return <LoadState error={error} loading onRetry={() => { void reload() }} />
  return <SettingsContext.Provider value={{ settings: data, reload }}>
    <LoadState error={error} loading={false} have />
    {children}
  </SettingsContext.Provider>
}
export function useBlockDraft<V>(block: string, saved: V, revision: number, toValue: (draft: V) => unknown = draft => draft) {
  const { t, call, notify } = usePanel()
  const { reload } = useSettings()
  return useDraft({ key: `dsh-superagent/draft/${block}`, saved, revision, reload, save: async (value, from) => {
    const result = await call('PUT settings/:block', { block, body: { value: toValue(value), revision: from } })
    notify(t(result.restarting ? 'savedRestarting' : 'saved'))
    return result
  } })
}

/** Fieldset wrapper that restores focus to the previously active input after a save completes and re-enables the form. */
export function Fields({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const set = useRef<HTMLFieldSetElement>(null)
  const focused = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const active = document.activeElement
    if (disabled) focused.current = active instanceof HTMLElement && set.current?.contains(active) ? active : null
    else if (focused.current && (!active
      || active === document.body)) { focused.current.focus({ preventScroll: true }); focused.current = null }
  }, [disabled])
  return <fieldset ref={set} className="dt-fieldset" disabled={disabled}>{children}</fieldset>
}
/**
 * A settings form row: the library's Field (label wired to its control, help tip, note under it, error), with `dt-field` as the
 * page's hook, which the pipeline map reads a focused control's place from.
 */
export function Field({ label, hint, note, className, ...rest }: { label: string; hint?: string | undefined; note?: ReactNode }
  & Omit<FieldProps, 'label' | 'info' | 'hint'>) {
  return <UiField className={className ? `dt-field ${className}` : 'dt-field'} label={label} info={hint} hint={note} {...rest} />
}
/** A switch under its label, the same field atoms around it; `dt-switch-row` is the page's hook for it. */
function SwitchRow({ label, hint, checked,
  onChange }: { label: string; hint?: string | undefined; checked: boolean; onChange: (next: boolean) => void }) {
  return <UiField className="dt-switch-row" label={label} info={hint}><Switch checked={checked} onChange={onChange} label={label} /></UiField>
}
type RoleModel = Settings['eval']['model']
/**
 * A role's model as three linked choices (SET-10): provider, then that provider's models, then that model's reasoning efforts, each
 * from the host's catalog with "inherit the default" first. A value the catalog does not list can still be typed, and is marked.
 */
export function ModelField({ id, value, onChange }: { id: string; value: RoleModel; onChange: (next: RoleModel) => void }) {
  const { t, call } = usePanel()
  const [catalog, setCatalog] = useState<ApiResponse<'GET models'>>()
  const [error, setError] = useState<string>()
  const { restarts } = usePanelData()
  // A provider's models change with its configuration, which takes a restart: read the catalog again after one.
  const load = () => { call('GET models').then(next => { setCatalog(next); setError(undefined) }, failure => setError(errorText(failure))) }
  useEffect(load, [call, restarts]) // eslint-disable-line react-hooks/exhaustive-deps
  // A model going unavailable or a provider's settings saved elsewhere change the catalog: read it again at once.
  useLive(['health', 'settings'], load)
  const current = { provider: value?.provider ?? '', model: value?.model ?? '', effort: value?.reasoningEffort ?? '' }
  const set = (next: Partial<typeof current>) => {
    const { provider, model, effort } = { ...current, ...next }
    onChange(provider.trim() || model.trim() || effort.trim() ? { provider, model, ...effort ? { reasoningEffort: effort } : {} } : null)
  }
  const group = catalog?.groups.find(item => item.id === current.provider.trim())
  const models = group?.models ?? []
  const model = models.find(item => item.id === current.model.trim())
  const efforts = model?.reasoning?.efforts ?? []
  const fallback = catalog?.default
  const INHERIT = '' as const
  const choice = (name: keyof typeof current, label: string, inherit: string, options: { value: string; label: string }[],
    known: boolean, onPick: (next: string) => void) => <Field label={label} htmlFor={`${id}-${name}`}
    aside={current[name] && catalog && !known && <Badge tone="warning" title={t('modelNotInCatalogHint')}>{t('modelNotInCatalog')}</Badge>}>
    <Combobox size="sm" label={label} allowCustom value={current[name] || INHERIT}
      options={[{ value: INHERIT, label: inherit }, ...options]} onChange={next => onPick(next.trim())} />
  </Field>
  return <div className="dt-model" data-model-id={id}>
    <Hint>{fallback ? t('defaultModel', { model: `${fallback.provider} / ${fallback.model}${fallback.reasoningEffort
      ? ` · ${fallback.reasoningEffort}` : ''}` }) : t('defaultModelUnavailable')}</Hint>
    {error && <p className="dt-error">{t('modelCatalogError', { error })} <Button variant="ghost" size="sm" onClick={load}>{t('retry')}</Button></p>}
    <div className="dt-grid3">
      {choice('provider', t('modelProvider'), t('modelInherit'), catalog?.groups.map(item => ({ value: item.id, label: item.name })) ?? [],
        !!group, next => set(next === current.provider ? {} : { provider: next, model: '', effort: '' }))}
      {choice('model', t('modelName'), t('modelInherit'), models.map(item => ({ value: item.id, label: item.name })), !!model,
        next => set(next === current.model ? {} : { model: next, effort: '' }))}
      {choice('effort', t('modelEffort'), t('modelEffortDefault'), efforts.map(item => ({ value: item.id, label: item.name })),
        efforts.some(item => item.id === current.effort), next => set({ effort: next }))}
    </div>
  </div>
}

type HistoryChange = NonNullable<HistoryView['items'][number]['changes']>[number]
function changeText(t: T, change: HistoryChange, sources: SourceView[]): string {
  const source = sources.find(item => item.id === change.source)
  const field = (change.part ? source?.policy?.fields : source?.fields)?.find(item => item.key === change.field)
  const shown = (value: unknown) => value === undefined || value === null || value === '' ? t('unsetValue') : typeof value === 'boolean'
    ? t(value ? 'yes' : 'no')
    : change.code === 'mode' ? valueLabel(t, 'mode', String(value)) : String(value)
  return t(`change.${change.code}`,
    { items: (change.items ?? []).map(item => source?.labels[item] ?? item).join(t('listSeparator')),
    from: shown(change.from), to: shown(change.to), name: change.name ?? '', source: source ? localized(t, source.title)
      : change.source ?? '',
    field: field ? localized(t, field.label) : change.field ?? '' })
}
/**
 * Collapsible revision history for the specified settings blocks, optionally including all Policy-changing saves.
 * Revisions saved before per-block tracking existed have no `block` and appear under `policy`.
 */
export function ConfigHistory({ blocks, versions, focus }: { blocks: string[]; versions?: boolean; focus?: string }) {
  const { t, call } = usePanel()
  const { settings } = useSettings()
  const { sources } = settings
  const [open, setOpen] = useState(!!focus)
  const [data, setData] = useState<HistoryView>()
  const [error, setError] = useState<string>()
  const revisions = JSON.stringify([Object.values(settings.blocks).map(block => block.revision), sources.map(source => source.revision)])
  const [saves, setSaves] = useState(0)
  useEffect(() => { if (open) call('GET policy/history').then(next => { setData(next); setError(undefined) },
    failure => setError(errorText(failure))) }, [open, call, revisions, saves])
  // A save made in another window or by the main Session adds a line while the history is open.
  useLive(['settings'], () => { if (open) setSaves(count => count + 1) })
  const listed = (block: string | undefined) => block ? blocks.some(item => item === block || (item.endsWith(':')
    && block.startsWith(item))) : blocks.includes('policy')
  const items = data?.items.filter(item => (versions && item.policyChanged) || listed(item.block)) ?? []
  // Match the oldest save that produced the focused Policy version (where that version originated).
  const target = focus ? items.filter(item => item.policyChanged && item.policyVersion.startsWith(focus)).at(-1) : undefined
  const scroll = (element: HTMLLIElement | null) => { if (element
    && !element.dataset.scrolled) { element.dataset.scrolled = '1'; element.scrollIntoView?.({ block: 'center' }) } }
  return <DisclosureRow icon={<Icon name="history" />} title={t('configHistory')} open={open} onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      {error && <p className="dt-error">{error}</p>}
      {data && <>
        <Hint>{t('historyIntro')}</Hint>
        {focus && !target && <Hint>{t('policyVersionUnrecorded', { version: focus.slice(0, 8) })}</Hint>}
        {items.length ? <ul className="dt-timeline">{items.map(item => <li key={item.revision} className={item === target
          ? 'dt-event dt-highlight' : 'dt-event'}
          ref={item === target ? scroll : undefined}>
          <div className="dt-row-title">{t('historyItem', { revision: item.revision, source: valueLabel(t, 'historySource',
            item.source) })}</div>
          <div className="dt-event-foot">{when(item.savedAt, t('lang'))}{item.policyChanged && <> · {t('historyPolicyChanged',
            { version: item.policyVersion.slice(0, 8) })}</>}</div>
          {item.changes === null ? <Hint>{t('historyNoBaseline')}</Hint> : item.changes.length
            ? <ul className="dt-changes">{item.changes.map((change, index) => <li key={index}>{changeText(t, change, sources)}</li>)}</ul>
              : <Hint>{t('historyNoChanges')}</Hint>}
          {item.notified.length > 0 && <Hint>{t('historyNotified', { count: item.notified.length,
            titles: item.notified.map(ticket => ticket.title).join(t('listSeparator')) })}</Hint>}
        </li>)}</ul> : <Empty icon="history">{t('historyEmpty')}</Empty>}
      </>}
    </div>
  </DisclosureRow>
}

type Row = Record<string, string>
type Column = Extract<FieldSpec, { type: 'rows' }>['columns'][number]
const ROWS_SHOWN = 6
const byName = ([, a]: [string, string], [, b]: [string, string]) => a.localeCompare(b)
function RowsField({ field, value, saved, onChange, labels, refreshLabels }: {
  field: Extract<FieldSpec, { type: 'rows' }>; value: unknown; saved: unknown; onChange: (next: unknown) => void; labels: Record<string,
    string>
  refreshLabels: (() => Promise<string[]>) | undefined
}) {
  const { t, notify } = usePanel()
  const [open, setOpen] = useState(false)
  const refresh = useAction(async () => {
    try {
      const added = await refreshLabels!()
      notify(added.length ? t('labelsAdded', { names: added.join(t('listSeparator')) }) : t('labelsCurrent'))
    } catch (failure) { notify(t('labelsFailed', { error: errorText(failure) })) }
  })
  const label = localized(t, field.label), hint = localized(t, field.hint)
  const rows = Array.isArray(value) ? value as Row[] : []
  // Each row keeps its own key while rows around it are removed, so the inputs below it keep their state (SRC-6).
  const ids = useRef<string[]>([])
  const counter = useRef(0)
  if (ids.current.length !== rows.length) ids.current = rows.map((_, index) => ids.current[index] ?? `row-${counter.current++}`)
  const remove = (index: number) => {
    const before = rows, beforeIds = ids.current
    ids.current = ids.current.filter((_, position) => position !== index)
    onChange(rows.filter((_, position) => position !== index))
    notify(t('rowRemoved', { name: rowName(rows[index]!) || label }), 'info', { label: t('undo'), onClick: () => { ids.current = beforeIds; onChange(before) } })
  }
  const set = (index: number, row: Row) => onChange(rows.map((item, position) => position === index ? row : item))
  const key = field.columns[0]!
  const savedKeys = new Set((Array.isArray(saved) ? saved as Row[] : []).map(row => row[key.key]))
  const choose = key.type === 'text' && key.choose && Object.keys(labels).length ? localized(t, key.choose) : ''
  // Exclude options already selected in another row.
  const choices = (id: string) => Object.entries(labels).filter(([option]) => option === id
    || !rows.some(other => other[key.key] === option)).sort(byName)
  const blank = Object.fromEntries(field.columns.map(column => [column.key, column.type === 'select' ? column.options[0]!.value : '']))
  // Summarize a row by its second column only when that column is free text (e.g., a display name), not a select option.
  const named = field.columns[1]?.type === 'text' ? field.columns[1] : undefined
  const rowName = (row: Row) => (named && row[named.key]) || labels[row[key.key] ?? ''] || row[key.key] || ''
  const cell = (row: Row, index: number, column: Column) => {
    const id = row[key.key] ?? '', change = (next: string) => set(index, { ...row, [column.key]: next })
    if (column === key && (savedKeys.has(id) || (!choose && labels[id]))) {
      return <span key={column.key} className={labels[id] ? 'dt-row-label' : 'dt-row-label dt-mono'} title={id}>{labels[id] ?? id}</span>
    }
    if (column === key && choose) {
      return <Select size="sm" className="dt-select" key={column.key} label={choose} placeholder={choose} value={id || undefined} onChange={change}
        options={choices(id).map(([option, name]) => ({ value: option, label: name }))} />
    }
    if (column.type === 'select') {
      return <Select size="sm" className="dt-select" key={column.key} label={localized(t, column.label)} value={row[column.key] ?? ''} onChange={change}
        options={column.options.map(option => ({ value: option.value, label: localized(t, option.label) }))} />
    }
    return <Input key={column.key} className={column.optional ? undefined : 'dt-mono'} aria-label={localized(t, column.label)}
      placeholder={localized(t, column.label)}
      required={!column.optional} pattern={column.pattern} spellCheck={false} value={row[column.key] ?? ''}
        onChange={event => change(event.target.value)} />
  }
  // One named group: its rows' controls keep their own names (column · row), the label and help tip name the whole list.
  return <FormField group label={label}><FieldRoot className="dt-field">
    <div className="dt-subhead">
      <FieldHead><Label>{label}</Label>{hint && <InfoTip text={hint} />}<span className="dt-count">{rows.length || ''}</span></FieldHead>
      <span className="dt-subhead-actions">
        {key.type === 'text' && key.refresh && refreshLabels && <Button variant="ghost" size="sm" busy={refresh.busy}
          icon={<Icon name="refresh" />} onClick={() => { void refresh.run() }}>{localized(t, key.refresh)}</Button>}
        <Button variant="ghost" size="sm" icon={<Icon name="plus" />} onClick={() => { setOpen(true)
          ids.current = [...ids.current, `row-${counter.current++}`]; onChange([...rows, blank]) }}>{t('addRow')}</Button>
      </span>
    </div>
    {rows.length > ROWS_SHOWN && <button type="button" className="dt-textlink dt-rows-summary" aria-expanded={open}
      onClick={() => setOpen(!open)}>
      {open ? t('collapse') : t('rowsSummary', { count: rows.length, names: rows.slice(0, 3).map(rowName).join(t('listSeparator')) })}
    </button>}
    {(rows.length <= ROWS_SHOWN || open) && <ul className="dt-rows"
      style={{ ['--dt-columns' as string]: field.columns.length }}>{rows.map((row, index) => <li key={ids.current[index]} className="dt-rows-item">
      {field.columns.map(column => cell(row, index, column))}
      <Button variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={t('removeRow', { name: labels[row[key.key] ?? '']
        || row[key.key] || label })}
        onClick={() => remove(index)} />
    </li>)}</ul>}
  </FieldRoot></FormField>
}
export function SourceField({ field, value, saved, fact, onChange, labels, refreshLabels }: {
  field: FieldSpec; value: unknown; saved: unknown; fact: Localized | string | undefined; onChange: (next: unknown) => void
  labels: Record<string, string>
  refreshLabels?: () => Promise<string[]>
}) {
  const { t, navigate } = usePanel()
  const label = localized(t, field.label), hint = localized(t, field.hint)
  switch (field.type) {
    case 'switch': return <SwitchRow label={label} hint={hint} checked={value === true} onChange={onChange} />
    case 'select': return <Field label={label} hint={hint}>
      <SegmentedControl className="dt-field-segmented" label={label} value={String(value ?? field.options[0]!.value)}
        options={field.options.map(option => ({ value: option.value, label: localized(t, option.label) }))} onChange={onChange} />
    </Field>
    case 'number': return <Field label={label} hint={hint}>
      <Input type="number" min={field.min} max={field.max} required value={String(value ?? '')}
        onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
    </Field>
    case 'text': return <Field label={label} hint={hint} note={localized(t, fact)}>
      {field.choose && Object.keys(labels).length
        ? <Select size="sm" className="dt-select" label={label} value={String(value ?? '')} onChange={onChange} options={[{ value: '', label: localized(t, field.choose) },
          ...value && !labels[String(value)] ? [{ value: String(value), label: String(value) }] : [],
          ...Object.entries(labels).sort(byName).map(([option, name]) => ({ value: option, label: name }))]} />
        : <Input value={String(value ?? '')} readOnly={field.readonly} pattern={field.pattern} spellCheck={false}
          onChange={event => onChange(event.target.value)} />}
    </Field>
    case 'fact': return <ControlGroup className="dt-field" label={label} info={hint}>
      <span className="dt-mono">{localized(t, fact) || t('empty')}</span>
      {field.settings && <small>
        <button type="button" className="dt-textlink"
          onClick={() => navigate(settingsRoute(field.settings!))}>{t(`openSettingsOf.${field.settings}`)}</button>
      </small>}
    </ControlGroup>
    case 'rows': return <RowsField field={field} value={value} saved={saved} onChange={onChange} labels={labels}
      refreshLabels={refreshLabels} />
  }
}
