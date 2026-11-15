/** Root panel shell: header with the command palette (also the search) and glossary, top-level navigation tabs, and active route view. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeploymentForm } from './deployment.tsx'
import { EvalStatus } from './eval.tsx'
import { ExecutionStatus } from './execution.tsx'
import { GLOSSARY, GLOSSARY_VALUES, en, zh, type DshSuperagentKey } from './locales.ts'
import { OverviewPage } from './overview.tsx'
import { PanelProvider, usePanel, usePanelData } from './provider.tsx'
import { HOME, TABS, initialLocation, isDetail, lastSettingsGroup, remember, routeLabel, settingsRoute, type Location, type Route,
  type Tab } from './route.ts'
import { Drawer, IconButton, Button, Dot, Icon, Modal, PageTabs, FOCUS_FALLBACK } from './ui/index.ts'
import { SettingsPage } from './settings.tsx'
import { SourceStatus } from './source.tsx'
import { errorText, type T } from './text.ts'
import { ThreadPage } from './thread.tsx'
import { TicketPage } from './ticket.tsx'
import { TriggerStatus } from './trigger.tsx'
import { LoadState } from './widgets.tsx'
import { useLiveStatus } from './live.ts'
import { ConsolePage } from './console.tsx'
import { CommandPalette } from './command.tsx'

export interface AppProps {
  t: T; openSession: (sessionId: string) => Promise<void>
  deploymentForm: DeploymentForm
}

function Glossary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePanel()
  const chinese = t('tab.overview') === zh['tab.overview']
  const [own, other] = chinese ? [zh, en] : [en, zh]
  const heading = (group: keyof typeof GLOSSARY) => t(group === 'roles' ? 'glossaryGroup.roles' : `tab.${group}`)
  return <Modal size="lg" className="dt-glossary-modal" open={open} onClose={onClose} title={t('glossary')} closeLabel={t('close')}
    description={t('glossaryIntro')} footer={<Button variant="primary" onClick={onClose}>{t('close')}</Button>}>
    <div className="dt-glossary-body">
      <table className="dt-glossary">
        <thead><tr>
          <th>{t(chinese ? 'glossaryChinese' : 'glossaryEnglish')}</th><th>{t(chinese ? 'glossaryEnglish' : 'glossaryChinese')}</th>
          <th>{t('glossaryMeaning')}</th>
        </tr></thead>
        {Object.entries(GLOSSARY).map(([group, keys]) => <tbody key={group}>
          <tr><th colSpan={3} scope="rowgroup" className="dt-glossary-group">{heading(group as keyof typeof GLOSSARY)}</th></tr>
          {keys.map(key => <tr key={key}><td>{own[`term.${key}`]}</td><td>{other[`term.${key}`]}</td><td>{own[`meaning.${key}`]}</td></tr>)}
        </tbody>)}
      </table>
      <p className="dt-legend-title">{t('legendTitle')}</p>
      <ul className="dt-legend">{(['done', 'ongoing', 'warning', 'error', 'idle'] as const).map(state => <li key={state}>
        <Dot state={state} /><span>{t(`legend.${state}`)}</span>
      </li>)}</ul>
      <dl className="dt-values">{Object.entries(GLOSSARY_VALUES).map(([group, values]) => <div key={group} style={{ display: 'contents' }}>
        <dt>{own[`term.${group}` as DshSuperagentKey]}</dt>
        <dd>{values.map(key => `${own[key]} ${other[key]}`).join(' · ')}</dd>
      </div>)}</dl>
    </div>
  </Modal>
}

/** Whether the page updates as things happen, reconnects, or polls; hovering says what that means. */
export function LiveIndicator() {
  const { t } = usePanel()
  const status = useLiveStatus()
  const { updatedAt, error } = usePanelData()
  // Off the live feed, or when the last read failed, the page says how old what it shows is, so nothing passes for current that is not.
  const behind = status !== 'live' || !!error
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!behind) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [behind])
  const age = behind && updatedAt !== undefined ? ageText(t, Math.max(0, (now - updatedAt) / 1000)) : undefined
  return <span className="dt-live" data-status={status} data-behind={behind || undefined} role="status" title={t(`liveHint.${status}`)}>
    <span className="dt-live-dot" aria-hidden="true" />{t(`live.${status}`)}{age && <span className="dt-live-age"> · {t('liveAsOf', { age })}</span>}
  </span>
}
/** How long ago, in the coarsest unit that keeps it honest: seconds under a minute, then minutes. */
export function ageText(t: T, seconds: number): string {
  return seconds < 60 ? t('ageSeconds', { count: Math.max(1, Math.round(seconds)) }) : t('ageMinutes', { count: Math.floor(seconds / 60) })
}
/** The panel's header: the live state, the command palette (which is also the search), the glossary and the main Session. */
function Header({ masterId }: { masterId: string | undefined }) {
  const { t, openSession, notify } = usePanel()
  const [glossary, setGlossary] = useState(false)
  return <header className="dt-head">
    <div className="dt-head-title"><h1 className="dt-title">{t('title')}</h1></div>
    <div className="dt-toolbar">
      <LiveIndicator />
      <CommandPalette />
      <Button variant="ghost" size="sm" icon={<Icon name="question" />} aria-label={t('glossary')} title={t('glossary')} aria-haspopup="dialog"
        onClick={() => setGlossary(true)} />
      <Button variant="secondary" size="sm" icon={<Icon name="session" size={14} />} disabled={!masterId}
        onClick={() => { if (masterId) openSession(masterId).catch(failure => notify(errorText(failure), 'danger')) }}>{t('openMaster')}</Button>
    </div>
    <Glossary open={glossary} onClose={() => setGlossary(false)} />
  </header>
}

