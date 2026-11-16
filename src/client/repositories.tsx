/** Repository table of the GitHub Source: one extra GitHub instance per repository, added one by one or pasted in bulk, saved together. */
import { useMemo, useState } from 'react'
import { SaveBar, useDraft } from './draft.tsx'
import { usePanel, usePanelData } from './provider.tsx'
import { useSettings } from './settings-kit.tsx'
import { Hint } from './widgets.tsx'
import { Button, Field, Icon, Input, Switch, Select, Textarea } from './ui/index.ts'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
/** A pattern such as `owner/**`: saving adds every repository of that owner the agent account can push to. */
const PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.*-]*\*[A-Za-z0-9_.*-]*$/
const ENTRY = new RegExp(`(?:${REPOSITORY.source.slice(1, -1)})|(?:${PATTERN.source.slice(1, -1)})`)
const readable = (name: string) => REPOSITORY.test(name) || PATTERN.test(name)
/** What every repository of the table receives besides what addresses the agent, set once for all of them. */
export const OBSERVED = ['observeIssues', 'observePulls', 'observeComments'] as const
export type Observed = typeof OBSERVED[number]
/** A row of the table: `id` names an existing instance, and a row without one becomes a new instance when saved. */
export interface RepositoryRow { id?: string; repository: string; enabled: boolean; observe?: Partial<Record<Observed, boolean>> }
/**
 * Reads pasted repositories: one per line, or separated by spaces or commas, written owner/name, as a pattern such as owner/** (every
 * repository of the owner the agent account can push to, expanded when saved), or as a github.com page (the repository, an Issue or a PR in it). Returns the repositories in order, without repeats, and the entries it could not read.
 */
export function parseRepositories(text: string): { repositories: string[]; invalid: string[] } {
  const repositories: string[] = [], invalid: string[] = []
  for (const entry of text.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)) {
    const page = /^(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(entry)?.[1]
    const name = page ?? entry.replace(/\.git$/, '')
    if (!readable(name)) { invalid.push(entry); continue }
    if (!repositories.some(item => item.toLowerCase() === name.toLowerCase())) repositories.push(name)
  }
  return { repositories, invalid }
}
/** Rows that repeat the default instance's repository or one another, case-insensitively, by repository. */
export function repeatedRepositories(rows: readonly RepositoryRow[], primary: string): string[] {
  const seen = new Set(primary ? [primary.toLowerCase()] : [])
  const repeated: string[] = []
  for (const row of rows) {
    const name = row.repository.trim().toLowerCase()
    if (!name) continue
    if (seen.has(name)) repeated.push(row.repository.trim()); else seen.add(name)
  }
  return repeated
}

let fresh = 0
/** A temporary id for a row not saved yet, so React and the draft merge can tell rows apart; it never reaches the server. */
const freshId = () => `${NEW}${Date.now().toString(36)}-${++fresh}`
const NEW = 'new:'
const isNew = (row: RepositoryRow) => !row.id || row.id.startsWith(NEW)

/**
 * The repository list is a settings block like any other: edits are a draft kept in this tab's session storage (and guarded on
 * unload), saved through the shared save bar, merged three ways with a concurrent change, and a save that restarts the plugin
 * goes through the panel's restart flow.
 */
