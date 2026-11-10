/** Repository table of the GitHub Source: one extra GitHub instance per repository, added one by one or pasted in bulk, saved together. */
import { useMemo, useState } from 'react'
import { Button, Icon, Input, Switch } from './controls.tsx'
import { usePanel, usePanelData } from './provider.tsx'
import { useSettings } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
/** A row of the table: `id` names an existing instance, and a row without one becomes a new instance when saved. */
export interface RepositoryRow { id?: string; repository: string; enabled: boolean }
/**
 * Reads pasted repositories: one per line, or separated by spaces or commas, written owner/name or as a github.com page (the
 * repository, an Issue or a PR in it). Returns the repositories in order, without repeats, and the entries it could not read.
 */
export function parseRepositories(text: string): { repositories: string[]; invalid: string[] } {
  const repositories: string[] = [], invalid: string[] = []
  for (const entry of text.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)) {
    const page = /^(?:https?:\/\/)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(entry)?.[1]
    const name = page ?? entry.replace(/\.git$/, '')
    if (!REPOSITORY.test(name)) { invalid.push(entry); continue }
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

export function RepositoryTable() {
  const { t, call } = usePanel()
  const { running } = usePanelData()
  const { settings, reload } = useSettings()
  const primary = settings.sources.find(source => source.id === 'github' && !source.extra)
  const saved = useMemo<RepositoryRow[]>(() => settings.sources.filter(source => source.kind === 'github' && source.extra)
    .map(source => ({ id: source.id, repository: String(source.value.config.repository ?? ''), enabled: source.value.enabled })),
  [settings.sources])
  const block = settings.instances.github
  const [rows, setRows] = useState<RepositoryRow[] | undefined>(undefined)
  const [bulk, setBulk] = useState('')
  const [template, setTemplate] = useState('github')
  const [notice, setNotice] = useState<{ error?: string; invalid?: string[] } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  if (!primary || !block) return null
  const current = rows ?? saved
  const dirty = rows !== undefined && JSON.stringify(rows) !== JSON.stringify(saved)
  const primaryRepository = String(primary.value.config.repository ?? '')
  const repeated = repeatedRepositories(current, primaryRepository)
  const malformed = current.filter(row => !REPOSITORY.test(row.repository.trim())).map(row => row.repository || '—')
  const full = current.length + 1 >= block.max
  const edit = (next: RepositoryRow[]) => { setRows(next); setNotice(undefined) }
  const addBulk = () => {
    const { repositories, invalid } = parseRepositories(bulk)
    const known = new Set([primaryRepository, ...current.map(row => row.repository)].map(name => name.trim().toLowerCase()))
    const added = repositories.filter(name => !known.has(name.toLowerCase())).map(repository => ({ repository, enabled: true }))
    edit([...current, ...added].slice(0, block.max - 1))
    setBulk('')
    if (invalid.length) setNotice({ invalid })
  }
  const save = async () => {
    setBusy(true)
    try {
      const policyFrom = template || undefined
      // An existing instance keeps its own switches and gateway, which its card edits; the table changes its repository list only.
      const configOf = (row: RepositoryRow) => ({ ...settings.sources.find(source => source.id === row.id)?.value.config ?? {},
        repository: row.repository.trim() })
      await call('PUT sources/:kind/instances', { kind: 'github', body: { revision: block.revision, rows: current.map(row => ({
        ...row.id ? { id: row.id } : {}, enabled: row.enabled, config: configOf(row),
        ...!row.id && policyFrom ? { policyFrom } : {} })) } })
      setRows(undefined)
      await reload()
    } catch (failure) { setNotice({ error: errorText(failure) }) }
    finally { setBusy(false) }
  }
  const templates = settings.sources.filter(source => source.kind === 'github')
  return <section id="dt-source-github-repositories" className="dt-card" aria-label={t('repositoriesTitle')}>
    <div className="dt-card-head"><div className="dt-row-main"><div className="dt-row-title">
      <span className="dt-card-title">{t('repositoriesTitle')}</span><span className="dt-count">{current.length + 1}</span>
    </div></div></div>
    <Hint>{t('repositoriesHint', { max: block.max })}</Hint>
    <ul className="dt-rows" style={{ ['--dt-columns' as string]: 2 }}>
      <li className="dt-rows-item"><span className="dt-row-label dt-mono">{primaryRepository || '—'}</span>
        <span className="dt-hint">{t('repositoriesDefault')}</span></li>
      {current.map((row, index) => <li key={row.id ?? `new-${index}`} className="dt-rows-item">
        <Input className="dt-mono" aria-label={t('repositoriesRepository')} placeholder="owner/name" spellCheck={false} required
          pattern={REPOSITORY.source.slice(1, -1)} value={row.repository} disabled={busy || !!row.id}
          onChange={event => edit(current.map((item, position) => position === index ? { ...item, repository: event.target.value } : item))} />
        <Switch checked={row.enabled} label={t('repositoriesEnabled', { name: row.repository || '—' })}
          onChange={enabled => edit(current.map((item, position) => position === index ? { ...item, enabled } : item))} />
        <Button variant="ghost" size="sm" icon={<Icon name="trash" />} disabled={busy}
          aria-label={t('removeRow', { name: row.repository || t('repositoriesRepository') })}
          onClick={() => edit(current.filter((_, position) => position !== index))} />
      </li>)}
    </ul>
    <div className="dt-row-buttons">
      <Button variant="ghost" size="sm" icon={<Icon name="plus" />} disabled={busy || full}
        onClick={() => edit([...current, { repository: '', enabled: true }])}>{t('addRow')}</Button>
    </div>
    <div className="dt-field">
      <span className="dt-field-head">{t('repositoriesBulk')}</span>
      <textarea className="dt-textarea dt-mono" rows={3} spellCheck={false} aria-label={t('repositoriesBulk')} placeholder={t('repositoriesBulkHint')}
        value={bulk} disabled={busy} onChange={event => setBulk(event.target.value)} />
      <div className="dt-row-buttons">
        <Button variant="ghost" size="sm" disabled={busy || !bulk.trim() || full} onClick={addBulk}>{t('repositoriesBulkAdd')}</Button>
      </div>
    </div>
    <label className="dt-field">
      <span className="dt-field-head">{t('repositoriesTemplate')}</span>
      <select className="dt-select" value={template} disabled={busy} onChange={event => setTemplate(event.target.value)}>
        <option value="">{t('repositoriesTemplateNone')}</option>
        {templates.map(source => <option key={source.id} value={source.id}>{String(source.value.config.repository || source.id)}</option>)}
      </select>
    </label>
    {notice?.invalid && <p className="dt-error" role="status">{t('repositoriesInvalid', { entries: notice.invalid.join(', ') })}</p>}
    {repeated.length > 0 && <p className="dt-error" role="status">{t('repositoriesRepeated', { entries: repeated.join(', ') })}</p>}
    {notice?.error && <p className="dt-error" role="status">{notice.error}</p>}
    {dirty && <div className="dt-row-buttons">
      {running > 0 && <span className="dt-hint">{t('restartInterrupts', { count: running })}</span>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRows(undefined); setNotice(undefined) }}>{t('discard')}</Button>
      <Button variant="primary" size="sm" disabled={busy || repeated.length > 0 || malformed.length > 0}
        onClick={() => { void save() }}>{t('repositoriesSave')}</Button>
    </div>}
  </section>
}