function detailPage(route: Route) {
  if (route.id === undefined) return null
  return route.page === 'trigger' ? <ThreadPage key={route.id} id={route.id} target={route.query?.trigger} />
    : <TicketPage key={route.id} id={route.id} />
}
/** The detail opened over a list: Escape or the close button returns to the list, focused on the row that opened it. */
function DetailDrawer({ drawer, onClose, onExpand }: { drawer: Route[]; onClose: () => void; onExpand: () => void }) {
  const { t } = usePanel()
  const top = drawer.at(-1)
  if (!top) return null
  return <Drawer open onClose={onClose} width="lg" closeLabel={t('close')} title={routeLabel(t, top)} contentKey={`${top.page}:${top.id ?? ''}`}
    subtitle={drawer.length > 1 ? drawer.slice(0, -1).map(route => routeLabel(t, route)).join(' › ') : undefined}
    actions={<IconButton icon="external" size="sm" label={t('openFullPage')} onClick={onExpand} />}>
    <div className="dt-drawer-detail" data-drawer-route={`${top.page}:${top.id ?? ''}`}>{detailPage(top)}</div>
  </Drawer>
}

function Pages({ route, drawer, openTab, closeDrawer, expandDrawer, deploymentForm }: { route: Route; drawer: Route[]; openTab: (tab: Tab) => void
  closeDrawer: () => void; expandDrawer: () => void; deploymentForm: DeploymentForm }) {
  const { t } = usePanel()
  const { state, error, reload } = usePanelData()
  // Keep the active tab scrolled into view on narrow screens when routes change via links.
  useEffect(() => { document.getElementById(`dt-tab-${route.page}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [route.page])
  // A link inside the page unmounts the element that had focus; keyboard users then continue from the new page, not from <body>.
  const shown = useRef(false)
  useEffect(() => {
    if (!shown.current) { shown.current = true; return }
    const active = document.activeElement
    if (!active || active === document.body) document.getElementById('dt-page')?.focus({ preventScroll: true })
  }, [route.page, route.id])
  // Until the panel's state arrives, Execution and Settings show a skeleton of their own shape rather than a line of text.
  const waiting = (shape: 'rows' | 'form') => <LoadState error={error} loading shape={shape} onRetry={() => { void reload() }} />
  const page = (() => {
    switch (route.page) {
      case 'overview': return <OverviewPage />
      case 'source': return <SourceStatus />
      case 'console': return <ConsolePage />
      case 'trigger': return route.id !== undefined ? detailPage(route)
        : <TriggerStatus filter={route.query?.filter ?? 'subscribed'} />
      case 'eval': return <EvalStatus filter={route.query?.filter ?? 'work'} window={route.query?.window}
        paused={!!state?.paused} />
      case 'execution': return route.id !== undefined ? detailPage(route)
        : state ? <ExecutionStatus filter={route.query?.filter ?? 'open'} state={state} reload={reload} /> : waiting('rows')
      case 'settings': return state ? <SettingsPage group={route.query.group} query={route.query} state={state}
        deploymentForm={deploymentForm} /> : waiting('form')
    }
  })()
  return <div className="dt-page">
    {/* WCAG 2.4.1: the first Tab stop skips the header and the page tabs straight to the page's content. */}
    <a className="dt-skip" href="#dt-page" onClick={event => {
      event.preventDefault()
      document.getElementById('dt-page')?.focus({ preventScroll: false })
    }}>{t('skipToMain')}</a>
    <div className="dt-column">
      <Header masterId={state?.masterId} />
      <LoadState error={error} loading={false} have={!!state} />
      <PageTabs label={t('pagesLabel')} value={route.page} onChange={openTab}
        items={TABS.map(value => ({ value, label: t(`tab.${value}`), id: `dt-tab-${value}`, panelId: 'dt-page' }))} />
      <main id="dt-page" role="tabpanel" aria-labelledby={`dt-tab-${route.page}`} className="dt-main" tabIndex={-1}
        {...{ [FOCUS_FALLBACK]: '' }}>{page}</main>
      <DetailDrawer drawer={drawer} onClose={closeDrawer} onExpand={expandDrawer} />
    </div>
  </div>
}

/** Below this width a detail takes the whole page instead of a drawer over the list. */
const DRAWER_MIN_WIDTH = 900
const roomForDrawer = () => typeof window !== 'undefined' && (window.matchMedia?.(`(min-width: ${DRAWER_MIN_WIDTH}px)`).matches
  ?? window.innerWidth >= DRAWER_MIN_WIDTH)

/** Root panel component managing route history, the detail drawer and shared panel state. */
export function App({ t, openSession, deploymentForm }: AppProps) {
  const [location, setLocation] = useState(initialLocation)
  useEffect(() => { remember(location) }, [location])
  // Preserve the last opened settings group across navigation so the Settings tab reopens at it.
  const move = useCallback((next: (current: Location) => Pick<Location, 'route' | 'stack' | 'drawer'>) =>
    setLocation(current => ({ ...next(current), group: lastSettingsGroup(current) })), [])
  /**
   * Navigates to `route`; `replace` swaps the current entry (filters, paging) instead of pushing a back step. A Ticket or Thread
   * opened from a list (or from a detail already in the drawer) opens in the drawer over the list when the panel is wide enough.
   */
  const navigate = useCallback((route: Route, replace = false) => move(current => {
    const drawer = current.drawer ?? []
    if (isDetail(route) && !isDetail(current.route) && (drawer.length || roomForDrawer())) {
      return { route: current.route, stack: current.stack, drawer: replace && drawer.length ? [...drawer.slice(0, -1), route]
        : [...drawer, route].slice(-20) }
    }
    return { route, stack: replace ? current.stack : [...current.stack, current.route].slice(-20) }
  }), [move])
  /** Back steps within the drawer first, then closes it, then walks the page history. */
  const back = useCallback(() => move(current => current.drawer?.length
    ? { route: current.route, stack: current.stack, drawer: current.drawer.length > 1 ? current.drawer.slice(0, -1) : undefined }
    : { route: current.stack.at(-1) ?? HOME, stack: current.stack.slice(0, -1) }), [move])
  const closeDrawer = useCallback(() => move(current => ({ route: current.route, stack: current.stack })), [move])
  const expandDrawer = useCallback(() => move(current => {
    const top = current.drawer?.at(-1)
    return top ? { route: top, stack: [...current.stack, current.route].slice(-20) } : current
  }), [move])
  const openTab = useCallback((tab: Tab) => move(current => ({ stack: [], route: tab === 'settings'
    ? settingsRoute(lastSettingsGroup(current)) : { page: tab, id: undefined } })), [move])
  const drawer = location.drawer ?? []
  const previous = drawer.length > 1 ? drawer.at(-2) : drawer.length ? location.route : location.stack.at(-1)
  return <PanelProvider t={t} openSession={openSession} navigate={navigate} back={back} backLabel={routeLabel(t, previous ?? HOME)}>
    <Pages route={location.route} drawer={drawer} openTab={openTab} closeDrawer={closeDrawer} expandDrawer={expandDrawer}
      deploymentForm={deploymentForm} />
  </PanelProvider>
}
