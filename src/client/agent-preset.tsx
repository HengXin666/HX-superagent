/** The agent preset picker of the main Session (Eval settings) and the Executor (Execution settings): one card per preset DSH offers. */
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { Button, InfoTip, Input, Tag } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { Hint } from './widgets.tsx'

type Catalog = ApiResponse<'GET agent-presets'>
type Role = 'worker' | 'orchestrator'
/**
 * A radio group of the presets DSH's registry lists, the one each role may not run under shown disabled with why. A preset the
 * registry does not list (a team's own, registered in another profile) can be named by id.
 */
export function AgentPresetField({ role, value, saved, onChange }: { role: Role; value: string; saved: string; onChange: (next: string) => void }) {
  const { t, call } = usePanel()
  const id = useId()
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState<string>()
  const [custom, setCustom] = useState('')
  useEffect(() => { call('GET agent-presets').then(setCatalog, failure => setError(errorText(failure))) }, [call])
  const presets = catalog?.presets ?? []
  const rows = presets.some(preset => preset.id === value) || !value ? presets
    : [...presets, { id: value, name: value, description: '', builtin: false, compatible: { worker: true, orchestrator: true },
      notes: {} }]
  const enabled = rows.filter(preset => preset.compatible[role])
  const move = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (!step || !enabled.length) return
    event.preventDefault()
    const index = enabled.findIndex(preset => preset.id === value)
    const next = enabled[(index + step + enabled.length) % enabled.length]!
    onChange(next.id)
    requestAnimationFrame(() => document.getElementById(`${id}-${next.id}`)?.focus())
  }
  const label = t('agentPreset')
  return <div className="dt-field dt-preset-field">
    <span className="dt-field-head" id={`${id}-label`}>{label}<InfoTip text={t(role === 'worker' ? 'agentPresetWorkerHint'
      : 'agentPresetMainHint')} /></span>
    {error && <p className="dt-error">{error}</p>}
    {!catalog && !error && <div className="dt-preset-grid" aria-busy="true">
      {[0, 1, 2].map(index => <span key={index} className="dt-skeleton dt-preset-card" />)}
    </div>}
    {catalog && <div className="dt-preset-grid" role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={move}>
      {rows.map(preset => {
        const checked = preset.id === value, allowed = preset.compatible[role]
        const note = preset.notes[role]
        return <button key={preset.id} id={`${id}-${preset.id}`} type="button" role="radio" aria-checked={checked} disabled={!allowed}
          tabIndex={checked || (!enabled.some(item => item.id === value) && preset === enabled[0]) ? 0 : -1}
          className="dt-preset-card" data-checked={checked || undefined} onClick={() => { if (allowed) onChange(preset.id) }}>
          <span className="dt-preset-card-head">
            <span className="dt-preset-radio" aria-hidden="true" />
            <span className="dt-preset-name">{preset.name}</span>
            <Tag tone={preset.builtin ? 'info' : 'neutral'}>{t(preset.builtin ? 'presetBadge.builtin' : 'presetBadge.custom')}</Tag>
            {preset.id === saved && <Tag tone="success">{t('presetBadge.selected')}</Tag>}
          </span>
          <span className="dt-preset-id dt-mono">{preset.id}</span>
          {preset.description && <span className="dt-preset-desc">{preset.description}</span>}
          {note && <span className={allowed ? 'dt-preset-note' : 'dt-preset-note dt-preset-note-warn'}>{t(`presetNote.${note}` as never)}</span>}
        </button>
      })}
    </div>}
    <div className="dt-preset-custom">
      <Input className="dt-mono" aria-label={t('agentPresetCustom')} placeholder={t('agentPresetCustomPlaceholder')} spellCheck={false}
        value={custom} onChange={event => setCustom(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && custom.trim()) { event.preventDefault(); onChange(custom.trim()); setCustom('') } }} />
      <Button variant="outline" size="sm" disabled={!custom.trim()} onClick={() => { onChange(custom.trim()); setCustom('') }}>
        {t('agentPresetUse')}</Button>
    </div>
    {value !== saved && <Hint>{t('agentPresetApplies')}</Hint>}
  </div>
}
