/**
 * Capability packs of a role: several turned on at once, in order, on top of its agent preset. The bar shows the chain (drag
 * or Alt + arrow keys to reorder, Delete to remove), a picker adds several at once, and the library writes the team's own. Under
 * the chain the role's effective tools are drawn live: kept, taken away and by which pack, and why a set cannot be saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { CodeEditor } from './code-editor.tsx'
import { TagInput, tagsOf } from './tag-input.tsx'
import { useReportFocus } from './pipeline-view.tsx'
import { useLive } from './live.ts'
import { useAction, usePanel } from './provider.tsx'
import { presetHue } from './prompt-presets.tsx'
import { errorText } from './text.ts'
import { Hint, Empty } from './widgets.tsx'
import { MultiSelect, Button, CheckboxGroup, ControlGroup, Field, Icon, Input, Modal, RadioGroup, Tag } from './ui/index.ts'

type Library = ApiResponse<'GET agent-overlays'>
type Effective = ApiResponse<'POST agent-overlays/effective'>
export type OverlayRow = Library['overlays'][number]
type Role = 'worker' | 'orchestrator'
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
/** A tool name as DSH registers it. */
const TOOL = /^[A-Za-z0-9_.:-]{1,64}$/

/** Loads the pack library, and reloads it when another tab or person saves settings. */
export function useOverlayLibrary() {
  const { call } = usePanel()
  const [library, setLibrary] = useState<Library>()
  const [error, setError] = useState<string>()
  const reload = useCallback(async () => {
    try { setLibrary(await call('GET agent-overlays')); setError(undefined) } catch (failure) { setError(errorText(failure)) }
  }, [call])
  useEffect(() => { void reload() }, [reload])
  useLive(['settings'], () => { void reload() })
  return { library, error, reload }
}

/** The role's effective tools for `overlays`, computed by the host 150 ms after the last change. */
function useEffective(role: Role, overlays: readonly string[], revision: number | undefined): Effective | undefined {
  const { call } = usePanel()
  const [effective, setEffective] = useState<Effective>()
  const key = overlays.join(',')
  useEffect(() => {
    if (revision === undefined) return
    let stale = false
    const timer = setTimeout(() => {
      call('POST agent-overlays/effective', { body: { role, overlays: key ? key.split(',') : [] } })
        .then(result => { if (!stale) setEffective(result) }, () => {})
    }, 150)
    return () => { stale = true; clearTimeout(timer) }
  }, [call, role, key, revision])
  return effective
}

