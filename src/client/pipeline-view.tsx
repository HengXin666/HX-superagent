/**
 * The pipeline map over the settings: a message's path from a Source to the reply as five steps, the one being edited lit, with
 * a trail naming the block, field and line; clicking a step opens its settings. The console draws the same map with live counts.
 */
import { createContext, useCallback, useContext, useMemo, useState, type FocusEvent, type ReactNode } from 'react'
import { Icon } from './controls.tsx'
import { BLOCK_NODES, EDGES, PIPELINE, STEPS, groupNodes, lineAt, type PipelineFocus, type PipelineNode } from './pipeline.ts'
import { usePanel } from './provider.tsx'
import { settingsRoute, type SettingsGroup } from './route.ts'

interface FocusState { focus: PipelineFocus | undefined; setFocus: (focus: PipelineFocus | undefined) => void }
const Focus = createContext<FocusState | undefined>(undefined)
export function PipelineFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<PipelineFocus>()
  const value = useMemo(() => ({ focus, setFocus }), [focus])
  return <Focus.Provider value={value}>{children}</Focus.Provider>
}
/** Tells the map where the person is editing, for a part of the page that knows better than its markup (the prompt editor). */
export function useReportFocus(): (focus: PipelineFocus | undefined) => void {
  return useContext(Focus)?.setFocus ?? noop
}
const noop = () => {}
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
/**
 * Reads where a focused control is from the page's markup: the nearest block marked `data-pipeline-block` (with its title in
 * `data-pipeline-title`), its section's title, and the control's own label; a text area adds the caret's line.
 */
export function focusOf(target: Element): PipelineFocus | undefined {
  const block = target.closest<HTMLElement>('[data-pipeline-block]')
  if (!block) return undefined
  const nodes = (block.dataset.pipelineNodes?.split(',') ?? BLOCK_NODES[block.dataset.pipelineBlock!] ?? []) as PipelineNode[]
  const section = target.closest('.dt-section')?.querySelector('.dt-section-name')
  const field = target.closest('.dt-field, .dt-switch-row')
  const label = target.getAttribute('aria-label') || text(field?.querySelector('label, .dt-field-head')) || ''
  const trail = [block.dataset.pipelineTitle ?? '', text(section), label].filter((item, index, all) => item && all.indexOf(item) === index)
  if (target instanceof HTMLTextAreaElement) trail.push(`L${lineAt(target.value, target.selectionStart)}`)
  return { nodes, trail }
}
/** Tracks focus within its children, so the map follows the control the person edits. */
export function FocusTracker({ children }: { children: ReactNode }) {
  const report = useReportFocus()
  const track = useCallback((event: FocusEvent | { target: EventTarget | null }) => {
    if (event.target instanceof Element) { const focus = focusOf(event.target); if (focus) report(focus) }
  }, [report])
  return <div className="dt-focus-tracker" onFocusCapture={track} onKeyUpCapture={track} onClickCapture={track}>{children}</div>
}

export interface NodeStat { value: string; state?: 'ongoing' | 'warning' | 'error' | 'idle' }
/** The map itself; `current` marks the steps the open settings group configures, the focus the steps being edited. */
export function PipelineMap({ current, stats = {}, onPick, compact }: {
  current?: SettingsGroup | undefined; stats?: Partial<Record<PipelineNode, NodeStat>>; onPick?: (node: PipelineNode) => void
  compact?: boolean
}) {
  const { t, navigate } = usePanel()
  const focus = useContext(Focus)?.focus
  const lit = new Set(focus?.nodes ?? [])
  const near = new Set(current ? groupNodes(current) : [])
  const crumbs = focus ? [focus.nodes.map(node => t(`pipeline.${node}`)).join(' + '), ...focus.trail].filter(Boolean) : []
  const pick = onPick ?? ((node: PipelineNode) => navigate(settingsRoute(STEPS[node].group), true))
  const W = 150, H = compact ? 58 : 70, GAP = 38, X = (index: number) => index * (W + GAP), Y = 12
  const width = X(PIPELINE.length - 1) + W, height = H + Y + (compact ? 14 : 30)
  return <figure className="dt-pipeline" data-compact={compact || undefined} aria-label={t('pipelineLabel')}>
    <div className="dt-pipeline-scroll">
      <svg className="dt-pipeline-svg" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        <defs>
          <marker id="dt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" className="dt-pipeline-arrowhead" /></marker>
        </defs>
        {EDGES.map(edge => {
          const from = PIPELINE.indexOf(edge.from), to = PIPELINE.indexOf(edge.to)
          const active = lit.has(edge.from) && lit.has(edge.to)
          if (edge.back) {
            const x1 = X(from) + W / 2, x2 = X(to) + W / 2, y = Y + H
            return <path key={`${edge.from}-${edge.to}`} className="dt-pipeline-edge dt-pipeline-back" data-active={active || undefined}
              d={`M${x1} ${y}C${x1} ${y + 26} ${x2} ${y + 26} ${x2} ${y + 2}`} markerEnd="url(#dt-arrow)" />
          }
          return <path key={`${edge.from}-${edge.to}`} className="dt-pipeline-edge" data-active={active || undefined}
            d={`M${X(from) + W + 2} ${Y + H / 2}H${X(to) - 4}`} markerEnd="url(#dt-arrow)" />
        })}
      </svg>
      <ol className="dt-pipeline-nodes" style={{ ['--dt-pipeline-w' as string]: `${(W / width) * 100}%`,
        ['--dt-pipeline-gap' as string]: `${(GAP / width) * 100}%`, ['--dt-pipeline-h' as string]: `${H}px` }}>
        {PIPELINE.map(node => {
          const stat = stats[node]
          return <li key={node} className="dt-pipeline-node-slot"><button type="button" className="dt-pipeline-node" data-node={node}
            data-lit={lit.has(node) || undefined} data-near={near.has(node) || undefined} data-state={stat?.state}
            aria-current={lit.has(node) ? 'step' : undefined} onClick={() => pick(node)}
            title={t(`pipelineHint.${node}`)}>
            <span className="dt-pipeline-icon"><Icon name={STEPS[node].icon} size={16} /></span>
            <span className="dt-pipeline-text"><span className="dt-pipeline-name">{t(`pipeline.${node}`)}</span>
              <span className="dt-pipeline-sub">{stat?.value ?? t(`pipelineSub.${node}`)}</span></span>
          </button></li>
        })}
      </ol>
    </div>
    {!compact && <figcaption className="dt-pipeline-trail" aria-live="polite">
      {crumbs.length ? <><span className="dt-pipeline-here">{t('pipelineHere')}</span>{crumbs.map((item, index) => <span key={index}
        className="dt-pipeline-crumb">{item}</span>)}</> : <span className="dt-hint">{t('pipelineIdle')}</span>}
    </figcaption>}
  </figure>
}
