/**
 * The pipeline map over the settings: a message's path from a Source to the reply as five steps, the one being edited lit, with
 * a trail naming the block, field and line; clicking a step opens its settings. The console draws the same map with live counts.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { BLOCK_NODES, EDGES, PIPELINE, STEPS, groupNodes, impactOf, lineAt, type MapPart, type PipelineFocus, type PipelineNode } from './pipeline.ts'
import { usePanel } from './provider.tsx'
import { settingsRoute, type SettingsGroup } from './route.ts'
import { Icon } from './ui/index.ts'

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
/** An element's text as a screen reader reads it as a name: what is `aria-hidden` (a required mark, an icon) left out. */
function spoken(element: Element | null | undefined): string {
  if (!element) return ''
  const copy = element.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return text(copy)
}
/**
 * A control's accessible name, the way the form atoms wire it: its own `aria-label`, else the elements `aria-labelledby` names, else
 * its label element. A CodeMirror editor is named on its content element.
 */
function nameOf(target: Element): string {
  const own = target.getAttribute('aria-label')
  if (own) return own
  const ids = target.getAttribute('aria-labelledby')
  const labelled = ids ? ids.split(/\s+/).map(id => spoken(document.getElementById(id))).filter(Boolean).join(' ') : ''
  if (labelled) return labelled
  const labels = 'labels' in target ? (target as HTMLInputElement).labels : null
  return labels?.length ? spoken(labels[0]) : ''
}
/**
 * Reads where a focused control is from the page's markup: the nearest block marked `data-pipeline-block` (with its title in
 * `data-pipeline-title`), its section's title, and the control's own name (else its field's label); a text area adds the caret's line.
 */
export function focusOf(target: Element): PipelineFocus | undefined {
  const block = target.closest<HTMLElement>('[data-pipeline-block]')
  if (!block) return undefined
  const nodes = (block.dataset.pipelineNodes?.split(',') ?? BLOCK_NODES[block.dataset.pipelineBlock!] ?? []) as PipelineNode[]
  const section = target.closest('.dt-section')?.querySelector('.dt-section-name')
  const field = target.closest('.hx-field, .dt-field, .dt-switch-row')
  const editor = target.closest('.cm-editor')?.querySelector('.cm-content')
  const label = nameOf(target) || (editor ? nameOf(editor) : '') || spoken(field?.querySelector('.hx-field-label')) || ''
  const trail = [block.dataset.pipelineTitle ?? '', text(section), label].filter((item, index, all) => item && all.indexOf(item) === index)
  if (target instanceof HTMLTextAreaElement) trail.push(`L${lineAt(target.value, target.selectionStart)}`)
  else { const line = target.closest<HTMLElement>('[data-line]')?.dataset.line; if (line) trail.push(`L${line}`) }
  const part = target.closest<HTMLElement>('[data-pipeline-part]')?.dataset.pipelinePart
  return { nodes, trail, ...part ? { part } : {} }
}
/** Tracks focus within its children, so the map follows the control the person edits. */
export function FocusTracker({ children }: { children: ReactNode }) {
  const report = useReportFocus()
  const track = useCallback((event: FocusEvent | { target: EventTarget | null }) => {
    if (event.target instanceof Element) { const focus = focusOf(event.target); if (focus) report(focus) }
  }, [report])
  return <div className="dt-focus-tracker" onFocusCapture={track} onKeyUpCapture={track} onClickCapture={track}>{children}</div>
}

/** The width an element is laid out at, kept current as it resizes; 0 until measured or where nothing can measure. */
function useSpan(ref: { current: HTMLElement | null }): number {
  const [span, setSpan] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      // A width too narrow to read five steps keeps a floor and scrolls instead.
      setSpan(next > 0 ? Math.max(360, next) : 0)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return span
}

export interface NodeStat { value: string; state?: 'ongoing' | 'warning' | 'error' | 'idle'
  /** When work last passed through the step, which lights it and the edge into it for a moment. */
  pulse?: number | undefined }
