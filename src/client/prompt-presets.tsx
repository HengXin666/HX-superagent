/**
 * The prompt preset bar of the Prompts settings: the presets the draft turns on, in the order they apply, which a person adds
 * several of at once, reorders by dragging or with the keyboard, and removes; and the library where the team writes its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { PromptConfig } from './api.ts'
import { useAction, usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { useLive } from './live.ts'
import { ConfirmButton, Hint, Empty } from './widgets.tsx'
import { CodeEditor } from './code-editor.tsx'
import { MultiSelect, Tabs, Button, Field, Icon, Input, Modal, SegmentedControl, Tag } from './ui/index.ts'

type Library = ApiResponse<'GET prompt-presets'>
export type PresetRow = Library['presets'][number]
type Patch = PresetRow['patch']
const SECTIONS = ['communication', 'scope', 'delivery'] as const
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
/** A stable hue per preset id, so its chip, its marks in the editor and its band in the stack bar share one colour. */
export const presetHue = (id: string): number => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 17)

/** Loads the preset library and reloads it after a save. */
export function usePresetLibrary() {
  const { call } = usePanel()
  const [library, setLibrary] = useState<Library>()
  const [error, setError] = useState<string>()
  const reload = useCallback(async () => { try { setLibrary(await call('GET prompt-presets')); setError(undefined) }
    catch (failure) { setError(errorText(failure)) } }, [call])
  useEffect(() => { void reload() }, [reload])
  // Another person's or tab's save of the presets reaches this library at once.
  useLive(['prompts'], () => { void reload() })
  return { library, error, reload }
}

/** Which sections the presets a draft turns on write, by section name, in order. */
export function presetMarks(config: PromptConfig, library: Library | undefined): Record<string, PresetRow[]> {
  const marks: Record<string, PresetRow[]> = {}
  for (const id of config.presets ?? []) {
    const preset = library?.presets.find(item => item.id === id)
    for (const name of preset?.touches ?? []) (marks[name] ??= []).push(preset!)
  }
  return marks
}
export function PresetSwatch({ preset }: { preset: Pick<PresetRow, 'id' | 'name'> }) {
  return <span className="dt-preset-swatch" title={preset.name} style={{ ['--dt-hue' as string]: presetHue(preset.id) }} />
}

export function PromptPresetBar({ config, library, error, reload, onChange }: {
  config: PromptConfig; library: Library | undefined; error: string | undefined; reload: () => Promise<void>
  onChange: (presets: string[]) => void
}) {
  const { t, notify } = usePanel()
  const [picking, setPicking] = useState(false)
  const [managing, setManaging] = useState(false)
  const active = config.presets ?? []
  const row = (id: string) => library?.presets.find(preset => preset.id === id)
  // The chain is the library's MultiSelect: a drag handle and drop line, Alt+arrows to move with the new place announced, and
  // removal from the chip's button, which a notice can undo (PRM-4).
  const change = (next: string[]) => {
    const removed = active.filter(id => !next.includes(id))
    onChange(next)
    if (removed.length) notify(t('promptPresetRemoved', { name: removed.map(id => row(id)?.name ?? id).join(t('listSeparator')) }), 'info',
      { label: t('undo'), onClick: () => onChange(active) })
  }
  const options = (library?.presets ?? []).map(preset => ({ value: preset.id, label: preset.name }))
  return <section className="dt-preset-bar" aria-label={t('promptPresets')}>
    <div className="dt-preset-bar-head">
      <span className="dt-preset-bar-title"><Icon name="settings" size={14} />{t('promptPresets')}<span className="dt-count">{active.length || ''}</span></span>
      <span className="dt-actions">
        <Button variant="secondary" size="sm" icon={<Icon name="plus" />} disabled={!library} onClick={() => setPicking(true)}>
          {t('promptPresetsPick')}</Button>
        <Button variant="ghost" size="sm" icon={<Icon name="review" />} disabled={!library} onClick={() => setManaging(true)}>
          {t('promptPresetsManage')}</Button>
      </span>
    </div>
    {error && <p className="dt-error">{error}</p>}
    {active.length ? <div className="dt-preset-chain" aria-label={t('promptPresetsOrder')}>
      <MultiSelect options={options} value={active} onChange={change} label={t('promptPresetsOrder')} placeholder={t('promptPresetsAdd')}
        labels={{ remove: name => t('promptPresetRemove', { name }), moved: (name, position, total) => t('promptPresetMoved', { name,
          position, total }), empty: t('none') }}
        renderChip={(option, id) => {
          const preset = row(id)
          return <span className="dt-preset-chip" style={{ ['--dt-hue' as string]: presetHue(id) }}>
            <PresetSwatch preset={{ id, name: option?.label ?? id }} />
            <span className="dt-preset-chip-name">{preset?.name ?? id}</span>
            {preset && <span className="dt-preset-chip-meta">{t(`promptPresetMode.${preset.mode}`)}</span>}
            {!preset && <Tag tone="danger">{t('promptPresetMissing')}</Tag>}
          </span>
        }} />
    </div> : <Empty>{t('promptPresetsNone')}</Empty>}
    {active.length > 1 && <Hint>{t('promptPresetsOrderHint')}</Hint>}
    {library && <PresetPicker open={picking} library={library} active={active} onClose={() => setPicking(false)}
      onApply={next => { change(next); setPicking(false) }} />}
    {library && <PresetLibrary open={managing} library={library} config={config} reload={reload} onClose={() => setManaging(false)} />}
  </section>
}