export function AgentOverlayField({ role, value, saved, onChange }: {
  role: Role; value: readonly string[] | undefined; saved: readonly string[] | undefined; onChange: (next: string[]) => void
}) {
  const { t, notify } = usePanel()
  const { library, error, reload } = useOverlayLibrary()
  const active = useMemo(() => [...value ?? []], [value])
  const effective = useEffective(role, active, library?.revision)
  const report = useReportFocus()
  const [picking, setPicking] = useState(false)
  const [managing, setManaging] = useState<false | 'list' | 'new'>(false)
  const row = (id: string) => library?.overlays.find(item => item.id === id)
  const node = role === 'worker' ? 'executor' as const : 'main' as const
  const focus = (name?: string) => report({ nodes: [node], part: role === 'worker' ? 'executor-overlays' : 'main-overlays', trail: [t(role === 'worker' ? 'term.executor' : 'pipeline.main'), t('overlays'),
    ...name ? [name] : []] })
  // Removing a pack can be undone from its notice; the chain moves with a drag handle or Alt+arrows, its new place announced.
  const change = (next: string[]) => {
    const removed = active.filter(id => !next.includes(id))
    onChange(next)
    if (removed.length) notify(t('promptPresetRemoved', { name: removed.map(id => row(id)?.name ?? id).join(t('listSeparator')) }), 'info',
      { label: t('undo'), onClick: () => onChange(active) })
  }
  const changed = JSON.stringify(active) !== JSON.stringify(saved ?? [])
  return <section className="dt-preset-bar dt-overlay-bar" aria-label={t('overlays')} onFocusCapture={() => focus()}
    data-pipeline-part={role === 'worker' ? 'executor-overlays' : 'main-overlays'}>
    <div className="dt-preset-bar-head">
      <span className="dt-preset-bar-title"><Icon name="filter" size={14} />{t('overlays')}<span className="dt-count">{active.length || ''}</span></span>
      <span className="dt-actions">
        <Button variant="secondary" size="sm" icon={<Icon name="plus" />} disabled={!library} onClick={() => setPicking(true)}>{t('overlaysPick')}</Button>
        <Button variant="ghost" size="sm" icon={<Icon name="plus" />} disabled={!library} onClick={() => setManaging('new')}>{t('overlaysNew')}</Button>
        <Button variant="ghost" size="sm" icon={<Icon name="review" />} disabled={!library} onClick={() => setManaging('list')}>{t('overlaysManage')}</Button>
      </span>
    </div>
    <Hint>{t(role === 'worker' ? 'overlaysWorkerHint' : 'overlaysMainHint')}</Hint>
    {error && <p className="dt-error">{error}</p>}
    {active.length ? <div className="dt-preset-chain" aria-label={t('overlaysOrder')}>
      <MultiSelect options={(library?.overlays ?? []).map(item => ({ value: item.id, label: item.name }))} value={active} onChange={change}
        label={t('overlaysOrder')} placeholder={t('overlaysAdd')}
        labels={{ remove: name => t('promptPresetRemove', { name }), moved: (name, position, total) => t('promptPresetMoved', { name,
          position, total }), empty: t('none') }}
        renderChip={(_, id) => {
          const overlay = row(id)
          return <span className="dt-preset-chip" style={{ ['--dt-hue' as string]: presetHue(id) }} onFocus={() => focus(overlay?.name ?? id)}>
            <span className="dt-preset-chip-name">{overlay?.name ?? id}</span>
            {overlay && overlay.deny.length > 0 && <span className="dt-preset-chip-meta">−{overlay.deny.length}</span>}
            {overlay && (overlay.allow?.length ?? 0) > 0 && <span className="dt-preset-chip-meta">+{overlay.allow!.length}</span>}
            {overlay?.base && <span className="dt-preset-chip-meta" title={t('overlaysBaseTag', { base: overlay.base })}>⌂</span>}
            {!overlay && <Tag tone="danger">{t('promptPresetMissing')}</Tag>}
          </span>
        }} />
    </div> : <Empty>{t('overlaysNone')}</Empty>}
    {effective && <EffectiveTools effective={effective} library={library} />}
    {changed && <Hint>{t('agentPresetApplies')}</Hint>}
    {library && <OverlayPicker open={picking} role={role} library={library} active={active} onClose={() => setPicking(false)}
      onApply={next => { change(next); setPicking(false) }} />}
    {library && <OverlayLibrary open={!!managing} startNew={managing === 'new'} role={role} library={library} reload={reload}
      onClose={() => setManaging(false)} onCreated={overlay => {
        // A pack made for this role goes straight onto its chain (a draft change, saved with the block); one started from
        // "New preset" closes the library too, so making and turning on a pack is one step.
        if (overlay.roles.includes(role) && !active.includes(overlay.id)) onChange([...active, overlay.id])
        if (managing === 'new') setManaging(false)
      }} />}
  </section>
}

