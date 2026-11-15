/**
 * The prompt assembly view: one role's final prompt as a vertical stack of its layers in the order the Session reads them (the
 * built-in parts, the team's sections, each preset's text, the capability packs' instructions, then the skills it loads by name),
 * each layer as wide as its text, coloured by who wrote it. Clicking a layer opens its editor beside the stack: a team section or
 * a built-in part in the prompt draft, a preset's text in the preset library, a pack's instructions in the pack library.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { PromptConfig, PromptsView } from './api.ts'
import { usePoll } from './api.ts'
import { useAction, usePanel } from './provider.tsx'
import { useLive } from './live.ts'
import { CodeEditor } from './code-editor.tsx'
import { Hint, LoadState } from './widgets.tsx'
import { presetHue, type PresetRow } from './prompt-presets.tsx'
import { isPart, isSkill, partKey, sectionLabel } from './prompt-config.ts'
import { valueLabel } from './text.ts'
import { Badge, Button, Icon, SegmentedControl } from './ui/index.ts'

type Preview = ApiResponse<'POST prompts/preview'>
export type Layer = Preview['layers']['orchestrator'][number]
export type AssemblyRole = 'orchestrator' | 'worker'
type PresetLibrary = ApiResponse<'GET prompt-presets'>
type PackLibrary = ApiResponse<'GET agent-overlays'>
type PackRow = PackLibrary['overlays'][number]
/** How long the assembly waits after the last edit before it composes again. */
const SETTLE = 400
/** The narrowest a layer is drawn, as a share of the widest, so a short one can still be seen and clicked. */
const MIN_SHARE = 1.5

/** A preset's layer is `preset:<id>:<section>`, where the section is a team section, `skill/<name>` or `part/<key>`. */
export const isPresetLayer = (section: string): boolean => section.startsWith('preset:')
export const presetLayer = (section: string): { id: string; path: string } => {
  const [, id = '', ...path] = section.split(':')
  return { id, path: path.join(':') }
}
export const isPackLayer = (section: string): boolean => section.startsWith('pack:')

/** The draft composed as each role reads it, again once a person pauses typing or a preset or pack it reads is saved. */
export function useAssembly(config: PromptConfig, revisions: string) {
  const { call } = usePanel()
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<Error>()
  const [attempt, setAttempt] = useState(0)
  const first = useRef(true)
  // The packs a role turns on are settings; another tab's save of them composes again.
  useLive(['settings'], () => setAttempt(value => value + 1))
  useEffect(() => {
    const abort = new AbortController()
    const timer = setTimeout(() => {
      call('POST prompts/preview', { body: config, signal: abort.signal }).then(value => {
        if (!abort.signal.aborted) { setPreview(value); setError(undefined) }
      }, (failure: Error) => { if (!abort.signal.aborted) setError(failure) })
    }, first.current ? 0 : SETTLE)
    first.current = false
    return () => { clearTimeout(timer); abort.abort() }
  }, [call, config, revisions, attempt])
  return { preview, error, retry: () => setAttempt(attempt + 1) }
}

/** The packs library, for a pack layer's name and its editor. */
export function usePackLibrary() {
  const { call } = usePanel()
  return usePoll(() => call('GET agent-overlays'), [call], 60_000, { live: ['settings'] })
}

/** The name a layer goes by: its section's, a preset's with the section it writes, or a pack's. */
export function layerLabel(t: ReturnType<typeof usePanel>['t'], view: PromptsView, layer: Pick<Layer, 'section'>,
  presets: PresetLibrary | undefined, packs: PackLibrary | undefined): string {
  if (isPackLayer(layer.section)) { const id = layer.section.slice(5); return packs?.overlays.find(item => item.id === id)?.name ?? id }
  if (isPresetLayer(layer.section)) {
    const { id, path } = presetLayer(layer.section)
    return `${presets?.presets.find(item => item.id === id)?.name ?? id} · ${sectionLabel(t, view, path)}`
  }
  return sectionLabel(t, view, layer.section)
}