/** Several presets at once: checking one adds it at the end of the chain, unchecking removes it. */
function PresetPicker({ open, library, active, onClose, onApply }: {
  open: boolean; library: Library; active: string[]; onClose: () => void; onApply: (presets: string[]) => void
}) {
  const { t } = usePanel()
  const [chosen, setChosen] = useState(active)
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) { setChosen(active); setQuery('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = library.presets.filter(preset => !query.trim() || `${preset.name} ${preset.id} ${preset.description}`.toLowerCase()
    .includes(query.trim().toLowerCase()))
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter(item => item !== id) : [...chosen, id])
  return <Modal size="lg" className="dt-preset-modal" open={open} onClose={onClose} title={t('promptPresetsPick')} closeLabel={t('close')}
    description={t('promptPresetsPickHint')} footer={<>
      <span className="dt-hint dt-preset-footer-count">{t('promptPresetsChosen', { count: chosen.length })}</span>
      <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" onClick={() => onApply(chosen)}>{t('promptPresetsApply')}</Button>
    </>}>
    <div className="dt-preset-pick">
      <Input start={<Icon name="search" />} type="search" value={query} placeholder={t('promptPresetsSearch')}
        aria-label={t('promptPresetsSearch')} onChange={event => setQuery(event.target.value)} />
      <ul className="dt-preset-options">{shown.map(preset => {
        const order = chosen.indexOf(preset.id)
        return <li key={preset.id}><button type="button" role="checkbox" aria-checked={order >= 0} className="dt-preset-option"
          style={{ ['--dt-hue' as string]: presetHue(preset.id) }} onClick={() => toggle(preset.id)}>
          <span className="dt-preset-check" aria-hidden="true">{order >= 0 ? order + 1 : ''}</span>
          <span className="dt-preset-option-body">
            <span className="dt-preset-card-head"><span className="dt-preset-name">{preset.name}</span>
              <Tag tone={preset.builtin ? 'info' : 'neutral'}>{t(preset.builtin ? 'presetBadge.builtin' : 'presetBadge.custom')}</Tag>
              <Tag tone="outline">{t(`promptPresetMode.${preset.mode}`)}</Tag></span>
            {preset.description && <span className="dt-preset-desc">{preset.description}</span>}
            <span className="dt-preset-touches">{preset.touches.map(name => <code key={name} className="dt-code">{name}</code>)}</span>
          </span>
        </button></li>
      })}</ul>
      {!shown.length && <Hint>{t('none')}</Hint>}
    </div>
  </Modal>
}

