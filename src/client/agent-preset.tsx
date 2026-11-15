/** The agent preset picker of the main Session (Eval settings) and the Executor (Execution settings): one card per preset DSH offers. */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { useLive } from './live.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { errorText } from './text.ts'
import { Button, FieldHead, FieldHint, FieldRoot, FormField, InfoTip, Input, Label, Tag, useFieldControl } from './ui/index.ts'

type Catalog = ApiResponse<'GET agent-presets'>
type Role = 'worker' | 'orchestrator'
/**
 * A radio group of the presets DSH's registry lists, the one each role may not run under shown disabled with why. A preset the
 * registry does not list (a team's own, registered in another profile) can be named by id.
 */
export function AgentPresetField({ role, value, saved, onChange }: { role: Role; value: string; saved: string; onChange: (next: string) => void }) {
  const { t, call } = usePanel()
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState<string>()
  const [custom, setCustom] = useState('')
  const { restarts } = usePanelData()
  // The registry changes with the profile's plugins and restarts: reload the catalog then, and on a settings save anywhere.
  const load = () => { call('GET agent-presets').then(next => { setCatalog(next); setError(undefined) }, failure => setError(errorText(failure))) }
  useEffect(load, [call, restarts]) // eslint-disable-line react-hooks/exhaustive-deps
  useLive(['settings', 'health'], load)
  const presets = catalog?.presets ?? []
  const rows = presets.some(preset => preset.id === value) || !value ? presets
    : [...presets, { id: value, name: value, description: '', builtin: false, compatible: { worker: true, orchestrator: true },
      notes: {} }]
  const enabled = rows.filter(preset => preset.compatible[role])
  const label = t('agentPreset')
  // The cards are the field's control (a radio group named by the label, described by the note); the id box below is its own control.
  return <div className="dt-field dt-preset-field" data-pipeline-part={role === 'worker' ? 'executor-preset' : 'main-preset'}>
    <FormField label={label}><FieldRoot>
      <FieldHead><Label>{label}</Label><InfoTip text={t(role === 'worker' ? 'agentPresetWorkerHint' : 'agentPresetMainHint')} /></FieldHead>
      {error && <p className="dt-error">{error} <Button variant="ghost" size="sm" onClick={load}>{t('retry')}</Button></p>}
      {!catalog && !error && <div className="dt-preset-grid" aria-busy="true">
        {[0, 1, 2].map(index => <span key={index} className="dt-skeleton dt-preset-card" />)}
      </div>}
      {catalog && <PresetCards label={label} enabled={enabled.map(preset => preset.id)} value={value}
        onChange={onChange}>{rows.map(preset => {
        const checked = preset.id === value, allowed = preset.compatible[role]
        const note = preset.notes[role]
        return <button key={preset.id} data-preset={preset.id} type="button" role="radio" aria-checked={checked} disabled={!allowed}
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
      })}</PresetCards>}
      {value !== saved && <FieldHint>{t('agentPresetApplies')}</FieldHint>}
    </FieldRoot></FormField>
    <div className="dt-preset-custom">
      <Input className="dt-mono" aria-label={t('agentPresetCustom')} placeholder={t('agentPresetCustomPlaceholder')} spellCheck={false}
        value={custom} onChange={event => setCustom(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && custom.trim()) { event.preventDefault(); onChange(custom.trim()); setCustom('') } }} />
      <Button variant="secondary" size="sm" disabled={!custom.trim()} onClick={() => { onChange(custom.trim()); setCustom('') }}>
        {t('agentPresetUse')}</Button>
    </div>
  </div>
}
/** The preset cards as the field's radio group: arrows choose among the presets the role may run under, focus following. */
function PresetCards({ label, enabled, value, onChange, children }: {
  label: string; enabled: string[]; value: string; onChange: (next: string) => void; children: ReactNode
}) {
  const control = useFieldControl({ label }, { labelable: false })
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (!step || !enabled.length) return
    event.preventDefault()
    const index = enabled.indexOf(value)
    const next = enabled[(index + step + enabled.length) % enabled.length]!
    onChange(next)
    const grid = event.currentTarget
    requestAnimationFrame(() => [...grid.querySelectorAll<HTMLElement>('[data-preset]')].find(card => card.dataset.preset === next)?.focus())
  }
  return <div className="dt-preset-grid" role="radiogroup" id={control.id} aria-label={control.ariaLabel} aria-labelledby={control.labelledBy}
    aria-describedby={control.describedBy} aria-required={control.required || undefined} aria-invalid={control.invalid || undefined}
    onKeyDown={move}>{children}</div>
}