const GROUPS = ['prompt', 'packs', 'skills'] as const
/** The stack of a role's layers; `selected` is the editor's name for the open section, which may be several layers at once. */
export function PromptAssembly({ view, role, onRole, layers, selected, onSelect, presets, packs, error, onRetry }: {
  view: PromptsView; role: AssemblyRole; onRole: (role: AssemblyRole) => void; layers: Layer[] | undefined
  selected: string; onSelect: (section: string) => void; presets: PresetLibrary | undefined; packs: PackLibrary | undefined
  error?: Error | undefined; onRetry: () => void
}) {
  const { t } = usePanel()
  const list = useRef<HTMLDivElement>(null)
  const roles = <SegmentedControl className="dt-asm-roles" label={t('promptAsmRole')} value={role} onChange={onRole}
    options={(['orchestrator', 'worker'] as const).map(value => ({ value, label: valueLabel(t, 'promptRole', value) }))} />
  if (!layers) return <div className="dt-asm-stack">{roles}<LoadState loading error={error} onRetry={onRetry} /></div>
  const widest = Math.max(1, ...layers.map(layer => layer.chars))
  const total = (group: Layer['group']) => layers.filter(layer => layer.group === group).reduce((sum, layer) => sum + layer.chars, 0)
  // Up and down move between layers, as in a list; Enter or Space opens one.
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = [...list.current?.querySelectorAll<HTMLButtonElement>('.dt-asm-layer') ?? []]
    const at = items.indexOf(event.currentTarget)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : at + (event.key === 'ArrowDown' ? 1 : -1)
    if (items[next]) { event.preventDefault(); items[next]!.focus() }
  }
  const hue = (layer: Layer) => layer.by === undefined ? undefined : presetHue(layer.by)
  const source = (layer: Layer) => layer.origin === 'preset' ? presets?.presets.find(item => item.id === layer.by)?.name ?? layer.by!
    : layer.origin === 'pack' ? packs?.overlays.find(item => item.id === layer.by)?.name ?? layer.by! : t(`promptOrigin.${layer.origin}`)
  return <div className="dt-asm-stack" aria-label={t('promptStack')}>
    <div className="dt-asm-head">{roles}
      <span className="dt-hint">{t('promptAsmTotal', { chars: total('prompt') + total('packs'), skills: total('skills') })}</span>
      {error && <span className="dt-preview-failed" role="alert"><Badge tone="danger" title={error.message}>{t('promptPreviewFailed')}</Badge></span>}
    </div>
    <div className="dt-asm-layers" ref={list}>{GROUPS.map(group => {
      const rows = layers.filter(layer => layer.group === group)
      if (!rows.length) return null
      return <section key={group} className="dt-asm-group" aria-label={t(`promptAsmGroup.${group}`)}>
        <div className="dt-asm-group-head"><span>{t(`promptAsmGroup.${group}`)}</span><span className="dt-asm-chars">{total(group).toLocaleString()}</span></div>
        {rows.map(layer => {
          const name = layerLabel(t, view, layer, presets, packs)
          const share = Math.max(MIN_SHARE, (layer.chars / widest) * 100)
          return <button key={layer.id} type="button" className="dt-asm-layer" data-origin={layer.origin} data-generated={layer.generated || undefined}
            data-section={layer.section} aria-current={layer.section === selected || undefined} onKeyDown={move} onClick={() => onSelect(layer.section)}
            title={`${name} · ${source(layer)} · ${layer.chars.toLocaleString()}`}
            style={hue(layer) === undefined ? undefined : { ['--dt-hue' as string]: hue(layer) }}>
            <span className="dt-asm-bar" style={{ width: `${share}%` }} aria-hidden="true" />
            <span className="dt-asm-name">{name}</span>
            <span className="dt-asm-source">{source(layer)}{layer.generated ? ` · ${t('promptAsmGenerated')}` : ''}</span>
            <span className="dt-asm-chars">{layer.chars.toLocaleString()}</span>
          </button>
        })}
      </section>
    })}</div>
    <span className="dt-asm-legend">{(['builtin', 'team', 'preset', 'pack'] as const).map(kind => <span key={kind} className="dt-asm-key"
      data-origin={kind}>{t(`promptOrigin.${kind}`)}</span>)}</span>
    <Hint>{t('promptAsmHint')}</Hint>
  </div>
}

/** What a preset writes at `path`: a team section, a skill or a built-in part's text. */
const presetText = (preset: PresetRow, path: string): string => isSkill(path) ? preset.patch.skills?.[path.slice(6)] ?? ''
  : isPart(path) ? preset.patch.overrides?.[partKey(path)]?.text ?? '' : preset.patch[path as 'communication' | 'scope' | 'delivery'] ?? ''