/** What the role runs with: each tool kept, each taken away (struck, with the pack that took it), and the problems. */
function EffectiveTools({ effective, library }: { effective: Effective; library: Library | undefined }) {
  const { t } = usePanel()
  const name = (id: string) => library?.overlays.find(item => item.id === id)?.name ?? id
  return <div className="dt-overlay-effective" aria-live="polite">
    <span className="hx-field-label">{t('overlaysEffective', { count: effective.tools.length })}</span>
    <span className="dt-overlay-tools">
      {effective.tools.map(tool => <code key={tool} className="dt-overlay-tool"
        data-added={effective.added?.some(item => item.tool === tool) || undefined}>{tool}</code>)}
      {effective.removed.map(({ tool, by }) => <code key={tool} className="dt-overlay-tool" data-removed=""
        title={t('overlaysRemovedBy', { names: by.map(name).join(', ') })}>{tool}</code>)}
    </span>
    {(effective.added?.length ?? 0) > 0 && <Hint>{t('overlaysAddedBy', { tools: effective.added!.map(({ tool, by }) =>
      `${tool} (${by.map(name).join(', ')})`).join(t('listSeparator')) })}</Hint>}
    {effective.instructions.length > 0 && <Hint>{t('overlaysInstructions', { count: effective.instructions.length })}</Hint>}
    {effective.base && <p className="dt-overlay-base" data-pipeline-part={effective.role === 'worker' ? 'executor-preset' : 'main-preset'}
      data-blocked={effective.problems.length > 0 || undefined}>
      <Icon name="settings" size={12} />{t(effective.problems.length ? 'overlaysBaseBlocked' : 'overlaysBaseBy',
        { base: effective.base.id, name: name(effective.base.by) })}</p>}
    {effective.problems.map((problem, index) => <p key={index} className="dt-error" role="alert">
      {t(`userError.${problem.key}` as never, problem.values)}</p>)}
  </div>
}

function OverlayPicker({ open, role, library, active, onClose, onApply }: {
  open: boolean; role: Role; library: Library; active: string[]; onClose: () => void; onApply: (overlays: string[]) => void
}) {
  const { t } = usePanel()
  const [chosen, setChosen] = useState(active)
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) { setChosen(active); setQuery('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = library.overlays.filter(overlay => overlay.roles.includes(role) && (!query.trim()
    || `${overlay.name} ${overlay.id} ${overlay.description}`.toLowerCase().includes(query.trim().toLowerCase())))
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter(item => item !== id) : [...chosen, id])
  return <Modal size="lg" className="dt-preset-modal" open={open} onClose={onClose} title={t('overlaysPick')} closeLabel={t('close')}
    description={t('overlaysPickHint')} footer={<>
      <span className="dt-hint dt-preset-footer-count">{t('promptPresetsChosen', { count: chosen.length })}</span>
      <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" onClick={() => onApply(chosen)}>{t('promptPresetsApply')}</Button>
    </>}>
    <div className="dt-preset-pick">
      <Input start={<Icon name="search" />} type="search" value={query} placeholder={t('promptPresetsSearch')}
        aria-label={t('promptPresetsSearch')} onChange={event => setQuery(event.target.value)} />
      <ul className="dt-preset-options">{shown.map(overlay => {
        const order = chosen.indexOf(overlay.id)
        return <li key={overlay.id}><button type="button" role="checkbox" aria-checked={order >= 0} className="dt-preset-option"
          style={{ ['--dt-hue' as string]: presetHue(overlay.id) }} onClick={() => toggle(overlay.id)}>
          <span className="dt-preset-check" aria-hidden="true">{order >= 0 ? order + 1 : ''}</span>
          <span className="dt-preset-option-body">
            <span className="dt-preset-card-head"><span className="dt-preset-name">{overlay.name}</span>
              <Tag tone={overlay.builtin ? 'info' : 'neutral'}>{t(overlay.builtin ? 'presetBadge.builtin' : 'presetBadge.custom')}</Tag></span>
            {overlay.description && <span className="dt-preset-desc">{overlay.description}</span>}
            <span className="dt-preset-touches">
              {overlay.deny.map(tool => <code key={tool} className="dt-code dt-overlay-deny">−{tool}</code>)}
              {(overlay.allow ?? []).map(tool => <code key={tool} className="dt-code dt-overlay-allow">+{tool}</code>)}
              {overlay.instructions && <code className="dt-code">+{t('overlaysInstructionsShort')}</code>}
              {overlay.base && <code className="dt-code dt-overlay-base-code">{t('overlaysBaseTag', { base: overlay.base })}</code>}
            </span>
          </span>
        </button></li>
      })}</ul>
      {!shown.length && <Hint>{t('none')}</Hint>}
    </div>
  </Modal>
}

