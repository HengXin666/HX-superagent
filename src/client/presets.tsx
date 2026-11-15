/**
 * One place for everything a role runs under, as one stack read top to bottom: the agent preset DSH registers (its base: one,
 * from DSH's registry), the capability packs the team turned on for the role (several, in order, its own or the bundle's), and
 * the prompt presets the team turned on for both roles (several, in order). The main Session and the Executor each get a card
 * whose base and packs save with their settings block, as on the Eval and Execution settings; the prompt presets are shared
 * by both roles and keep their order in the prompt configuration, which the card shows and links to.
 */
import { usePoll } from './api.ts'
import { AgentOverlayField } from './agent-overlays.tsx'
import { AgentPresetField } from './agent-preset.tsx'
import { SaveBar } from './draft.tsx'
import { PromptPresetBar, usePresetLibrary } from './prompt-presets.tsx'
import { errorText } from './text.ts'
import { useState } from 'react'
import { usePanel } from './provider.tsx'
import { settingsRoute } from './route.ts'
import { Fields, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { Hint, Section } from './widgets.tsx'
import { Button, Icon, InfoTip, Tag } from './ui/index.ts'

/**
 * The prompt presets both roles share, chosen here directly: several at once, in order, from the team's library or their own.
 * A change saves at once against the configuration's revision (no trip to the Prompts tab), shows the new chain immediately and
 * rolls back with a notice when the save fails, for example when another save got there first.
 */
function PromptLayer() {
  const { t, call, notify, navigate } = usePanel()
  const { data, reload } = usePoll(() => call('GET prompts'), [call], 60_000, { live: ['prompts'] })
  const presets = usePresetLibrary()
  const [pending, setPending] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  const config = data?.current.config
  const shown = config ? { ...config, ...(pending ? { presets: pending } : {}) } : undefined
  const change = async (next: string[]) => {
    if (!data || !config) return
    setPending(next); setBusy(true)
    const { presets: _old, ...rest } = config
    try {
      await call('PUT prompts', { body: { config: next.length ? { ...rest, presets: next } : rest, baseRevision: data.current.revision } })
      notify(t('presetsPromptSaved'))
      await reload()
    } catch (failure) {
      notify(t('presetsPromptFailed', { error: errorText(failure) }), 'danger')
      await reload()
    } finally { setPending(undefined); setBusy(false) }
  }
  return <Section title={t('presetsPrompt')} hint={t('presetsPromptHint')} action={<Button variant="ghost" size="sm"
    icon={<Icon name="external" size={14} />} onClick={() => navigate(settingsRoute('prompts'), true)}>{t('presetsPromptEdit')}</Button>}>
    {shown ? <div aria-busy={busy || undefined} data-pipeline-part="prompt">
      <PromptPresetBar config={shown} library={presets.library} error={presets.error} reload={presets.reload}
        onChange={next => { void change(next) }} />
    </div> : <span className="dt-skeleton dt-preset-card" aria-busy="true" />}
  </Section>
}

/** The main Session's base and packs, saved with the Eval block. */
function MainStack() {
  const { t } = usePanel()
  const block = useSettings().settings.blocks.eval
  const saved = { ...block.value, timeoutSeconds: String(block.value.timeoutSeconds) }
  const draft = useBlockDraft('eval', saved, block.revision, value => ({ ...value, timeoutSeconds: numberOf(value.timeoutSeconds) }))
  const value = draft.value
  return <form className="dt-form dt-block dt-stack" onSubmit={event => { void draft.submit(event) }} data-pipeline-block="eval"
    data-pipeline-title={t('term.mainSession')}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('term.mainSession')}<Tag tone="outline">{t('presetsLayers', { count: 1 + value.overlays.length })}</Tag></h2>
      <AgentPresetField role="orchestrator" value={value.agentPreset} saved={block.value.agentPreset}
        onChange={agentPreset => draft.edit({ ...value, agentPreset })} />
      <AgentOverlayField role="orchestrator" value={value.overlays} saved={block.value.overlays}
        onChange={overlays => draft.edit({ ...value, overlays })} />
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

/** The Executor's base and packs, saved with the Executor block. */
function ExecutorStack() {
  const { t } = usePanel()
  const executor = useSettings().settings.blocks.executor
  const saved = { ...executor.value, maxWorkers: String(executor.value.maxWorkers), blockedCommands: executor.value.blockedCommands.join(' ') }
  const draft = useBlockDraft('executor', saved, executor.revision, value => ({ ...value, maxWorkers: numberOf(value.maxWorkers),
    blockedCommands: [...new Set(value.blockedCommands.split(/[\s,]+/).filter(Boolean))] }))
  const value = draft.value
  return <form className="dt-form dt-block dt-stack" onSubmit={event => { void draft.submit(event) }} data-pipeline-block="executor"
    data-pipeline-title={t('term.executor')}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('term.executor')}<Tag tone="outline">{t('presetsLayers', { count: 1 + value.overlays.length })}</Tag></h2>
      <AgentPresetField role="worker" value={value.agentPreset} saved={executor.value.agentPreset}
        onChange={agentPreset => draft.edit({ ...value, agentPreset })} />
      <AgentOverlayField role="worker" value={value.overlays} saved={executor.value.overlays}
        onChange={overlays => draft.edit({ ...value, overlays })} />
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

export function PresetsSettings() {
  const { t } = usePanel()
  return <div className="dt-form dt-presets-page">
    <p className="dt-banner dt-presets-model"><Icon name="alert" size={14} />{t('presetsModel')}<InfoTip text={t('presetsDshLimit')} /></p>
    <div className="dt-stack-grid">
      <MainStack />
      <ExecutorStack />
    </div>
    <PromptLayer />
  </div>
}