export function RepositoryTable() {
  const { t, call, notify } = usePanel()
  const { running } = usePanelData()
  const { settings, reload } = useSettings()
  const primary = settings.sources.find(source => source.id === 'github' && !source.extra)
  const saved = useMemo<RepositoryRow[]>(() => settings.sources.filter(source => source.kind === 'github' && source.extra)
    .map(source => ({ id: source.id, repository: String(source.value.config.repository ?? ''), enabled: source.value.enabled,
      observe: Object.fromEntries(OBSERVED.map(key => [key, source.value.config[key] === true])) })),
  [settings.sources])
  const block = settings.instances.github
  const [bulk, setBulk] = useState('')
  const [template, setTemplate] = useState('github')
  const [invalid, setInvalid] = useState<string[]>()
  const draft = useDraft<RepositoryRow[]>({ key: 'dsh-superagent/draft/instances:github', saved,
    revision: block?.revision, reload, save: async (rows, revision) => {
      const policyFrom = template || undefined
      // An existing instance keeps its own switches and gateway, which its card edits; the table changes its repository list only.
      // The table's switches for what every repository receives apply to each row; a new row receives all three unless switched off.
      const configOf = (row: RepositoryRow) => ({ ...settings.sources.find(source => source.id === row.id)?.value.config ?? {},
        ...Object.fromEntries(OBSERVED.map(key => [key, row.observe?.[key] ?? true])), repository: row.repository.trim() })
      const result = await call('PUT sources/:kind/instances', { kind: 'github', body: { revision, rows: rows.map(row => ({
        ...isNew(row) ? {} : { id: row.id }, enabled: row.enabled, config: configOf(row),
        ...isNew(row) && policyFrom ? { policyFrom } : {} })) } })
      notify(t(result.restarting ? 'savedRestarting' : 'saved'))
      return result
    } })
  if (!primary || !block) return null
  const current = draft.value
  const busy = draft.busy
  const primaryRepository = String(primary.value.config.repository ?? '')
  const repeated = repeatedRepositories(current, primaryRepository)
  const malformed = current.filter(row => !readable(row.repository.trim())).map(row => row.repository || '—')
  // A switch is on when every repository of the table has it on; switching it sets it on every one.
  const observing = (key: Observed) => current.length > 0 && current.every(row => row.observe?.[key] ?? true)
  const observeAll = (key: Observed, on: boolean) => edit(current.map(row => ({ ...row, observe: { ...row.observe, [key]: on } })))
  const full = current.length + 1 >= block.max
  const edit = (next: RepositoryRow[]) => { draft.edit(next); setInvalid(undefined) }
  const add = () => {
    const row: RepositoryRow = { id: freshId(), repository: '', enabled: true, observe: Object.fromEntries(OBSERVED.map(key => [key, true])) }
    edit([...current, row])
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-repository-row="${row.id}"] input`)?.focus())
  }
  const addBulk = () => {
    const { repositories, invalid: unread } = parseRepositories(bulk)
    const known = new Set([primaryRepository, ...current.map(row => row.repository)].map(name => name.trim().toLowerCase()))
    const added = repositories.filter(name => !known.has(name.toLowerCase())).map(repository => ({ id: freshId(), repository, enabled: true,
      observe: Object.fromEntries(OBSERVED.map(key => [key, true])) }))
    edit([...current, ...added].slice(0, block.max - 1))
    setBulk('')
    if (unread.length) setInvalid(unread)
  }
  const templates = settings.sources.filter(source => source.kind === 'github')
  const blocked = repeated.length > 0 || malformed.length > 0
  return <form id="dt-source-github-repositories" className="dt-card" aria-label={t('repositoriesTitle')}
    onSubmit={event => { event.preventDefault(); if (!blocked) void draft.submit() }}>
    <div className="dt-card-head"><div className="dt-row-main"><div className="dt-row-title">
      <span className="dt-card-title">{t('repositoriesTitle')}</span><span className="dt-count">{current.length + 1}</span>
    </div></div>
    <div className="dt-row-buttons">
      <Button variant="primary" size="sm" icon={<Icon name="plus" />} disabled={busy || full} onClick={add}>{t('addRepo')}</Button>
    </div></div>
    <Hint>{t('repositoriesHint', { max: block.max })}</Hint>
    <ul className="dt-rows" style={{ ['--dt-columns' as string]: 2 }}>
      <li className="dt-rows-item"><span className="dt-row-label dt-mono">{primaryRepository || '—'}</span>
        <span className="dt-hint">{t('repositoriesDefault')}</span></li>
      {current.map((row, index) => <li key={row.id ?? `row-${index}`} className="dt-rows-item" data-repository-row={row.id}>
        <Input className="dt-mono" aria-label={t('repositoriesRepository')} placeholder="owner/name · owner/**" spellCheck={false} required
          pattern={ENTRY.source} value={row.repository} disabled={busy || !isNew(row)}
          onChange={event => edit(current.map((item, position) => position === index ? { ...item, repository: event.target.value } : item))} />
        <Switch checked={row.enabled} label={t('repositoriesEnabled', { name: row.repository || '—' })}
          onChange={enabled => edit(current.map((item, position) => position === index ? { ...item, enabled } : item))} />
        <Button variant="ghost" size="sm" icon={<Icon name="trash" />} disabled={busy}
          aria-label={t('removeRow', { name: row.repository || t('repositoriesRepository') })}
          onClick={() => edit(current.filter((_, position) => position !== index))} />
      </li>)}
    </ul>
    <Field className="dt-field" label={t('repositoriesObserve')}>
      <div className="dt-row-buttons">
        {OBSERVED.map(key => <Switch key={key} checked={observing(key)} disabled={busy || !current.length}
          label={t(`repositoriesObserve.${key}`)} onChange={on => observeAll(key, on)} />)}
      </div>
    </Field>
    <Field className="dt-field" label={t('repositoriesBulk')}>
      <Textarea className="dt-mono" rows={3} autoGrow={false} spellCheck={false} placeholder={t('repositoriesBulkHint')}
        value={bulk} disabled={busy} onChange={event => setBulk(event.target.value)} />
      <div className="dt-row-buttons">
        <Button variant="ghost" size="sm" disabled={busy || !bulk.trim() || full} onClick={addBulk}>{t('repositoriesBulkAdd')}</Button>
      </div>
    </Field>
    <Field className="dt-field" label={t('repositoriesTemplate')}>
      <Select size="sm" className="dt-select" label={t('repositoriesTemplate')} value={template} disabled={busy} onChange={setTemplate}
        options={[{ value: '', label: t('repositoriesTemplateNone') }, ...templates.map(source => ({ value: source.id,
          label: String(source.value.config.repository || source.id) }))]} />
    </Field>
    {invalid && <p className="dt-error" role="status">{t('repositoriesInvalid', { entries: invalid.join(', ') })}</p>}
    {repeated.length > 0 && <p className="dt-error" role="status">{t('repositoriesRepeated', { entries: repeated.join(', ') })}</p>}
    <SaveBar state={draft.state} dirty={draft.dirty} busy={busy} blocked={blocked} saveLabel={t('repositoriesSave')}
      status={draft.dirty && running > 0 ? t('restartInterrupts', { count: running }) : undefined} onDiscard={() => { draft.discard(); setInvalid(undefined) }} />
  </form>
}
