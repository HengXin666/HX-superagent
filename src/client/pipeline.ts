/**
 * The dispatch pipeline the panel draws: where a message goes from a Source to the reply, which settings group configures each
 * step, and which steps a setting or a prompt part bears on, so the map can say where the person is editing.
 */
import type { SettingsGroup } from './route.ts'

export const PIPELINE = ['source', 'policy', 'main', 'executor', 'reply'] as const
export type PipelineNode = typeof PIPELINE[number]
export interface PipelineStep { id: PipelineNode; group: SettingsGroup; icon: 'inbox' | 'shield' | 'decision' | 'running' | 'message' }
export const STEPS: Readonly<Record<PipelineNode, PipelineStep>> = {
  source: { id: 'source', group: 'source', icon: 'inbox' },
  policy: { id: 'policy', group: 'eval', icon: 'shield' },
  main: { id: 'main', group: 'eval', icon: 'decision' },
  executor: { id: 'executor', group: 'execution', icon: 'running' },
  reply: { id: 'reply', group: 'source', icon: 'message' },
}
/** The flow between steps: forward along the pipeline, and the worker's reports back to the main Session. */
export const EDGES: readonly { from: PipelineNode; to: PipelineNode; back?: true }[] = [
  { from: 'source', to: 'policy' }, { from: 'policy', to: 'main' }, { from: 'main', to: 'executor' }, { from: 'executor', to: 'reply' },
  { from: 'executor', to: 'main', back: true },
]
/** Where a person is editing: the steps it bears on and the trail the map names under them. */
export interface PipelineFocus { nodes: PipelineNode[]; trail: string[] }
/** The steps a settings block configures, by the `data-pipeline-block` the panel marks it with. */
export const BLOCK_NODES: Readonly<Record<string, PipelineNode[]>> = {
  source: ['source', 'reply'], policy: ['policy'], admission: ['policy'], eval: ['main'], executor: ['executor'],
  environment: ['executor'], deployment: ['source', 'main', 'executor'],
}
type Role = 'orchestrator' | 'worker'
/** The steps a prompt section is read at: a team section and a skill by both Sessions, a built-in part by the roles it names. */
export function promptNodes(section: string, roles?: readonly Role[]): PipelineNode[] {
  const read = roles ?? ['orchestrator', 'worker']
  return [...read.includes('orchestrator') ? ['main' as const] : [], ...read.includes('worker') ? ['executor' as const] : []]
}
/** The steps a settings group configures, which the map marks when nothing is focused. */
export const groupNodes = (group: SettingsGroup): PipelineNode[] => PIPELINE.filter(node => STEPS[node].group === group)
/** The line a caret is on in `text`, counting from 1. */
export const lineAt = (text: string, caret: number): number => text.slice(0, Math.max(0, caret)).split('\n').length