type Editing = { index: number | 'new'; preset: PresetRow }
const blank = (): PresetRow => ({ id: '', name: '', description: '', mode: 'append', patch: {}, touches: [], chars: 0 })
const stored = ({ id, name, description, mode, patch }: PresetRow) => ({ id, name, description, mode, patch })
/** The team's presets: write, copy, import, export and remove them; the bundle's are read-only and can be copied. */
function PresetLibrary({ open, library, config, reload, onClose }: {
  open: boolean; library: Library; config: PromptConfig; reload: () => Promise<void>; onClose: () => void
}) {
  const { t, call, notify } = usePanel()
  const own = useMemo(() => library.presets.filter(preset => !preset.builtin), [library])
  const [editing, setEditing] = useState<Editing>()
  const [pending, setPending] = useState<{ merged: PresetRow[]; added: number; replaced: number }>()
  const file = useRef<HTMLInputElement>(null)
  const save = useAction(async (presets: PresetRow[]) => {
    await call('PUT prompt-presets', { body: { presets: presets.map(stored), revision: library.revision } })
    notify(t('saved')); setEditing(undefined)
  }, { reload })
  const copyOf = (preset: PresetRow): PresetRow => {
    let id = `${preset.id}-copy`.slice(0, 60); for (let n = 2; library.presets.some(item => item.id === id); n++) id = `${preset.id}-${n}`.slice(0, 60)
    return { ...preset, builtin: undefined, id, name: `${preset.name}${t('copySuffix')}` } as PresetRow
  }
  const fromConfig = (): PresetRow => ({ ...blank(), name: t('promptPresetFromDraft'), mode: 'replace',
    patch: { communication: config.communication, scope: config.scope, delivery: config.delivery,
      ...Object.keys(config.skills).length ? { skills: config.skills } : {},
      ...Object.keys(config.overrides ?? {}).length ? { overrides: Object.fromEntries(Object.entries(config.overrides ?? {})
        .map(([key, value]) => [key, { text: value.text }])) } : {} } })
  const exported = () => {
    const blob = new Blob([JSON.stringify(own.map(stored), null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'dsh-superagent.prompt-presets.json'
    link.click(); URL.revokeObjectURL(link.href)
  }
  const imported = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0]; input.value = ''
    if (!chosen) return
    try {
      const value = JSON.parse(await chosen.text()) as unknown
      const rows = (Array.isArray(value) ? value : [value]) as PresetRow[]
      // A preset file is a list of presets, or one configuration as examples/*.prompts.json holds it, imported as one preset.
      const presets = rows.map(row => 'patch' in row ? row : { ...blank(), id: chosen.name.replace(/\..*$/, '').toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 60) || 'imported', name: chosen.name, mode: 'replace' as const,
        patch: row as unknown as Patch })
      // An import that would replace presets of the same id says so and waits for a yes; one that only adds saves at once (PRM-5).
      const merged = [...own.filter(item => !presets.some(preset => preset.id === item.id)), ...presets]
      const replaced = presets.filter(preset => own.some(item => item.id === preset.id)).length
      if (replaced) setPending({ merged, added: presets.length - replaced, replaced }); else await save.run(merged)
    } catch (failure) { notify(t('promptPresetImportFailed', { error: errorText(failure) })) }
  }
  return <Modal className="dt-preset-modal dt-preset-library" open={open} onClose={onClose} title={t('promptPresetsManage')}
    closeLabel={t('close')} description={t('promptPresetsLibraryHint')}>
    {editing ? <PresetEditor editing={editing} taken={library.presets.filter((_, index) => editing.index === 'new'
      || index !== library.presets.indexOf(own[editing.index as number]!)).map(preset => preset.id)} busy={save.busy}
      onCancel={() => setEditing(undefined)}
      onSave={preset => { void save.run(editing.index === 'new' ? [...own, preset] : own.map((item, index) => index === editing.index ? preset : item)) }} />
      : <div className="dt-preset-pick">
        <div className="dt-actions">
          <Button variant="primary" size="sm" icon={<Icon name="plus" />} onClick={() => setEditing({ index: 'new', preset: blank() })}>
            {t('promptPresetNew')}</Button>
          <Button variant="secondary" size="sm" icon={<Icon name="copy" />} onClick={() => setEditing({ index: 'new', preset: fromConfig() })}>
            {t('promptPresetSaveDraft')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="inbox" />} onClick={() => file.current?.click()}>{t('promptPresetImport')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="external" />} disabled={!own.length} onClick={exported}>{t('promptPresetExport')}</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => { void imported(event.currentTarget) }} />
        </div>
        {pending && <div className="dt-banner dt-import-preview" role="alert">
          <span>{t('promptPresetImportPreview', { added: pending.added, replaced: pending.replaced })}</span>
          <span className="dt-banner-actions">
            <Button variant="ghost" size="sm" onClick={() => setPending(undefined)}>{t('cancel')}</Button>
            <Button variant="danger" size="sm" disabled={save.busy} onClick={() => { void save.run(pending.merged).then(() => setPending(undefined)) }}>
              {t('promptPresetImportConfirm')}</Button>
          </span>
        </div>}
        <ul className="dt-preset-options">{library.presets.map(preset => {
          const index = own.indexOf(preset)
          const used = (config.presets ?? []).includes(preset.id)
          return <li key={preset.id} className="dt-preset-option dt-preset-row" style={{ ['--dt-hue' as string]: presetHue(preset.id) }}>
            <PresetSwatch preset={preset} />
            <span className="dt-preset-option-body">
              <span className="dt-preset-card-head"><span className="dt-preset-name">{preset.name}</span>
                <Tag tone={preset.builtin ? 'info' : 'neutral'}>{t(preset.builtin ? 'presetBadge.builtin' : 'presetBadge.custom')}</Tag>
                {used && <Tag tone="success">{t('promptPresetUsed')}</Tag>}</span>
              <span className="dt-preset-id dt-mono">{preset.id} · {t('promptPresetChars', { count: preset.chars })}</span>
            </span>
            <span className="dt-row-actions">
              <Button variant="ghost" size="sm" icon={<Icon name="copy" />} aria-label={t('duplicate')} title={t('duplicate')}
                onClick={() => setEditing({ index: 'new', preset: copyOf(preset) })} />
              {index >= 0 && <Button variant="ghost" size="sm" icon={<Icon name="review" />} aria-label={t('promptPresetEdit', { name: preset.name })}
                title={t('promptPresetEdit', { name: preset.name })} onClick={() => setEditing({ index, preset })} />}
              {/* Removing a team preset is saved at once and cannot be undone, so it asks first, anchored to its button. */}
              {index >= 0 && (used ? <Button variant="ghost" size="sm" icon={<Icon name="trash" />} disabled
                aria-label={t('removeRow', { name: preset.name })} title={t('promptPresetInUseHint')} />
                : <ConfirmButton danger iconOnly icon="trash" label={t('removeRow', { name: preset.name })} title={t('promptPresetDeleteTitle')}
                  message={t('promptPresetDeleteConfirm', { name: preset.name })} onConfirm={() => save.run(own.filter(item => item !== preset))} />)}
            </span>
          </li>
        })}</ul>
      </div>}
  </Modal>
}