const withPresetText = (preset: PresetRow, path: string, text: string): PresetRow => ({ ...preset, patch: isSkill(path)
  ? { ...preset.patch, skills: { ...preset.patch.skills, [path.slice(6)]: text } }
  : isPart(path) ? { ...preset.patch, overrides: { ...preset.patch.overrides, [partKey(path)]: { text } } }
  : { ...preset.patch, [path]: text } })
const storedPreset = ({ id, name, description, mode, patch }: PresetRow) => ({ id, name, description, mode, patch })

/**
 * A preset's text for one section, which the preset library saves on its own revision; the bundle's presets are read-only and
 * name where a copy is made.
 */
export function PresetLayerEditor({ view, section, library, reload }: {
  view: PromptsView; section: string; library: PresetLibrary | undefined; reload: () => Promise<void>
}) {
  const { t, call, notify } = usePanel()
  const { id, path } = presetLayer(section)
  const preset = library?.presets.find(item => item.id === id)
  const saved = preset ? presetText(preset, path) : ''
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [section, saved])
  const save = useAction(async () => {
    const own = library!.presets.filter(item => !item.builtin)
    await call('PUT prompt-presets', { body: { presets: own.map(item => storedPreset(item.id === id ? withPresetText(item, path, text) : item)),
      revision: library!.revision } })
    notify(t('saved'))
  }, { reload })
  if (!preset) return <div className="dt-prompt-main"><Hint>{t('promptPresetMissing')}</Hint></div>
  const title = `${preset.name} · ${sectionLabel(t, view, path)}`
  return <div className="dt-prompt-main" data-pipeline-block="prompt" data-pipeline-part="prompt" data-pipeline-title={title}>
    <div className="dt-subhead"><h3 className="dt-section-title">{title}</h3>
      <span className="dt-actions">{!preset.builtin && <Button variant="primary" size="sm" icon={<Icon name="check" />}
        disabled={save.busy || text === saved} onClick={() => { void save.run() }}>{t('save')}</Button>}</span></div>
    <Hint>{t(preset.builtin ? 'promptAsmPresetBuiltin' : 'promptAsmPresetHint', { name: preset.name, mode: t(`promptPresetMode.${preset.mode}`) })}</Hint>
    <CodeEditor keysHint={t('codeEditorKeys')} key={section} className="dt-editor" label={t('promptBody')} value={text} minLines={18} readOnly={!!preset.builtin}
      onChange={setText} />
  </div>
}

const storedPack = ({ id, name, description, roles, deny, allow, instructions, base }: PackRow) => ({ id, name, description, roles, deny,
  allow, instructions, ...base ? { base } : {} })
/** A capability pack's instructions, which the pack library saves on its own revision; the bundle's packs are read-only. */
export function PackLayerEditor({ section, library, reload }: {
  section: string; library: PackLibrary | undefined; reload: () => Promise<void>
}) {
  const { t, call, notify } = usePanel()
  const id = section.slice(5)
  const pack = library?.overlays.find(item => item.id === id)
  const saved = pack?.instructions ?? ''
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [section, saved])
  const save = useAction(async () => {
    const own = library!.overlays.filter(item => !item.builtin)
    await call('PUT agent-overlays', { body: { overlays: own.map(item => storedPack(item.id === id ? { ...item, instructions: text } : item)),
      revision: library!.revision } })
    notify(t('saved'))
  }, { reload })
  if (!pack) return <div className="dt-prompt-main"><Hint>{t('promptAsmPackMissing')}</Hint></div>
  return <div className="dt-prompt-main" data-pipeline-block="prompt" data-pipeline-part="prompt" data-pipeline-title={pack.name}>
    <div className="dt-subhead"><h3 className="dt-section-title">{pack.name}</h3>
      <span className="dt-actions">{!pack.builtin && <Button variant="primary" size="sm" icon={<Icon name="check" />}
        disabled={save.busy || text === saved || text.length > 8000} onClick={() => { void save.run() }}>{t('save')}</Button>}</span></div>
    <Hint>{t(pack.builtin ? 'promptAsmPackBuiltin' : 'promptAsmPackHint')}</Hint>
    <CodeEditor keysHint={t('codeEditorKeys')} key={section} className="dt-editor" label={t('promptBody')} value={text} minLines={18} maxLength={8000} readOnly={!!pack.builtin}
      onChange={setText} />
  </div>
}
