/** Prompts settings group: section/skill editor, full composed prompt preview with diffing, and revision history. */
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { PromptConfig, PromptsView } from './api.ts'
import { SaveBar, useDraft, type DraftWords } from './draft.tsx'
import { changedSections, isPart, isSkill, lineDiff, partKey, partText, partWith, sectionLabel, sectionText, skillNameFree, withOverride,
  withOverrides, withSection, withoutSkill, type BuiltInPart, type DiffLine } from './prompt-config.ts'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { useLive } from './live.ts'
import { errorText, valueLabel, when, type T } from './text.ts'
import { Hint, LoadState } from './widgets.tsx'
import { promptNodes, type PipelineNode } from './pipeline.ts'
import { useReportFocus } from './pipeline-view.tsx'
import { CodeEditor } from './code-editor.tsx'
import { PresetSwatch, PromptPresetBar, presetMarks, usePresetLibrary, type PresetRow } from './prompt-presets.tsx'
import { PackLayerEditor, PresetLayerEditor, PromptAssembly, isPackLayer, isPresetLayer, layerLabel, presetLayer, useAssembly, usePackLibrary,
  type AssemblyRole } from './prompt-assembly.tsx'
import { Badge, ControlGroup, FieldError, FormField, IconButton, Tabs, TabPanel, Button, Icon, Input, SegmentedControl, Select } from './ui/index.ts'

type Tab = 'edit' | 'assembly' | 'full' | 'history'
type Origin = { revision: number } | 'defaults' | { reset: string }
interface PromptNote { from?: Origin; selection?: string }
const originText = (t: T, view: PromptsView, from: Origin | undefined): string | undefined => from === undefined ? undefined
  : from === 'defaults' ? t('promptDraftFromDefaults') : 'revision' in from ? t('promptDraftFromHistory', { revision: from.revision })
  : t('promptDraftSectionReset', { part: sectionLabel(t, view, from.reset) })

export function PromptsPage() {
  const { call } = usePanel()
  const [view, setView] = useState<PromptsView>()
  const [error, setError] = useState<Error>()
  const { restarts } = usePanelData()
  const reload = useCallback(async () => { setView(await call('GET prompts')); setError(undefined) }, [call])
  useEffect(() => { reload().catch(setError) }, [reload, restarts])
  // Another person's or tab's save reaches the editor while it is open: the draft merges the new revision as it arrives.
  useLive(['prompts'], () => { reload().catch(setError) })
  return view ? <PromptsEditor view={view} reload={reload} /> : <LoadState loading error={error} onRetry={() => { reload().catch(setError) }} />
}

