/** Context-aware shared UI widgets: page/section headers, timestamps, Markdown rendering, and confirmation actions. */
import { Fragment, useRef, useState, type ReactNode } from 'react'
import type { SetupProblem } from '../setup.ts'
import { Badge, EmptyState, KeyValue, LoadingBlock, Popover, Skeleton, Button, Icon, InfoTip, StateDot, type DotState, type IconName } from './ui/index.ts'
import { inlines, linkify, markdownBlocks, type Inline } from './markdown.ts'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { settingsRoute, type SettingsGroup } from './route.ts'
import { errorText, fullTime, readableMarkers, setupText, when } from './text.ts'

const external = { target: '_blank', rel: 'noopener noreferrer' } as const

export function When({ at }: { at: string | undefined }) {
  const { t } = usePanel()
  return <time dateTime={at} title={fullTime(at, t('lang'))}>{when(at, t('lang'))}</time>
}
export function SetupMessage({ problem, lead }: { problem: Pick<SetupProblem, 'code' | 'values'>; lead?: boolean }) {
  const { t } = usePanel()
  const text = setupText(t, problem)
  return <>
    {lead ? t('setupProblem', { detail: text }) : text}
    {problem.values.output && <span className="dt-detail dt-mono dt-clamp">{problem.values.output}</span>}
  </>
}
export function Section({ title, count, children, action, hint, badge, icon }: {
  title: string; count?: number | string; children: ReactNode; action?: ReactNode; hint?: string; badge?: ReactNode; icon?: IconName
}) {
  return <section className="dt-section">
    <h2 className="dt-section-title">
      {icon && <span className="dt-section-icon"><Icon name={icon} size={14} /></span>}<span className="dt-section-name">{title}</span>
      {count !== undefined && <span className="dt-count">{count}</span>}{hint && <InfoTip text={hint} />}{badge}
      {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
    </h2>
    {children}
  </section>
}
export function Hint({ children }: { children: ReactNode }) { return <p className="dt-hint">{children}</p> }
export function LabelValue({ label, value }: { label: string; value: ReactNode }) {
  return <span className="dt-lv"><span className="dt-lv-label">{label}</span> <span className="dt-lv-value">{value}</span></span>
}
/** Label–value pairs: the component library's KeyValue; empty values read as an em dash. */
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return <KeyValue dense items={rows.map(([label, value], index) => ({ key: `${index}`, label, value }))} />
}
/** An empty list: the component library's EmptyState, saying why it is empty and, when there is one, the next step. */
export function Empty({ children, action, icon = 'inbox' }: { children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return <EmptyState compact icon={icon} title={children} action={action} />
}

function Inlines({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => part.kind === 'bold' ? <strong key={index}>{part.text}</strong>
    : part.kind === 'code' ? <code key={index} className="dt-code">{part.text}</code>
    : part.kind === 'link' ? <a key={index} className="dt-inline-link" href={part.url} title={part.url} {...external}>{part.text}</a>
    : <Fragment key={index}>{part.text}</Fragment>)}</>
}
/** Renders a safe Markdown subset (headings, lists, paragraphs, bold, inline code, links) without interpreting raw HTML. */
export function MarkdownLite({ text }: { text: string }) {
  const { t } = usePanel()
  return <div className="dt-md">{markdownBlocks(readableMarkers(t, text)).map((block, index) => {
    if (block.kind !== 'list') return <p key={index} className={block.kind === 'heading' ? 'dt-md-heading' : undefined}><Inlines
      parts={inlines(block.text)} /></p>
    const items = block.items.map((item, at) => <li key={at}><Inlines parts={inlines(item)} /></li>)
    return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>
  })}</div>
}
function MoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = usePanel()
  return <button type="button" className="dt-textlink dt-more" aria-expanded={open} onClick={onToggle}>{open ? t('collapse')
    : t('expand')}</button>
}
export function ClampText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 480 || text.split('\n').length > 8
  return <>
    <div className={long && !open ? 'dt-event-text dt-clamp-8' : 'dt-event-text'}><Inlines parts={linkify(text)} /></div>
    {long && <MoreToggle open={open} onToggle={() => setOpen(!open)} />}
  </>
}

/**
 * A button whose action asks first, in a small confirm anchored to it (the audit's rule: only an action that cannot be undone asks).
 * `danger` marks it: the confirm reads as dangerous. The confirm stays open while the action runs and shows a failure in place;
 * Escape or a press outside closes it and returns focus to the button. `iconOnly` draws the button as an icon with `label` as its name.
 */