function PresetEditor({ editing, taken, busy, onCancel, onSave }: {
  editing: Editing; taken: string[]; busy: boolean; onCancel: () => void; onSave: (preset: PresetRow) => void
}) {
  const { t } = usePanel()
  const [preset, setPreset] = useState(editing.preset)
  const [section, setSection] = useState<typeof SECTIONS[number]>('communication')
  const id = preset.id.trim()
  const problem = !preset.name.trim() ? t('promptPresetNameNeeded') : !ID.test(id) ? t('promptPresetIdInvalid')
    : taken.includes(id) ? t('promptPresetIdTaken') : undefined
  const patch = (next: Partial<Patch>) => setPreset({ ...preset, patch: { ...preset.patch, ...next } })
  const extras = Object.keys(preset.patch.skills ?? {}).length + Object.keys(preset.patch.overrides ?? {}).length
  return <form className="dt-form dt-preset-editor" onSubmit={event => { event.preventDefault(); if (!problem) onSave({ ...preset, id }) }}>
    <div className="dt-grid2">
      <Field className="dt-field" label={t('promptPresetName')}>
        <Input value={preset.name} maxLength={80} onChange={event => setPreset({ ...preset, name: event.target.value,
          ...editing.index === 'new' && !editing.preset.id ? { id: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '').slice(0, 60) } : {} })} /></Field>
      <Field className="dt-field" label={t('promptPresetId')} readOnly={editing.index !== 'new'}>
        <Input className="dt-mono" value={preset.id} spellCheck={false} onChange={event => setPreset({ ...preset, id: event.target.value })} />
      </Field>
    </div>
    <Field className="dt-field" label={t('promptPresetDescription')}>
      <Input value={preset.description} maxLength={400} onChange={event => setPreset({ ...preset, description: event.target.value })} />
    </Field>
    <Field className="dt-field" label={t('promptPresetModeLabel')} hint={t(`promptPresetModeHint.${preset.mode}`)}>
      <SegmentedControl className="dt-field-segmented" label={t('promptPresetModeLabel')} value={preset.mode}
        options={(['append', 'replace'] as const).map(mode => ({ value: mode, label: t(`promptPresetMode.${mode}`) }))}
        onChange={mode => setPreset({ ...preset, mode })} />
    </Field>
    <Tabs className="dt-subtabs" size="sm" idBase="dt-preset-section" label={t('promptSections')} value={section} onChange={setSection}
      items={SECTIONS.map(name => ({ value: name, label: `${t(`promptPart.${name}` as never)}${preset.patch[name] ? ' ·' : ''}` }))} />
    <CodeEditor key={section} className="dt-preset-text" label={t('promptPresetSectionText')} minLines={12}
      placeholder={t('promptPresetSectionEmpty')} value={preset.patch[section] ?? ''}
      onChange={next => patch({ [section]: next || undefined })} />
    {extras > 0 && <Hint>{t('promptPresetExtras', { count: extras })}</Hint>}
    {problem && <p className="dt-error" role="alert">{problem}</p>}
    <div className="dt-actions dt-preset-editor-actions">
      <Button variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" disabled={!!problem || busy}>{t('save')}</Button>
    </div>
  </form>
}