function PromptsEditor({ view, reload }: { view: PromptsView; reload: () => Promise<void> }) {
  const { t, call, notify } = usePanel()
  const saved = withOverrides(view.current.config)
  const draft = useDraft<PromptConfig, PromptNote>({ key: 'dsh-superagent/draft/prompts', saved, revision: view.revision,
    reload,
    save: async (config, baseRevision) => {
      const result = await call('PUT prompts', { body: { config, baseRevision } })
      notify(t(result.context_delivery === 'pending' ? 'promptSavedPending' : 'saved'))
      return result
    } })
  const config = draft.value
  const [tab, setTab] = useState<Tab>('edit')
  const [fullChoice, setFullChoice] = useState<FullChoice>({ target: 'orchestrator', compare: undefined })
  const [selection, select] = useState(draft.meta?.selection ?? 'communication')
  const [role, setRole] = useState<AssemblyRole>('worker')
  // Fall back to the first section when the selected section (e.g., a skill removed by discard) is no longer in the draft.
  const exists = isPart(selection) ? view.parts.some(part => part.key === partKey(selection)) : sectionText(config, selection) !== undefined
  const selected = exists ? selection : 'communication'
  const changed = changedSections(config, saved)
  const edit = (next: PromptConfig, note: PromptNote = {}) => draft.edit(next, { from: note.from ?? draft.meta?.from,
    selection: note.selection ?? selection })
  const open = (name: string) => { select(name); setTab('edit') }
  const words: DraftWords = { merged: revision => t('promptConflict', { revision }),
    conflict: (revision, paths) => t('promptConflictParts', { revision, parts: paths.map(([name, item]) => sectionLabel(t, view,
      item === undefined ? name! : name === 'skills' ? `skill/${item}` : name === 'overrides' ? `part/${item}` : name!)).join(t('listSeparator')) }),
    editing: [t('promptsDraftVersion', { revision: draft.revision }), t('promptChanges', { count: changed.length }),
      originText(t, view, draft.meta?.from)].filter(Boolean).join(' · ') }
  const tabs = [{ value: 'edit' as const, label: t('promptViewEdit') }, { value: 'assembly' as const, label: t('promptViewAssembly') },
    { value: 'full' as const, label: t('promptViewFull') },
    { value: 'history' as const, label: t('promptViewHistory') }]
  const removed = view.defaultChanged.filter(item => item.removed).map(item => item.part)
  const presets = usePresetLibrary()
  const marks = presetMarks(config, presets.library)
  return <div className="dt-form">
    <PromptPresetBar config={config} library={presets.library} error={presets.error} reload={presets.reload}
      onChange={next => { const { presets: _old, ...rest } = config; edit(next.length ? { ...rest, presets: next } : rest) }} />
    <Tabs className="dt-subtabs" size="sm" idBase="dt-prompt-view" label={t('promptViews')} value={tab} onChange={setTab} items={tabs} />
    {removed.length > 0 && <Hint>{t('promptRemovedParts', { parts: removed.join(t('listSeparator')) })}</Hint>}
    <TabPanel idBase="dt-prompt-view" value={tab} active className="dt-subpanel">
      {tab === 'edit' && <PromptSections config={config} view={view} changed={changed} selected={selected} onSelect={select} onEdit={edit}
        marks={marks} />}
      {tab === 'assembly' && <Assembly config={config} view={view} selected={selection} onSelect={select} onEdit={edit} presets={presets}
        role={role} onRole={setRole} />}
      {tab === 'full' && <FullPrompt config={config} view={view} dirty={draft.dirty} revision={draft.revision} onEdit={open} choice={fullChoice}
        onChoice={setFullChoice} />}
      {tab === 'history' && <PromptHistory key={view.revision} view={view} from={draft.meta?.from}
        onLoad={(next, from) => edit(withOverrides(next, view.parts), { from })} />}
    </TabPanel>
    <SaveBar {...draft} words={words} onSave={() => { void draft.submit() }}
      onDiscard={() => { draft.discard(); reload().catch(failure => notify(errorText(failure), 'danger')) }} />
  </div>
}