export function ConfirmButton({ label, title, message, onConfirm, variant = 'ghost', icon, danger, iconOnly }: {
  label: string; title: string; message: string; onConfirm: () => Promise<unknown>; variant?: 'ghost' | 'secondary'; icon?: IconName
  danger?: boolean; iconOnly?: boolean
}) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // A second press while the first runs does nothing, so a double click sends the action once.
  const running = useRef(false)
  const [failure, setFailure] = useState<string>()
  const change = (next: boolean) => { if (!busy) { setOpen(next); setFailure(undefined) } }
  return <Popover open={open} onOpenChange={change} label={title} className="dt-confirm" placement="bottom-end"
    trigger={props => <Button {...props} variant={variant} size="sm" icon={icon && <Icon name={icon} size={14} />}
      aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined}>{iconOnly ? undefined : label}</Button>}>
    {close => <div className="dt-confirm-body">
      <p className="dt-confirm-title">{title}</p>
      <p className="dt-confirm-message">{message}</p>
      {failure && <p className="dt-error" role="alert">{failure}</p>}
      <div className="dt-confirm-actions">
        <Button variant="ghost" size="sm" disabled={busy} onClick={close} autoFocus={danger}>{t('cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} size="sm" disabled={busy} autoFocus={!danger} onClick={() => {
          if (running.current) return
          running.current = true; setBusy(true)
          onConfirm().then(() => { running.current = false; setBusy(false); setOpen(false) },
            error => { running.current = false; setBusy(false); setFailure(errorText(error)) })
        }}>{t('confirm')}</Button>
      </div>
    </div>}
  </Popover>
}
export function SessionButton({ sessionId, label,
  variant = 'ghost' }: { sessionId: string; label?: string; variant?: 'ghost' | 'secondary' }) {
  const { t, openSession, notify } = usePanel()
  return <Button variant={variant} size="sm" icon={<Icon name="session" size={14} />}
    onClick={() => { openSession(sessionId).catch(error => notify(errorText(error), 'danger')) }}>{label ?? t('openSession')}</Button>
}
export function ExternalLink({ href, children, icon = 'external' }: { href: string; children: ReactNode; icon?: IconName }) {
  return <a className="dt-inline-link dt-icon-link" href={href} {...external}><Icon name={icon} size={13} />{children}</a>
}
export function ActionLink({ href, children, icon = 'external' }: { href: string; children: ReactNode; icon?: IconName }) {
  return <a className="hx-btn" data-variant="secondary" data-size="sm" href={href} {...external}><Icon name={icon}
    size={14} /><span className="hx-btn-label">{children}</span></a>
}
export function StageMark({ state, icon, label }: { state: DotState; icon: IconName; label: string }) {
  return <span className="dt-stage" data-state={state}>{state === 'ongoing' ? <StateDot state="ongoing" /> : <Icon name={icon}
    size={14} />}{label}</span>
}
/** The shape a region's first load takes, so the page does not jump when its content arrives. */
export type LoadShape = 'rows' | 'cards' | 'form'
function ShapedSkeleton({ shape, label }: { shape: LoadShape; label: string }) {
  if (shape === 'rows') return <LoadingBlock label={label} />
  return <div className="dt-skeleton-shape" data-shape={shape} role="status" aria-live="polite"><span className="hx-sr">{label}</span>
    {shape === 'cards' ? [0, 1, 2].map(index => <Skeleton key={index} height={88} radius="lg" />)
      : [0, 1, 2, 3].map(index => <div key={index} className="dt-skeleton-field"><Skeleton width="30%" height={12} /><Skeleton height={32}
        radius="md" /></div>)}
  </div>
}
/**
 * A region's load state. On its first load: a skeleton of its shape, or the error with a retry when it failed with nothing to show.
 * Once it has data (`have`), a failed refresh does not push the page: a small badge in a slot of no height says the data may be
 * out of date, and hovering it gives the error.
 */
export function LoadState({ error, loading, onRetry, have, shape = 'rows' }: { error?: Error | undefined; loading: boolean
  onRetry?: () => void; have?: boolean; shape?: LoadShape }) {
  const { t } = usePanel()
  if (have) return error ? <div className="dt-stale-slot"><span className="dt-stale" role="status" title={error.message}><Badge tone="warning"
    dot title={error.message}>{t('dataStale')}</Badge></span></div> : null
  if (error) return <EmptyState icon="alert" compact title={<span className="dt-error" role="alert">{error.message}</span>}
    action={onRetry && <Button variant="secondary" size="sm" icon={<Icon name="refresh" size={14} />} onClick={onRetry}>{t('retry')}</Button>} />
  return loading ? <ShapedSkeleton shape={shape} label={t('loading')} /> : null
}
/** A list whose rows may be the previous filter's while the new one loads: dimmed, busy and not clickable until it arrives. */
export function ListRegion({ stale, children }: { stale?: boolean; children: ReactNode }) {
  return <div className="dt-list-region" aria-busy={stale || undefined} data-stale={stale || undefined}>{children}</div>
}
export function LoadMore({ onMore }: { onMore: () => void }) {
  const { t } = usePanel()
  return <Button variant="secondary" size="sm" icon={<Icon name="chevron-down" size={14} />} onClick={onMore}>{t('loadMore')}</Button>
}

export function StatusHead({ hint, settings }: { hint: string; settings?: SettingsGroup }) {
  const { t, navigate } = usePanel()
  return <div className="dt-status-head">
    <h2 className="dt-status-title">{t('statusTitle')}<InfoTip text={hint} /></h2>
    {settings && <Button variant="ghost" size="sm" icon={<Icon name="settings" />}
      onClick={() => navigate(settingsRoute(settings))}>{t('tab.settings')}</Button>}
  </div>
}
export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { back, backLabel } = usePanel()
  return <div className="dt-page-head">
    <Button variant="ghost" size="sm" icon={<Icon name="chevron-left" />} onClick={back}>{backLabel}</Button>
    <div className="dt-page-title"><h2>{title}</h2>{children && <span className="dt-actions">{children}</span>}</div>
  </div>
}
/** Trigger a host setup re-check and restart, prompting for confirmation when running Assignments would be interrupted. */
export function CheckSetupButton() {
  const { t, call, notify, restart } = usePanel()
  const { running } = usePanelData()
  const check = async () => { await call('POST setup/check'); notify(t('setupChecking')); restart() }
  const action = useAction(check)
  if (running > 0) {
    const message = t('setupCheckInterrupts', { count: running })
    return <ConfirmButton variant="secondary" icon="refresh" label={t('setupCheck')} title={t('setupCheck')} message={message}
      onConfirm={check} />
  }
  const icon = <Icon name="refresh" size={14} />
  return <Button variant="secondary" size="sm" icon={icon} disabled={action.busy}
    onClick={() => { void action.run() }}>{t('setupCheck')}</Button>
}
