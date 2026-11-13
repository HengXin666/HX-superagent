/**
 * The command palette: ⌘K (Ctrl+K) or `/` outside a field opens it; typing filters what the panel can do — open a page or a
 * settings group, open the main Session, pause or resume processing — the arrow keys pick and Enter runs.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon, Modal, type IconName } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { SETTINGS_GROUPS, TABS, settingsRoute } from './route.ts'
import { errorText } from './text.ts'

interface Command { id: string; label: string; hint: string; icon: IconName; run: () => unknown }
const TAB_ICONS: Record<typeof TABS[number], IconName> = { overview: 'decision', source: 'inbox', trigger: 'message', eval: 'shield',
  execution: 'running', console: 'queue', settings: 'settings' }
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function CommandPalette() {
  const { t, navigate, openSession, notify, call } = usePanel()
  const { state, reload } = usePanelData()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const pause = useAction(async (paused: boolean) => { await call('POST executor/pause', { body: { paused } }); notify(t(paused ? 'commandPaused' : 'commandResumed')) },
    { reload })
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(value => !value) }
      else if (event.key === '/' && !typing(event.target) && !event.metaKey && !event.ctrlKey) { event.preventDefault(); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) { setQuery(''); setIndex(0) } }, [open])
  const commands = useMemo((): Command[] => [
    ...TABS.filter(tab => tab !== 'settings').map(tab => ({ id: `tab:${tab}`, label: t(`tab.${tab}`), hint: t('commandOpenPage'), icon: TAB_ICONS[tab],
      run: () => navigate({ page: tab } as never) })),
    ...SETTINGS_GROUPS.map(group => ({ id: `settings:${group}`, label: `${t('tab.settings')} › ${t(`settingsGroup.${group}`)}`,
      hint: t('commandOpenSettings'), icon: 'settings' as const, run: () => navigate(settingsRoute(group)) })),
    ...state?.masterId ? [{ id: 'master', label: t('openMaster'), hint: t('commandSession'), icon: 'session' as const,
      run: () => openSession(state.masterId).catch(failure => notify(errorText(failure))) }] : [],
    ...state ? [{ id: 'pause', label: t(state.paused ? 'commandResume' : 'commandPause'), hint: t('commandProcessing'),
      icon: state.paused ? 'play' as const : 'pause' as const, run: () => pause.run(!state.paused) }] : [],
  ], [t, navigate, openSession, notify, state, pause])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = commands.filter(command => words.every(word => `${command.label} ${command.hint} ${command.id}`.toLowerCase().includes(word)))
  const run = (command: Command | undefined) => { if (!command) return; setOpen(false); void command.run() }
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length)
      setIndex(next); list.current?.children[next]?.scrollIntoView?.({ block: 'nearest' })
    } else if (event.key === 'Enter') { event.preventDefault(); run(shown[index]) }
  }
  return <>
    <button type="button" className="dt-command-trigger" aria-haspopup="dialog" aria-label={t('commandOpen')} onClick={() => setOpen(true)}>
      <Icon name="search" size={14} /><span>{t('commandPlaceholderShort')}</span><kbd className="dt-kbd">⌘K</kbd>
    </button>
    <Modal className="dt-command" open={open} onClose={() => setOpen(false)} title={t('commandTitle')} closeLabel={t('close')}>
      <div className="dt-command-body" onKeyDown={keys}>
        <input className="dt-command-input" autoFocus value={query} placeholder={t('commandPlaceholder')} aria-label={t('commandPlaceholder')}
          role="combobox" aria-expanded="true" aria-controls="dt-command-list" aria-activedescendant={shown[index] ? `dt-command-${shown[index]!.id}` : undefined}
          onChange={event => { setQuery(event.target.value); setIndex(0) }} />
        <ul ref={list} id="dt-command-list" className="dt-command-list" role="listbox">{shown.map((command, at) => <li key={command.id}
          id={`dt-command-${command.id}`} role="option" aria-selected={at === index} className="dt-command-item"
          onMouseEnter={() => setIndex(at)} onClick={() => run(command)}>
          <span className="dt-command-icon"><Icon name={command.icon} size={15} /></span>
          <span className="dt-command-label">{command.label}</span><span className="dt-command-hint">{command.hint}</span>
        </li>)}</ul>
        {!shown.length && <p className="dt-hint">{t('none')}</p>}
      </div>
    </Modal>
  </>
}