function PromptSections({ config, view, changed, selected, onSelect, onEdit, marks = {} }: {
  config: PromptConfig; view: PromptsView; changed: string[]; selected: string; onSelect: (name: string) => void
  onEdit: (next: PromptConfig, note?: PromptNote) => void; marks?: Record<string, PresetRow[]>
}) {
  const { t } = usePanel()
  // The map follows the part a person opens, from the list or the stack, before they type in it.
  const report = useReportFocus()
  useEffect(() => {
    const marks = pipelineOf(view, selected, sectionLabel(t, view, selected))
    report({ nodes: marks['data-pipeline-nodes'].split(',') as PipelineNode[], trail: [marks['data-pipeline-title']], part: 'prompt' })
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const swatches = (section: string) => marks[section]?.length ? <span className="dt-preset-swatches" aria-label={t('promptPresetWrites',
    { names: marks[section]!.map(preset => preset.name).join(t('listSeparator')) })}>{marks[section]!.map(preset => <PresetSwatch
      key={preset.id} preset={preset} />)}</span> : null
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState(false)
  const item = (section: string, children: ReactNode) => <button key={section} type="button" className="dt-nav-item"
    aria-current={section === selected ? 'true' : undefined} onClick={() => onSelect(section)} {...pipelineOf(view, section,
      sectionLabel(t, view, section))}>{children}</button>
  const unsaved = (section: string) => changed.includes(section) && <span className="dt-changed-dot" aria-label={t('unsaved')} />
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!skillNameFree(name.trim(), config, view)) { setInvalid(true); return }
    const section = `skill/${name.trim()}`
    setName('')
    onEdit(withSection(config, section, ''), { selection: section }); onSelect(section)
  }
  const part = isPart(selected) ? view.parts.find(item => item.key === partKey(selected)) : undefined
  return <><div className="dt-prompt">
    <nav className="dt-prompt-nav" aria-label={t('promptSections')}>
      <div className="dt-nav-group">{t('promptTeamGroup')}</div>
      {view.sections.map(section => item(section, <>
        <span>{sectionLabel(t, view, section)}{config[section] !== view.defaults[section] && <span
          className="dt-changed-tag">{t('promptChanged')}</span>}{unsaved(section)}{swatches(section)}</span><small>{t(`promptPartHint.${section}`)}</small>
      </>))}
      <div className="dt-nav-group">{t('promptBuiltInGroup')}</div>
      {view.parts.map(entry => item(`part/${entry.key}`, <span>{sectionLabel(t, view, `part/${entry.key}`)}
        {config.overrides?.[entry.key] && <span className="dt-changed-tag">{t('promptChanged')}</span>}
        {updated(config, entry) && <span className="dt-changed-tag dt-updated-tag">{t('promptDefaultUpdated')}</span>}
        {unsaved(`part/${entry.key}`)}{swatches(`part/${entry.key}`)}</span>))}
      <div className="dt-nav-group">{t('promptSkillsGroup')}</div>
      {Object.keys(config.skills).map(skill => item(`skill/${skill}`, <span>{sectionLabel(t, view, `skill/${skill}`)}{unsaved(
        `skill/${skill}`)}{swatches(`skill/${skill}`)}</span>))}
      <form className="dt-add-skill" onSubmit={add}>
        <FormField>
          <Input value={name} placeholder={t('promptSkillName')} aria-label={t('promptAddSkill')} spellCheck={false}
            onChange={event => { setName(event.target.value); setInvalid(false) }} />
          {invalid && <FieldError className="dt-error">{t('promptSkillNameInvalid')}</FieldError>}
        </FormField>
        <Button variant="ghost" size="sm" type="submit" icon={<Icon name="plus" />}>{t('promptAddSkillAction')}</Button>
      </form>
    </nav>
    {part ? <BuiltInEditor config={config} view={view} part={part} onEdit={onEdit} />
      : <TeamEditor config={config} view={view} selected={selected} onSelect={onSelect} onEdit={onEdit} />}
  </div></>
}
/** The pipeline steps that read a prompt section, as the map's focus tracker reads them from the markup. */
function pipelineOf(view: PromptsView, section: string, title: string) {
  const part = isPart(section) ? view.parts.find(item => item.key === partKey(section)) : undefined
  const roles = part && !part.key.startsWith('skill/') ? part.roles : undefined
  return { 'data-pipeline-block': 'prompt', 'data-pipeline-part': 'prompt', 'data-pipeline-nodes': promptNodes(section, roles).join(','), 'data-pipeline-title': title }
}
/**
 * The assembly view of the Prompts settings: the chosen role's final prompt as a stack of its layers beside the editor of the
 * layer clicked, which is the prompt draft's for a team section or a built-in part, and the library's for a preset or a pack.
 */
