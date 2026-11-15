/**
 * The command palette, the panel's one place to go anywhere (X-13, CMD-1): ⌘K (Ctrl+K elsewhere), `/` outside a field, or the header's
 * trigger opens it. What one types filters what the panel can do — open a page or a settings group, open the main Session, pause or
 * resume processing — and, from two characters, searches the host's Tickets, Threads and Triggers. The arrow keys pick, Enter runs or
 * opens (a Ticket or Thread opens in the drawer over the list), Escape closes.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SearchView } from './api.ts'
import { ticketMark } from './marks.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { usePause } from './actions.tsx'
import { SETTINGS_GROUPS, TABS, settingsRoute, type Route } from './route.ts'
import { actorName, errorText, readableMarkers, reasonLabel, valueLabel, when } from './text.ts'
import { Kbd, Icon, Modal, type IconName } from './ui/index.ts'

interface Command { id: string; label: ReactNode; text: string; hint: string; icon: IconName; group: string; run?: () => unknown }
const TAB_ICONS: Record<typeof TABS[number], IconName> = { overview: 'decision', source: 'inbox', trigger: 'message', eval: 'shield',
  execution: 'running', console: 'queue', settings: 'settings' }
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
/** The modifier the platform's shortcut uses, as its keyboard labels it (X-15). */
export const modifierKey = (): string => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  ? '⌘' : 'Ctrl'
/** How long the palette waits after the last keystroke before it searches the host. */
const SEARCH_SETTLE = 250

function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (index < 0) return <>{text}</>
  return <>{text.slice(0, index)}<mark className="dt-mark">{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}