type Editing = { index: number | 'new'; overlay: OverlayRow }
const blank = (): OverlayRow => ({ id: '', name: '', description: '', roles: ['worker', 'orchestrator'], deny: [], allow: [], instructions: '',
  chars: 0 })
const stored = ({ id, name, description, roles, deny, allow, instructions, base }: OverlayRow) => ({ id, name, description, roles, deny,
  allow: allow ?? [], instructions, ...base ? { base } : {} })

/** The team's packs: write, copy, import, export and remove them; the bundle's are read-only and can be copied. */
function OverlayLibrary({ open, library, reload, onClose, startNew, role, onCreated }: { open: boolean; library: Library; reload: () => Promise<void>
  onClose: () => void; startNew?: boolean | undefined; role?: Role | undefined
  /** Called once a new pack is saved, with the pack, so the role it was made on can turn it on. */
  onCreated?: ((overlay: OverlayRow) => void) | undefined }) {
  const { t, call, notify } = usePanel()
  const own = useMemo(() => library.overlays.filter(overlay => !overlay.builtin), [library])
  const used = new Set([...library.selected.worker, ...library.selected.orchestrator])
  const [editing, setEditing] = useState<Editing>()
  // Opened from "New preset", the library starts in the editor with a blank preset for the role it was opened on.
  useEffect(() => { if (open && startNew) setEditing({ index: 'new', overlay: { ...blank(), ...role ? { roles: [role] } : {} } })
    else if (!open) setEditing(undefined) }, [open, startNew, role])
  const file = useRef<HTMLInputElement>(null)
  const save = useAction(async (overlays: OverlayRow[], created?: OverlayRow) => {
    await call('PUT agent-overlays', { body: { overlays: overlays.map(stored), revision: library.revision } })
    notify(t('saved')); setEditing(undefined)
    if (created) onCreated?.(created)
  }, { reload })
  const copyOf = (overlay: OverlayRow): OverlayRow => {
    let id = `${overlay.id}-copy`.slice(0, 60); for (let n = 2; library.overlays.some(item => item.id === id); n++) id = `${overlay.id}-${n}`.slice(0, 60)
    return { ...stored(overlay), chars: overlay.chars, id, name: `${overlay.name}${t('copySuffix')}` }
  }
  const exported = () => {
    const blob = new Blob([JSON.stringify(own.map(stored), null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'dsh-superagent.capability-packs.json'
    link.click(); URL.revokeObjectURL(link.href)
  }
  const imported = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0]; input.value = ''
    if (!chosen) return
    try {
      const value = JSON.parse(await chosen.text()) as unknown
      const rows = (Array.isArray(value) ? value : [value]) as OverlayRow[]
      await save.run([...own.filter(item => !rows.some(row => row.id === item.id)), ...rows])
    } catch (failure) { notify(t('promptPresetImportFailed', { error: errorText(failure) })) }
  }
  return <Modal className="dt-preset-modal dt-preset-library" open={open} onClose={onClose} title={t('overlaysManage')}
    closeLabel={t('close')} description={t('overlaysLibraryHint')}>
    {editing ? <OverlayEditor editing={editing} roleTools={library.roleTools} busy={save.busy}
      taken={library.overlays.filter(item => editing.index === 'new' || item !== own[editing.index as number]).map(item => item.id)}
      onCancel={() => setEditing(undefined)}
      onSave={overlay => { void (editing.index === 'new' ? save.run([...own, overlay], overlay)
        : save.run(own.map((item, index) => index === editing.index ? overlay : item))) }} />
      : <div className="dt-preset-pick">
        <div className="dt-actions">
          <Button variant="primary" size="sm" icon={<Icon name="plus" />} onClick={() => setEditing({ index: 'new', overlay: blank() })}>{t('overlaysNew')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="inbox" />} onClick={() => file.current?.click()}>{t('promptPresetImport')}</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="external" />} disabled={!own.length} onClick={exported}>{t('promptPresetExport')}</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => { void imported(event.currentTarget) }} />
        </div>
        <ul className="dt-preset-options">{library.overlays.map(overlay => {
          const index = own.indexOf(overlay), inUse = used.has(overlay.id)
          return <li key={overlay.id} className="dt-preset-option dt-preset-row" style={{ ['--dt-hue' as string]: presetHue(overlay.id) }}>
            <span className="dt-preset-swatch" />
            <span className="dt-preset-option-body">
              <span className="dt-preset-card-head"><span className="dt-preset-name">{overlay.name}</span>
                <Tag tone={overlay.builtin ? 'info' : 'neutral'}>{t(overlay.builtin ? 'presetBadge.builtin' : 'presetBadge.custom')}</Tag>
                {overlay.roles.map(role => <Tag key={role} tone="outline">{t(role === 'worker' ? 'term.executor' : 'pipeline.main')}</Tag>)}
                {inUse && <Tag tone="success">{t('promptPresetUsed')}</Tag>}</span>
              <span className="dt-preset-id dt-mono">{overlay.id}{overlay.base ? ` · ${t('overlaysBaseTag', { base: overlay.base })}` : ''}{overlay.deny.length ? ` · −${overlay.deny.join(' −')}` : ''}</span>
            </span>
            <span className="dt-row-actions">
              <Button variant="ghost" size="sm" icon={<Icon name="copy" />} aria-label={t('duplicate')} title={t('duplicate')}
                onClick={() => setEditing({ index: 'new', overlay: copyOf(overlay) })} />
              {index >= 0 && <Button variant="ghost" size="sm" icon={<Icon name="review" />} aria-label={t('promptPresetEdit', { name: overlay.name })}
                title={t('promptPresetEdit', { name: overlay.name })} onClick={() => setEditing({ index, overlay })} />}
              {index >= 0 && <Button variant="ghost" size="sm" icon={<Icon name="trash" />} disabled={inUse || save.busy}
                aria-label={t('removeRow', { name: overlay.name })} title={inUse ? t('overlaysInUseHint') : t('remove')}
                onClick={() => { void save.run(own.filter(item => item !== overlay)) }} />}
            </span>
          </li>
        })}</ul>
      </div>}
  </Modal>
}