function Assembly({ config, view, selected, onSelect, onEdit, presets, role, onRole }: {
  config: PromptConfig; view: PromptsView; selected: string; onSelect: (name: string) => void
  onEdit: (next: PromptConfig, note?: PromptNote) => void; presets: ReturnType<typeof usePresetLibrary>
  role: AssemblyRole; onRole: (role: AssemblyRole) => void
}) {
  const { t } = usePanel()
  const packs = usePackLibrary()
  const { preview, error, retry } = useAssembly(config, `${presets.library?.revision ?? ''}:${packs.data?.revision ?? ''}`)
  const layers = preview?.layers[role]
  const report = useReportFocus()
  // The map follows the layer opened, as it follows the section list.
  useEffect(() => {
    // A pack's instructions light that pack's own layer under the role's step on the map, not just the prompt.
    if (isPackLayer(selected)) { report({ nodes: [role === 'worker' ? 'executor' : 'main'], trail: [layerLabel(t, view, { section: selected },
      presets.library, packs.data)], part: `${role === 'worker' ? 'executor' : 'main'}-pack:${selected.slice(5)}` }); return }
    const section = isPresetLayer(selected) ? presetLayer(selected).path : selected
    const marks = pipelineOf(view, section, layerLabel(t, view, { section: selected }, presets.library, packs.data))
    report({ nodes: marks['data-pipeline-nodes'].split(',') as PipelineNode[], trail: [marks['data-pipeline-title']], part: 'prompt' })
  }, [selected, role]) // eslint-disable-line react-hooks/exhaustive-deps
  // A section this role's prompt does not hold (the other role's part) still opens, as the stack of either role may have chosen it.
  const known = isPresetLayer(selected) || isPackLayer(selected) || (isPart(selected) ? view.parts.some(part => part.key === partKey(selected))
    : sectionText(config, selected) !== undefined)
  const shown = known ? selected : layers?.[0]?.section ?? 'communication'
  const part = isPart(shown) ? view.parts.find(item => item.key === partKey(shown)) : undefined
  return <div className="dt-asm">
    <PromptAssembly view={view} role={role} onRole={onRole} layers={layers} selected={shown} onSelect={onSelect}
      presets={presets.library} packs={packs.data} error={error} onRetry={retry} />
    {isPresetLayer(shown) ? <PresetLayerEditor view={view} section={shown} library={presets.library} reload={presets.reload} />
      : isPackLayer(shown) ? <PackLayerEditor section={shown} library={packs.data} reload={async () => { await packs.reload() }} />
      : part ? <BuiltInEditor config={config} view={view} part={part} onEdit={onEdit} />
      : <TeamEditor config={config} view={view} selected={shown} onSelect={onSelect} onEdit={onEdit} />}
  </div>
}
/** Whether an override was edited from a built-in text that has changed since. */
const updated = (config: PromptConfig, part: BuiltInPart): boolean => {
  const override = config.overrides?.[part.key]
  return !!override?.base && override.base !== part.base
}
function TeamEditor({ config, view, selected, onSelect, onEdit }: {
  config: PromptConfig; view: PromptsView; selected: string; onSelect: (name: string) => void; onEdit: (next: PromptConfig, note?: PromptNote) => void
}) {
  const { t, notify } = usePanel()
  const text = sectionText(config, selected) ?? ''
  const fallback = sectionText(view.defaults, selected)
  return <div className="dt-prompt-main" {...pipelineOf(view, selected, sectionLabel(t, view, selected))}>
    <div className="dt-subhead"><h3 className="dt-section-title">{sectionLabel(t, view, selected)}</h3>
      <span className="dt-actions">{isSkill(selected)
        ? <Button variant="secondary" size="sm" icon={<Icon name="trash" />} onClick={() => {
          // The selection moves to the skill beside it, and the notice can put the skill back (PRM-3).
          const skills = Object.keys(config.skills).map(name => `skill/${name}`)
          const at = skills.indexOf(selected)
          const next = skills[at + 1] ?? skills[at - 1] ?? 'communication'
          onEdit(withoutSkill(config, selected), { selection: next }); onSelect(next)
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.dt-prompt-nav [aria-current="true"], .dt-prompt-nav [aria-current="page"]')?.focus())
          notify(t('promptSkillRemoved', { name: sectionLabel(t, view, selected) }), 'info', { label: t('undo'),
            onClick: () => { onEdit(config, { selection: selected }); onSelect(selected) } })
        }}>{t('remove')}</Button>
        : <Button variant="secondary" size="sm" icon={<Icon name="refresh" />} disabled={fallback === text}
          onClick={() => {
            onEdit(withSection(config, selected, fallback ?? ''), { from: { reset: selected } })
            notify(t('promptSectionReset', { name: sectionLabel(t, view, selected) }), 'info', { label: t('undo'), onClick: () => onEdit(config) })
          }}>
          {t('promptResetSection')}
        </Button>}
    </span></div>
    <Hint>{t(isSkill(selected) ? 'promptReadBy.skill' : 'promptReadBy.both')}</Hint>
    <CodeEditor key={selected} className="dt-editor" label={t('promptBody')} value={text} minLines={18}
      onChange={next => onEdit(withSection(config, selected, next))} />
  </div>
}
/**
 * A built-in part: its text, the team's override or the built-in one, with a reset; a template says which placeholders it
 * keeps; an override whose built-in text changed since shows the change and offers to keep the team's text or take the new one.
 */
