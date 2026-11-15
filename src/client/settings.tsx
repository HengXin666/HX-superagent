/** Settings tab shell routing between stage settings (Sources, Eval, Execution), Prompts, and Deployment. */
import type { StateView } from './api.ts'
import { DeploymentPage, type DeploymentForm } from './deployment.tsx'
import { EvalSettings } from './eval.tsx'
import { ExecutionSettings } from './execution.tsx'
import { PresetsSettings } from './presets.tsx'
import { PromptsPage } from './prompts.tsx'
import { usePanel } from './provider.tsx'
import { SETTINGS_GROUPS, settingsRoute, type SettingsGroup } from './route.ts'
import { SettingsProvider } from './settings-kit.tsx'
import { SaveAll, useDraftGroups } from './draft.tsx'
import { SourceSettings } from './source.tsx'
import { FocusTracker, PipelineFocusProvider, PipelineMap, type NodeStat } from './pipeline-view.tsx'
import { useArchitectureParts } from './architecture.ts'

const STAGE_GROUPS: readonly SettingsGroup[] = ['source', 'eval', 'execution']
export function SettingsPage({ group, query, state, deploymentForm }: {
  group: SettingsGroup; query: { source?: string; version?: string }; state: StateView; deploymentForm: DeploymentForm
}) {
  const { t, navigate } = usePanel()
  // Which groups hold an unsaved draft, so the nav shows where work waits (SET-3).
  const drafts = useDraftGroups()
  const content = (() => {
    switch (group) {
      case 'source': return <SourceSettings {...query.source ? { focus: query.source } : {}} />
      case 'eval': return <EvalSettings version={query.version} />
      case 'execution': return <ExecutionSettings />
      case 'presets': return <SettingsProvider><PresetsSettings /></SettingsProvider>
      case 'prompts': return <PromptsPage />
      case 'deployment': return <DeploymentPage setup={state.setup} form={deploymentForm} />
    }
  })()
  const { load, paused } = state
  const stats = { executor: { value: t('pipelineStat.executor', { running: load.running, max: load.maxWorkers, queued: load.queued }),
    state: paused ? 'warning' as const : load.running ? 'ongoing' as const : 'idle' as const },
  }
  // One settings provider and one focus trail for the whole tab: switching groups keeps the settings it read and the map's trail,
  // instead of reading them again behind a skeleton (SET-1).
  return <SettingsProvider><PipelineFocusProvider><div className="dt-settings">
    <nav className="dt-settings-nav" aria-label={t('tab.settings')}>
      {SETTINGS_GROUPS.map(value => <button key={value} type="button" className="dt-settings-link" data-stage={STAGE_GROUPS.includes(value)
        || undefined}
        aria-current={value === group ? 'page' : undefined} onClick={() => navigate(settingsRoute(value),
          true)}>{t(`settingsGroup.${value}`)}{drafts.has(value) && <span className="dt-draft-dot" role="img"
            aria-label={t('groupHasDraft')} title={t('groupHasDraft')} />}</button>)}
    </nav>
    <div className="dt-settings-body">
      <h2 className="dt-settings-title">{t(`settingsGroup.${group}`)}</h2>
      {group === 'deployment' ? content : <>
        <ArchitectureMap group={group} stats={stats} load={load} paused={paused} />
        <SaveAll><FocusTracker>{content}</FocusTracker></SaveAll>
      </>}
    </div>
  </div></PipelineFocusProvider></SettingsProvider>
}

/** The architecture map over a settings group: the pipeline's steps with the components each holds, read from the shared settings. */
function ArchitectureMap({ group, stats, load, paused }: { group: SettingsGroup; stats: { executor: NodeStat }
  load: StateView['load']; paused: boolean }) {
  const parts = useArchitectureParts(load, paused)
  return <PipelineMap current={group} stats={{ executor: stats.executor }} parts={parts} />
}