function OverlayEditor({ editing, roleTools, taken, busy, onCancel, onSave }: {
  editing: Editing; roleTools: Library['roleTools']; taken: string[]; busy: boolean; onCancel: () => void; onSave: (overlay: OverlayRow) => void
}) {
  const { t } = usePanel()
  const [overlay, setOverlay] = useState({ ...editing.overlay, allow: editing.overlay.allow ?? [] })
  const [granting, setGranting] = useState((editing.overlay.allow ?? []).join(' '))
  const id = overlay.id.trim()
  const tools = [...new Set(overlay.roles.flatMap(role => roleTools[role]))]
  const problem = !overlay.name.trim() ? t('promptPresetNameNeeded') : !ID.test(id) ? t('promptPresetIdInvalid')
    : taken.includes(id) ? t('promptPresetIdTaken') : !overlay.roles.length ? t('overlaysRoleNeeded') : undefined
  return <form className="dt-form dt-preset-editor" onSubmit={event => { event.preventDefault(); if (!problem) onSave({ ...overlay, id }) }}>
    <div className="dt-grid2">
      <Field className="dt-field" label={t('promptPresetName')}>
        <Input value={overlay.name} maxLength={80} autoFocus={editing.index === 'new'} onChange={event => setOverlay({ ...overlay, name: event.target.value,
          ...editing.index === 'new' && !editing.overlay.id ? { id: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '').slice(0, 60) } : {} })} /></Field>
      <Field className="dt-field" label={t('promptPresetId')} readOnly={editing.index !== 'new'}>
        <Input className="dt-mono" value={overlay.id} spellCheck={false} onChange={event => setOverlay({ ...overlay, id: event.target.value })} />
      </Field>
    </div>
    <Field className="dt-field" label={t('promptPresetDescription')}>
      <Input value={overlay.description} maxLength={400} onChange={event => setOverlay({ ...overlay, description: event.target.value })} />
    </Field>
    <Field className="dt-field" label={t('overlaysRoles')}>
      <CheckboxGroup className="dt-overlay-tools" itemClassName="dt-overlay-toggle" label={t('overlaysRoles')} value={overlay.roles}
        options={(['orchestrator', 'worker'] as const).map(role => ({ value: role, label: t(role === 'worker' ? 'term.executor' : 'pipeline.main') }))}
        onChange={roles => setOverlay({ ...overlay, roles })} />
    </Field>
    <Field className="dt-field" label={t('overlaysDeny')} hint={t('overlaysDenyHint')}>
      <CheckboxGroup className="dt-overlay-tools" itemClassName="dt-overlay-toggle dt-mono" label={t('overlaysDeny')} value={overlay.deny}
        options={tools.map(tool => ({ value: tool, label: tool, data: { 'data-deny': overlay.deny.includes(tool) ? '' : undefined } }))}
        onChange={deny => setOverlay({ ...overlay, deny })} />
    </Field>
    <Field className="dt-field" label={t('overlaysAllow')} hint={t('overlaysAllowHint')}>
      <TagInput label={t('overlaysAllow')} placeholder={t('overlaysAllowPlaceholder')} pattern={TOOL} invalidLabel={t('overlaysAllowInvalid')}
        value={granting} onChange={text => { setGranting(text); const { tags, typing } = tagsOf(text)
          setOverlay({ ...overlay, allow: [...new Set([...tags, ...typing ? [typing] : []])].filter(tool => TOOL.test(tool) && !tools.includes(tool)) }) }} />
    </Field>
    <BaseChoice value={overlay.base} roles={overlay.roles} onChange={base => setOverlay({ ...overlay, base })} />
    <CodeEditor keysHint={t('codeEditorKeys')} className="dt-preset-text" label={t('overlaysInstructionsLabel')} minLines={8} placeholder={t('overlaysInstructionsEmpty')}
      value={overlay.instructions} onChange={instructions => setOverlay({ ...overlay, instructions })} />
    {problem && <p className="dt-error" role="alert">{problem}</p>}
    <div className="dt-actions dt-preset-editor-actions">
      <Button variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" disabled={!!problem || busy}>{t('save')}</Button>
    </div>
  </form>
}