function BuiltInEditor({ config, view, part, onEdit }: {
  config: PromptConfig; view: PromptsView; part: BuiltInPart; onEdit: (next: PromptConfig, note?: PromptNote) => void
}) {
  const { t } = usePanel()
  const name = `part/${part.key}`
  const reset = () => onEdit(withOverride(config, part, undefined), { from: { reset: name } })
  // The built-in text the override was edited from, when this installation kept that one.
  const base = config.overrides?.[part.key]?.base
  const previous = view.defaultChanged.find(item => item.part === part.key && item.base === base)?.previous
  const readBy = part.key.startsWith('skill/') ? 'promptReadBy.skill' : part.roles.length > 1 ? 'promptReadBy.both'
    : `promptReadBy.${part.roles[0]!}` as const
  return <div className="dt-prompt-main" {...pipelineOf(view, name, sectionLabel(t, view, name))}>
    <div className="dt-subhead"><h3 className="dt-section-title">{sectionLabel(t, view, name)}</h3>
      <span className="dt-actions"><Button variant="secondary" size="sm" icon={<Icon name="refresh" />} disabled={!config.overrides?.[part.key]}
        onClick={reset}>{t('promptResetSection')}</Button></span></div>
    <Hint>{t(readBy)}</Hint>
    {part.placeholders && <Hint>{t('promptTemplateHint', { placeholders: part.placeholders.join(t('listSeparator')) })}</Hint>}
    {updated(config, part) && <section className="dt-default-updated" aria-label={t('promptDefaultUpdated')}>
      <b>{t('promptDefaultUpdated')}</b>
      <Hint>{t('promptDefaultUpdatedHint')}</Hint>
      {previous !== undefined ? <><Hint>{t('promptDefaultUpdatedKnown')}</Hint><Diff lines={lineDiff(previous, part.text)} /></>
        : <><Hint>{t('promptDefaultUpdatedUnknown')}</Hint><Diff lines={lineDiff(partText(config, part), part.text)} /></>}
      <span className="dt-actions">
        <Button variant="secondary" size="sm" onClick={() => onEdit(withOverride(config, part, partText(config, part), true))}>
          {t('promptKeepMine')}</Button>
        <Button variant="secondary" size="sm" onClick={reset}>{t('promptTakeDefault')}</Button>
      </span>
    </section>}
    <CodeEditor key={part.key} className="dt-editor" label={t('promptBody')} value={partText(config, part)} minLines={18}
      onChange={next => onEdit(withOverride(config, part, next))} />
  </div>
}