/** The map itself; `current` marks the steps the open settings group configures, the focus the steps being edited. */
export function PipelineMap({ current, stats = {}, onPick, compact, parts }: {
  current?: SettingsGroup | undefined; stats?: Partial<Record<PipelineNode, NodeStat>>; onPick?: (node: PipelineNode) => void
  compact?: boolean
  /** The components inside each step, drawn under it; the one being edited is lit, and clicking one opens it in the settings. */
  parts?: Partial<Record<PipelineNode, MapPart[]>> | undefined
}) {
  const { t, navigate } = usePanel()
  const focus = useContext(Focus)?.focus
  const lit = new Set(focus?.nodes ?? [])
  const impact = focus ? impactOf(focus.nodes) : []
  const reach = new Set(impact)
  const near = new Set(current ? groupNodes(current) : [])
  const crumbs = focus ? [focus.nodes.map(node => t(`pipeline.${node}`)).join(' + '), ...focus.trail].filter(Boolean) : []
  const pick = onPick ?? ((node: PipelineNode) => navigate(settingsRoute(STEPS[node].group), true))
  // A part opens its step's settings group, then the component itself, scrolled to and focused.
  const openPart = (node: PipelineNode, id: string) => {
    const group = id === 'prompt' ? 'prompts' as const : STEPS[node].group
    if (group !== current) navigate(settingsRoute(group), true)
    let tries = 0
    const reveal = () => {
      const target = document.querySelector<HTMLElement>(`[data-pipeline-part="${id}"]`)
      if (!target) { if (++tries < 20) setTimeout(reveal, 50); return }
      target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      target.querySelector<HTMLElement>('input, textarea, select, button, [tabindex="0"], .cm-content')?.focus({ preventScroll: true })
    }
    setTimeout(reveal, 0)
  }
  // The map is drawn at the width it is shown at, so all five steps always fit the panel and the edges meet the nodes at any
  // width; before it is measured (and where nothing measures, as in tests) it uses its natural width and scales.
  const scroll = useRef<HTMLDivElement>(null)
  const span = useSpan(scroll)
  const steps = PIPELINE.length
  const NATURAL_W = 150, NATURAL_GAP = 38
  const GAP = span ? Math.min(NATURAL_GAP, Math.max(14, span * 0.042)) : NATURAL_GAP
  const W = span ? (span - GAP * (steps - 1)) / steps : NATURAL_W
  const H = compact ? 58 : 70, X = (index: number) => index * (W + GAP), Y = 12
  const width = X(steps - 1) + W, height = H + Y + (compact ? 14 : 30)
  const rows = Math.max(0, ...PIPELINE.map(node => parts?.[node]?.length ?? 0))
  return <figure className="dt-pipeline" data-compact={compact || undefined} aria-label={t('pipelineLabel')}>
    <div className="dt-pipeline-scroll" ref={scroll} style={rows ? { minHeight: `${height + rows * 30 + 12}px` } : undefined}>
      <svg className="dt-pipeline-svg" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true"
        style={span ? { height: `${height}px` } : undefined}>
        <defs>
          <marker id="dt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" className="dt-pipeline-arrowhead" /></marker>
        </defs>
        {EDGES.map(edge => {
          const from = PIPELINE.indexOf(edge.from), to = PIPELINE.indexOf(edge.to)
          const active = lit.has(edge.from) && lit.has(edge.to)
          const flowing = stats[edge.to]?.pulse !== undefined && stats[edge.from] !== undefined
          if (edge.back) {
            const x1 = X(from) + W / 2, x2 = X(to) + W / 2, y = Y + H
            return <path key={`${edge.from}-${edge.to}-${stats[edge.to]?.pulse ?? 0}`} className="dt-pipeline-edge dt-pipeline-back"
              data-active={active || undefined} data-flowing={flowing || undefined}
              d={`M${x1} ${y}C${x1} ${y + 26} ${x2} ${y + 26} ${x2} ${y + 2}`} markerEnd="url(#dt-arrow)" />
          }
          return <path key={`${edge.from}-${edge.to}-${stats[edge.to]?.pulse ?? 0}`} className="dt-pipeline-edge" data-active={active || undefined}
            data-flowing={flowing || undefined}
            d={`M${X(from) + W + 2} ${Y + H / 2}H${X(to) - 4}`} markerEnd="url(#dt-arrow)" />
        })}
      </svg>
      <ol className="dt-pipeline-nodes" style={{ ['--dt-pipeline-w' as string]: `${(W / width) * 100}%`,
        ['--dt-pipeline-gap' as string]: `${(GAP / width) * 100}%`, ['--dt-pipeline-h' as string]: `${H}px` }}>
        {PIPELINE.map(node => {
          const stat = stats[node]
          return <li key={node} className="dt-pipeline-node-slot" data-parts={parts?.[node]?.length || undefined}><button type="button" className="dt-pipeline-node" data-node={node}
            data-lit={lit.has(node) || undefined} data-near={near.has(node) || undefined} data-impact={reach.has(node) || undefined} data-state={stat?.state}
            data-pulse={stat?.pulse !== undefined || undefined} aria-current={lit.has(node) ? 'step' : undefined} onClick={() => pick(node)}
            title={t(`pipelineHint.${node}`)}>
            <span className="dt-pipeline-icon"><Icon name={STEPS[node].icon} size={16} />{stat?.pulse !== undefined
              && <span key={stat.pulse} className="dt-pipeline-ripple" aria-hidden="true" />}</span>
            <span className="dt-pipeline-text"><span className="dt-pipeline-name">{t(`pipeline.${node}`)}</span>
              <span className="dt-pipeline-sub">{stat?.value ?? t(`pipelineSub.${node}`)}</span></span>
          </button>
          {parts?.[node]?.length ? <ul className="dt-pipeline-parts" aria-label={t('pipelineParts', { step: t(`pipeline.${node}`) })}>
            {parts[node]!.map(part => { const here = focus?.part === part.id || (!!part.target && focus?.part === part.target)
              return <li key={part.id}><button type="button" className="dt-pipeline-part" data-part={part.id}
              data-lit={here || undefined} data-state={part.state} data-depth={part.depth || undefined} aria-current={here ? 'location' : undefined}
              style={part.hue === undefined ? undefined : { ['--dt-hue' as string]: part.hue }} data-hued={part.hue === undefined ? undefined : ''}
              title={part.value ? `${part.label}: ${part.value}` : part.label} onClick={() => openPart(node, part.target ?? part.id)}>
              <span className="dt-pipeline-part-label">{part.label}</span>
              {part.value && <span className="dt-pipeline-part-value">{part.value}</span>}
            </button></li> })}
          </ul> : null}</li>
        })}
      </ol>
    </div>
    {!compact && <figcaption className="dt-pipeline-trail" aria-live="polite">
      {crumbs.length ? <><span className="dt-pipeline-here">{t('pipelineHere')}</span>{crumbs.map((item, index) => <span key={index}
        className="dt-pipeline-crumb" data-last={index === crumbs.length - 1 || undefined}>{item}</span>)}{impact.length ? <span className="dt-pipeline-impact">{t('pipelineImpact', {
          steps: impact.map(node => t(`pipeline.${node}`)).join(' → ') })}</span> : null}</> : <span className="dt-hint">{t('pipelineIdle')}</span>}
    </figcaption>}
  </figure>
}
