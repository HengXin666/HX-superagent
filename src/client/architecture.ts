/**
 * The components of each pipeline step, read from the saved settings, which the architecture map draws under its step: each
 * Source instance, the Policy and admission, the main Session's model, preset, packs and prompt, and the Executor's slots,
 * model, preset, packs and environment. It reloads when settings are saved anywhere.
 */
import { useMemo } from 'react'
import { usePoll } from './api.ts'
import { useSettingsMaybe } from './settings-kit.tsx'
import type { MapPart, PipelineNode } from './pipeline.ts'
import { usePanel } from './provider.tsx'
import { localized } from './text.ts'
import { presetHue } from './prompt-presets.tsx'

type Parts = Partial<Record<PipelineNode, MapPart[]>>
interface Load { running: number; maxWorkers: number; queued: number }

export function useArchitectureParts(load?: Load, paused?: boolean): Parts | undefined {
  const { t, call } = usePanel()
  const settings = useSettingsMaybe()?.settings
  const { data: packs } = usePoll(() => call('GET agent-overlays'), [call], 60_000, { live: ['settings'] })
  // Whether each role's chain of presets is one it can run under, as the service decides it: a chain with a problem keeps the
  // base its settings name, so the map must not show the preset's base as in force.
  const chain = (role: 'orchestrator' | 'worker') => ((role === 'worker' ? settings?.blocks.executor.value : settings?.blocks.eval.value) as
    { overlays?: string[] } | undefined)?.overlays ?? []
  const mainKey = chain('orchestrator').join(','), workerKey = chain('worker').join(',')
  const { data: mainChain } = usePoll(() => mainKey ? call('POST agent-overlays/effective', { body: { role: 'orchestrator', overlays: mainKey.split(',') } })
    : Promise.resolve(undefined), [call, mainKey, packs?.revision], 60_000)
  const { data: workerChain } = usePoll(() => workerKey ? call('POST agent-overlays/effective', { body: { role: 'worker', overlays: workerKey.split(',') } })
    : Promise.resolve(undefined), [call, workerKey, packs?.revision], 60_000)
  return useMemo(() => {
    if (!settings) return undefined
    const { blocks, sources } = settings
    const name = (id: string) => packs?.overlays.find(item => item.id === id)?.name ?? id
    // The base a role runs on: the last of its presets that names one, else the base its settings name.
    const baseOf = (ids: readonly string[] | undefined, fallback: string) => {
      const by = [...ids ?? []].reverse().find(id => packs?.overlays.find(item => item.id === id)?.base)
      return by ? { id: packs!.overlays.find(item => item.id === by)!.base!, by: name(by) } : { id: fallback }
    }
    // Each preset of a role's chain is a layer of its own on the map, in order, coloured as its chip is.
    const layers = (role: 'main' | 'executor', ids: readonly string[] | undefined) => ids?.length ? ids.map((id, index) => ({
      id: `${role}-pack:${id}`, target: `${role}-overlays`, label: `${index + 1}. ${name(id)}`, hue: presetHue(id), depth: 1,
      ...packs && !packs.overlays.some(item => item.id === id) ? { state: 'error' as const } : {} }))
      : [{ id: `${role}-overlays`, label: t('part.overlays'), value: t('part.default'), depth: 1 }]
    const base = (id: string, ids: readonly string[] | undefined, fallback: string, blocked: boolean) => { const found = baseOf(ids, fallback)
      if (found.by && blocked) return { id, label: t('part.preset'), value: `${fallback} · ${t('overlaysBaseBlockedShort')}`, state: 'warning' as const }
      return { id, label: t('part.preset'), value: found.by ? `${found.id} ← ${found.by}` : found.id } }
    const model = (value: { model: string } | null) => value?.model ?? t('part.default')
    const ev = blocks.eval.value as typeof blocks.eval.value & { overlays?: string[] }
    const ex = blocks.executor.value as typeof blocks.executor.value & { overlays?: string[] }
    return {
      source: sources.filter(source => source.installed).map(source => ({ id: `source:${source.id}`, label: localized(t, source.title),
        ...source.value.enabled ? {} : { value: t('part.off'), state: 'idle' as const },
        ...source.problem ? { state: 'warning' as const } : {} })),
      policy: [{ id: 'policy', label: t('part.policy'), value: t('part.rules', { count: blocks.policy.value.rules.length }) },
        { id: 'admission', label: t('part.admission') }],
      main: [{ id: 'main-model', label: t('part.model'), value: model(ev.model) },
        base('main-preset', ev.overlays, ev.agentPreset, !!mainChain?.problems.length),
        ...layers('main', ev.overlays),
        { id: 'prompt', label: t('part.prompt') }],
      executor: [{ id: 'executor-slots', label: t('part.slots'), value: load ? `${load.running}/${ex.maxWorkers}` : String(ex.maxWorkers),
        ...paused ? { state: 'warning' as const } : load?.running ? { state: 'ongoing' as const } : {} },
        { id: 'executor-model', label: t('part.model'), value: model(ex.model) },
        base('executor-preset', ex.overlays, ex.agentPreset, !!workerChain?.problems.length),
        ...layers('executor', ex.overlays),
        { id: 'environment', label: t('part.environment'), ...ex.prepare ? { value: ex.prepare.split('\n')[0] } : {} }],
    }
  }, [settings, packs, mainChain, workerChain, load?.running, paused, t]) // eslint-disable-line react-hooks/exhaustive-deps
}