type Preview = ApiResponse<'POST prompts/preview'>
type Target = 'orchestrator' | 'worker' | `skill/${string}`
/** How long the full prompt waits after the last edit before it composes again. */
const PREVIEW_SETTLE = 400
const KIND_LABEL = { team: 'promptPartTeam', fixed: 'promptPartFixed', generated: 'promptPartGenerated' } as const
/** What the full prompt view shows, kept by the editor so leaving the view and coming back keeps the choice (PRM-2). */
interface FullChoice { target: Target; compare: 'saved' | 'default' | undefined }
function FullPrompt({ config, view, dirty, revision, onEdit, choice, onChoice }: {
  config: PromptConfig; view: PromptsView; dirty: boolean; revision: number; onEdit: (name: string) => void
  choice: FullChoice; onChoice: (next: FullChoice) => void
}) {
  const { t, call, notify } = usePanel()
  const { target } = choice
  const setTarget = (next: Target) => onChoice({ ...choice, target: next })
  const compare = choice.compare ?? (dirty ? 'saved' : 'default')
  const setCompare = (next: 'saved' | 'default') => onChoice({ ...choice, compare: next })
  const [attempt, setAttempt] = useState(0)
  // Keep the preview paired with the config it was composed from so diffs stay consistent until the next preview arrives.
  const [preview, setPreview] = useState<{ config: PromptConfig; value: Preview }>()
  const [error, setError] = useState<Error>()
  const [composing, setComposing] = useState(false)
  // Compose once a person pauses typing, and drop the request a newer edit makes moot; the first preview is not held back.
  const first = useRef(true)
  useEffect(() => {
    const abort = new AbortController()
    setComposing(true)
    const timer = setTimeout(() => {
      call('POST prompts/preview', { body: config, signal: abort.signal }).then(value => {
        if (!abort.signal.aborted) { setPreview({ config, value }); setError(undefined); setComposing(false) }
      }, (failure: Error) => { if (!abort.signal.aborted) { setError(failure); setComposing(false) } })
    }, first.current ? 0 : PREVIEW_SETTLE)
    first.current = false
    return () => { clearTimeout(timer); abort.abort() }
  }, [call, config, attempt])
  // A failed preview keeps the last one on screen, dimmed, with the error and a retry at its head.
  if (!preview) return <LoadState loading error={error} onRetry={() => setAttempt(attempt + 1)} />
  const shown = dirty ? compare : 'default'
  // A built-in skill is a built-in part, by its key.
  const team = isSkill(target) && Object.hasOwn(preview.config.skills, target.slice(6))
  const parts: { name: string; kind: 'team' | 'fixed' | 'generated'; key?: string; heading?: string; text: string }[] = isSkill(target)
    ? [{ name: target, kind: team ? 'team' : 'fixed', ...team ? {} : { key: target }, text: preview.value.skills[target.slice(6)] ?? '' }]
    : preview.value.parts[target]
  const builtIn = (key: string) => view.parts.find(part => part.key === key)
  return <>
    <div className="dt-subhead">
      <Select size="sm" className="dt-select dt-inline-select" label={t('promptPreviewTarget')} value={target} onChange={next => setTarget(next as Target)}
        options={[{ value: 'orchestrator', label: valueLabel(t, 'promptRole', 'orchestrator') }, { value: 'worker', label: valueLabel(t, 'promptRole',
          'worker') }, ...Object.keys(preview.value.skills).map(name => ({ value: `skill/${name}`, label: sectionLabel(t, view, `skill/${name}`) }))]} />
      <Hint>{t('promptFullState', { count: parts.length, chars: parts.reduce((sum, part) => sum + part.text.length, 0),
        state: dirty ? t('promptPreviewDraft') : t('promptPreviewSaved', { revision }) })}</Hint>
      {error ? <span className="dt-preview-failed" role="alert"><Badge tone="danger" title={error.message}>{t('promptPreviewFailed')}</Badge>
        <IconButton icon="refresh" size="sm" label={t('retry')} onClick={() => setAttempt(attempt + 1)} /></span>
        : <span className="dt-sync" data-busy={composing || undefined} role="status">{t(composing ? 'promptComposing' : 'promptComposed')}</span>}
      <SegmentedControl className="dt-compare" label={t('promptCompare')} value={shown} options={[...dirty
        ? [{ value: 'saved' as const, label: t('promptCompareSaved') }] : [], { value: 'default' as const,
          label: t('promptCompareDefault') }]} onChange={setCompare} />
      <Button variant="secondary" size="sm" icon={<Icon name="copy" />} onClick={() => {
        void navigator.clipboard.writeText(parts.map(part => part.text).join('\n\n')).then(() => notify(t('copied')))
      }}>{t('promptCopyAll')}</Button>
    </div>
    {parts.map(part => {
      const { kind } = part
      const text = sectionText(preview.config, part.name) ?? ''
      const entry = part.key === undefined ? undefined : builtIn(part.key)
      // The text a part is compared with: a team section's, or a built-in part's, override or built-in text, in the saved
      // version or the defaults; a generated part holds data and is not compared.
      const from = (config: PromptConfig) => kind === 'team' ? partWith(part, sectionText(config, part.name) ?? '')
        : kind === 'fixed' && entry ? partText(config, entry) : undefined
      const base = from(shown === 'saved' ? view.current.config : view.defaults)
      const edited = kind === 'team' ? !isSkill(part.name) && text !== sectionText(view.defaults, part.name)
        : !!entry && !!preview.config.overrides?.[entry.key]
      // A generated part's template the draft changed shows filled, as it is not compared.
      const template = kind === 'generated' && !!entry
        && preview.config.overrides?.[entry.key]?.text !== view.current.config.overrides?.[entry.key]?.text
      return <section key={part.name} className="dt-preview-part" data-editable={kind === 'team' || entry !== undefined || undefined}>
        <div className="dt-preview-head"><b>{sectionLabel(t, view, entry ? `part/${entry.key}` : part.name)}</b><span>{t(KIND_LABEL[kind])}</span>
          {edited && <span className="dt-changed-tag">{t('promptChanged')}</span>}
          {(kind === 'team' || entry) && <button type="button" className="dt-textlink"
            onClick={() => onEdit(entry ? `part/${entry.key}` : part.name)}>{t('promptEditSource')}</button>}
        </div>
        {/* When comparing against saved, show only changes from this draft and fold the parts it leaves as they were. */}
        {base !== undefined && base !== part.text ? <Diff lines={lineDiff(base, part.text)} />
          : shown === 'saved' && !template ? <Hint>{t(kind === 'generated' ? 'promptBuiltInFolded' : 'promptSameAsSaved')}</Hint>
          : <pre className="dt-pre">{part.text}</pre>}
      </section>
    })}
  </>
}
function Diff({ lines }: { lines: DiffLine[] }) {
  const { t } = usePanel()
  return <pre className="dt-pre">{lines.map((line, index) => <Fragment key={index}>{line.kind === 'fold'
    ? <><span className="dt-diff-fold">{t('promptSameLines', { count: line.count })}</span>{'\n'}</>
    : line.kind === 'ins' ? <ins>{`${line.text}\n`}</ins> : line.kind === 'del' ? <del>{`${line.text}\n`}</del>
    : `${line.text}\n`}</Fragment>)}</pre>
}