export function CommandPalette() {
  const { t, navigate, openSession, notify, call } = usePanel()
  const { state, setup } = usePanelData()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [found, setFound] = useState<{ query: string; value: SearchView }>()
  const list = useRef<HTMLUListElement>(null)
  const pause = usePause()
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(value => !value) }
      else if (event.key === '/' && !typing(event.target) && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) { setQuery(''); setIndex(0); setFound(undefined) } }, [open])
  // Search the host once the person pauses typing, and show only the answer to the latest search.
  const latest = useRef(0)
  const search = (text: string) => {
    const request = ++latest.current
    if (text.length < 2) { setFound(undefined); return }
    call('GET search', { query: { q: text } }).then(value => { if (request === latest.current) setFound({ query: text, value }) },
      failure => { if (request === latest.current) notify(errorText(failure), 'danger') })
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const commands = useMemo((): Command[] => [
    ...TABS.filter(tab => tab !== 'settings').map(tab => ({ id: `tab:${tab}`, label: t(`tab.${tab}`), text: t(`tab.${tab}`),
      hint: t('commandOpenPage'), icon: TAB_ICONS[tab], group: t('commandGroupGo'), run: () => navigate({ page: tab } as never) })),
    ...SETTINGS_GROUPS.map(group => {
      const label = `${t('tab.settings')} › ${t(`settingsGroup.${group}`)}`
      return { id: `settings:${group}`, label, text: label, hint: t('commandOpenSettings'), icon: 'settings' as const, group: t('commandGroupGo'),
        run: () => navigate(settingsRoute(group)) }
    }),
    ...state?.masterId ? [{ id: 'master', label: t('openMaster'), text: t('openMaster'), hint: t('commandSession'), icon: 'session' as const,
      group: t('commandGroupDo'), run: () => openSession(state.masterId).catch(failure => notify(errorText(failure), 'danger')) }] : [],
    ...state ? [{ id: 'pause', label: t(state.paused ? 'commandResume' : 'commandPause'), text: t(state.paused ? 'commandResume' : 'commandPause'),
      hint: t('commandProcessing'), icon: state.paused ? 'play' as const : 'pause' as const, group: t('commandGroupDo'),
      run: () => pause.set(!state.paused) }] : [],
  ], [t, navigate, openSession, notify, state, pause])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matched = commands.filter(command => words.every(word => `${command.text} ${command.hint} ${command.id}`.toLowerCase().includes(word)))
  const results = useMemo((): Command[] => {
    if (!found) return []
    const go = (route: Route) => () => navigate(route)
    const q = found.query
    return [
      ...found.value.tickets.map(ticket => ({ id: `ticket:${ticket.id}`, label: <Highlight text={ticket.title} query={q} />, text: ticket.title,
        hint: ticket.stage === 'ended' ? t('ticket.ended') : ticketMark(t, ticket).label, icon: 'running' as const, group: t('term.ticket'),
        run: go({ page: 'execution', id: ticket.id }) })),
      ...found.value.threads.map(thread => ({ id: `thread:${thread.key}`, label: readableMarkers(t, thread.title),
        text: readableMarkers(t, thread.title), hint: t('term.thread'), icon: 'message' as const, group: t('term.thread'),
        run: go({ page: 'trigger', id: thread.key }) })),
      // A filtered Trigger has no Thread: it says why instead of opening an empty one.
      ...found.value.items.map(item => {
        const preview = readableMarkers(t, item.preview) || t('empty')
        const where = [valueLabel(t, 'source', item.source), actorName(t, item.actor), when(item.at, t('lang')),
          item.threadTitle ? t('inThread', { thread: readableMarkers(t, item.threadTitle) }) : ''].filter(Boolean).join(' · ')
        return { id: `trigger:${item.id}`, label: <Highlight text={preview} query={q} />, text: preview,
          hint: item.filtered !== undefined ? t('searchFiltered', { reason: reasonLabel(t, item.filtered) }) : where, icon: 'inbox' as const,
          group: t('term.trigger'), ...item.filtered === undefined ? { run: go({ page: 'trigger', id: item.threads[0]!, query: { trigger: item.id } }) } : {} }
      }),
    ]
  }, [found, navigate, t])
  const shown = [...matched, ...results]
  const runnable = shown.map((command, at) => command.run ? at : -1).filter(at => at >= 0)
  const run = (command: Command | undefined) => { if (!command?.run) return; setOpen(false); void command.run() }
  const step = (by: 1 | -1) => {
    if (!runnable.length) return
    const position = runnable.indexOf(index)
    const next = runnable[((position < 0 ? (by > 0 ? -1 : 0) : position) + by + runnable.length) % runnable.length]!
    setIndex(next); document.getElementById(`dt-command-${shown[next]!.id}`)?.scrollIntoView?.({ block: 'nearest' })
  }
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); step(event.key === 'ArrowDown' ? 1 : -1) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      // Enter before the pause runs the search at once.
      if (!shown.length && query.trim().length >= 2) { clearTimeout(timer.current); search(query.trim()) } else run(shown[index])
    }
  }
  const empty = found && !found.value.items.length && !found.value.threads.length && !found.value.tickets.length
  const counts = found && { tickets: found.value.tickets.length, threads: found.value.threads.length, items: found.value.items.length }
  const groups = shown.reduce<{ group: string; items: { command: Command; at: number }[] }[]>((all, command, at) => {
    const last = all.at(-1)
    if (last?.group === command.group) last.items.push({ command, at }); else all.push({ group: command.group, items: [{ command, at }] })
    return all
  }, [])
  const mod = modifierKey()
  return <>
    <button type="button" className="dt-command-trigger" aria-haspopup="dialog" aria-label={t('commandOpen')}
      aria-keyshortcuts={mod === '⌘' ? 'Meta+K /' : 'Control+K /'} onClick={() => setOpen(true)}>
      <Icon name="search" size={14} /><span>{t('commandPlaceholderShort')}</span><Kbd keys={[mod, 'K']} />
    </button>
    <Modal className="dt-command" open={open} onClose={() => setOpen(false)} title={t('commandTitle')} closeLabel={t('close')}>
      <div className="dt-command-body" onKeyDown={keys}>
        <input className="dt-command-input" autoFocus value={query} placeholder={t('commandPlaceholder')} aria-label={t('searchLabel')}
          role="combobox" aria-expanded="true" aria-controls="dt-command-list"
          aria-activedescendant={shown[index] ? `dt-command-${shown[index]!.id}` : undefined}
          onChange={event => {
            const value = event.target.value
            setQuery(value); setIndex(0); clearTimeout(timer.current)
            if (value.trim().length < 2) { latest.current++; setFound(undefined) }
            else timer.current = setTimeout(() => search(value.trim()), SEARCH_SETTLE)
          }} />
        <ul ref={list} id="dt-command-list" className="dt-command-list" role="listbox" aria-label={t('commandTitle')}>
          {groups.map(({ group, items }) => <Fragment key={group}>
            <li role="presentation" className="dt-command-group">{group}</li>
            {items.map(({ command, at }) => <li key={command.id} id={`dt-command-${command.id}`} role="option" aria-selected={at === index}
              aria-disabled={!command.run || undefined} className="dt-command-item" data-result={command.id.includes(':') && !command.id.startsWith('tab:')
                && !command.id.startsWith('settings:') || undefined}
              onMouseEnter={() => { if (command.run) setIndex(at) }} onClick={() => run(command)}>
              <span className="dt-command-icon"><Icon name={command.icon} size={15} /></span>
              <span className="dt-command-label">{command.label}</span><span className="dt-command-hint">{command.hint}</span>
            </li>)}
          </Fragment>)}
        </ul>
        {found && <p className="dt-hint dt-command-found" role="status">{empty ? t(setup?.accounts?.feishu ? 'searchNone' : 'searchNoneGithub')
          : t(found.value.items.length >= 20 ? 'searchFoundCapped' : 'searchFound', counts!)}</p>}
        {!shown.length && !found && <p className="dt-hint">{t('none')}</p>}
        <p className="dt-command-keys"><Kbd keys={['↑', '↓']} /> {t('commandKeysPick')} <Kbd keys={['Enter']} /> {t('commandKeysRun')}
          {' '}<Kbd keys={['Esc']} /> {t('close')} <Kbd keys={['/']} /> {t('commandKeysOpen')}</p>
      </div>
    </Modal>
  </>
}