/** The base a preset puts its roles on: none (the role keeps its own), one DSH's registry lists, or another registered id. */
function BaseChoice({ value, roles, onChange }: { value: string | undefined; roles: readonly Role[]; onChange: (base: string | undefined) => void }) {
  const { t, call } = usePanel()
  const [catalog, setCatalog] = useState<ApiResponse<'GET agent-presets'>>()
  useEffect(() => { call('GET agent-presets').then(setCatalog, () => {}) }, [call])
  const listed = catalog?.presets ?? []
  const other = !!value && !listed.some(preset => preset.id === value)
  const [typing, setTyping] = useState(other)
  // The choice and the id typed for "another" are two controls under one label: a named group, each control naming itself.
  const chosen = typing ? OTHER : value ?? KEEP
  return <ControlGroup className="dt-field" label={t('overlaysBase')} hint={t('overlaysBaseHint')}>
    <RadioGroup className="dt-overlay-tools" itemClassName="dt-overlay-toggle" label={t('overlaysBase')} value={chosen}
      options={[{ value: KEEP, label: t('overlaysBaseKeep') },
        ...listed.map(preset => ({ value: preset.id, label: preset.name, title: preset.description || preset.id, className: 'dt-mono',
          disabled: !roles.every(role => preset.compatible[role]) })),
        { value: OTHER, label: t('overlaysBaseOther') }]}
      onChange={next => { setTyping(next === OTHER); if (next !== OTHER) onChange(next === KEEP ? undefined : next) }} />
    {typing && <Input className="dt-mono" aria-label={t('overlaysBaseOther')} placeholder={t('agentPresetCustomPlaceholder')} spellCheck={false}
      value={value ?? ''} onChange={event => onChange(event.target.value.trim() || undefined)} />}
  </ControlGroup>
}
/** The two choices of the base that are not a listed preset; a preset id never holds a NUL character. */
const KEEP = '\u0000keep', OTHER = '\u0000other'