function PromptHistory({ view, from, onLoad }: {
  view: PromptsView; from: Origin | undefined; onLoad: (config: PromptConfig, from: Origin) => void
}) {
  const { t, call } = usePanel()
  const [older, setOlder] = useState<Pick<PromptsView, 'revisions' | 'next_offset'>>()
  const next = older ? older.next_offset : view.next_offset
  const more = useAction(async (offset: number) => {
    const page = await call('GET prompts', { query: { offset } })
    setOlder({ revisions: [...older?.revisions ?? [], ...page.revisions], next_offset: page.next_offset })
  })
  const load = useAction(async (revision: number) => {
    onLoad((await call('GET prompts', { query: { revision } })).current.config, { revision })
  })
  return <div className="dt-form">
    <Hint>{t('promptHistoryHint')}</Hint>
    <ul className="dt-list">{[...view.revisions, ...older?.revisions ?? []].map(version => <li key={version.revision} className="dt-row">
      <div className="dt-row-main">
        <div className="dt-row-title">{t('promptHistoryItem', { revision: version.revision, time: version.savedAt
          ? when(version.savedAt, t('lang')) : t('promptHistoryInitial'), source: valueLabel(t, 'historySource', version.source) })}</div>
        <div className="dt-row-meta">{version.changed.length ? t('promptHistoryChanged', { parts: version.changed.map(name =>
          sectionLabel(t, view, name)).join(t('listSeparator')) }) : t('promptHistoryNone')}</div>
      </div>
      <div className="dt-row-actions"><Button variant="secondary" size="sm" icon={<Icon name="history" />}
        disabled={load.busy || (typeof from === 'object' && 'revision' in from && from.revision === version.revision)}
        onClick={() => { void load.run(version.revision) }}>{t('promptRestore')}</Button></div>
    </li>)}</ul>
    <div className="dt-actions">
      {next !== null && <Button variant="secondary" size="sm" icon={<Icon name="chevron-down" />} disabled={more.busy}
        onClick={() => { void more.run(next) }}>{t('promptOlder')}</Button>}
      <Button variant="secondary" size="sm" icon={<Icon name="refresh" />}
        onClick={() => onLoad(view.defaults, 'defaults')}>{t('promptDefaults')}</Button>
    </div>
    <ControlGroup className="dt-field" label={t('promptSessions')}>
      {view.sessions.length ? <ul className="dt-changes dt-mono">{view.sessions.map(item => <li
        key={item.sessionId}>{t('promptSessionItem', { session: item.sessionId, revision: item.revision })}</li>)}</ul>
        : <Hint>{t('promptNoSessions')}</Hint>}
    </ControlGroup>
  </div>
}
