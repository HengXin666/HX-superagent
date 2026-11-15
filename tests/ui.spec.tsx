// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Button, Combobox, ConfirmDialog, DataTable, DisclosureRow, Drawer, EmptyState, FOCUS_FALLBACK, IconButton, KeyValue, Kbd, Modal, MultiSelect, Pill, Popover,
  SegmentedControl, Select, Switch, Tabs, TabPanel, Textarea, ToastProvider, Tooltip, reorder, useDraft, useOptimistic, useToast, viewRows, type Column } from '../src/client/ui/index.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

let root: Root | undefined, host: HTMLElement | undefined
async function mount(node: ReactNode) {
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.body.innerHTML = ''; root = undefined })
const key = async (target: Element | Document, k: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })) })
const frame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
const click = async (element: Element) => act(async () => { (element as HTMLElement).click() })
const type = async (input: HTMLInputElement, value: string) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }))
})

it('keeps every ui class it styles in use, and colors only through alias tokens', () => {
  const dir = join(process.cwd(), 'src/client/ui')
  const css = readFileSync(join(dir, 'ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const code = readdirSync(dir).filter(name => /\.tsx?$/.test(name)).map(name => readFileSync(join(dir, name), 'utf8')).join('\n')
  const classes = new Set([...css.matchAll(/\.(hx-[\w-]+)/g)].map(match => match[1]!))
  expect([...classes].filter(name => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code))).toEqual([])
  expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi)).toBeNull()
  for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name), 'utf8')).not.toMatch(/from '@deepseek-ai\//)
})

it('Button blocks clicks while busy but stays focusable; IconButton exposes its label', async () => {
  const onClick = vi.fn()
  const el = await mount(<><Button busy onClick={onClick}>Save</Button><IconButton icon="trash" label="Delete" /></>)
  const button = el.querySelector('button')!
  await click(button)
  expect(onClick).not.toHaveBeenCalled()
  expect(button.disabled).toBe(false)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(el.querySelector('[aria-label="Delete"]')?.getAttribute('title')).toBe('Delete')
})

it('Switch toggles and reports its state', async () => {
  function Harness() { const [on, setOn] = useState(false); return <Switch checked={on} onChange={setOn} label="Enabled" /> }
  const el = await mount(<Harness />)
  const sw = el.querySelector('[role="switch"]')!
  await click(sw)
  expect(sw.getAttribute('aria-checked')).toBe('true')
})

it('Tabs move with arrows, wrap, skip disabled tabs and wire tabpanels', async () => {
  function Harness() {
    const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
    return <><Tabs idBase="t" label="Views" value={tab} onChange={setTab}
      items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C', count: 3 }]} />
      <TabPanel idBase="t" value={tab} active>{tab}</TabPanel></>
  }
  const el = await mount(<Harness />)
  const first = el.querySelector<HTMLElement>('#t-tab-a')!
  first.focus()
  await key(first, 'ArrowRight')
  expect(document.activeElement?.id).toBe('t-tab-c')
  expect(el.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('t-tab-c')
  await key(document.activeElement!, 'ArrowRight')
  expect(document.activeElement?.id).toBe('t-tab-a')
})

const options = [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }, { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  { value: 'gpt', label: 'GPT', disabled: true }, { value: 'qwen', label: 'Qwen' }]

it('Select opens from the keyboard, skips disabled options, picks with Enter and returns focus', async () => {
  const onChange = vi.fn()
  const el = await mount(<Select label="Model" options={options} value="deepseek-chat" onChange={onChange} />)
  const button = el.querySelector<HTMLButtonElement>('[role="combobox"]')!
  button.focus()
  await key(button, 'ArrowDown')
  expect(button.getAttribute('aria-expanded')).toBe('true')
  await key(button, 'ArrowDown'); await key(button, 'ArrowDown')
  expect(button.getAttribute('aria-activedescendant')).toMatch(/-3$/)
  await key(button, 'Enter')
  expect(onChange).toHaveBeenCalledWith('qwen')
  expect(document.activeElement).toBe(button)
  expect(document.querySelector('[role="listbox"]')).toBeNull()
})

it('Select type-ahead jumps to a matching label', async () => {
  const el = await mount(<Select label="Model" options={options} value={undefined} onChange={() => {}} />)
  const button = el.querySelector<HTMLButtonElement>('[role="combobox"]')!
  await key(button, 'Enter'); await key(button, 'q')
  expect(button.getAttribute('aria-activedescendant')).toMatch(/-3$/)
})

it('Combobox filters while typing, picks with Enter, and Escape restores the committed label', async () => {
  function Harness() { const [v, setV] = useState<string | null>('deepseek-chat'); return <><Combobox label="Model" options={options} value={v} onChange={setV} /><output>{v}</output></> }
  const el = await mount(<Harness />)
  const input = el.querySelector<HTMLInputElement>('input')!
  input.focus()
  await type(input, 'reason')
  expect(document.querySelectorAll('[role="option"]').length).toBe(1)
  await key(input, 'Enter')
  expect(el.querySelector('output')?.textContent).toBe('deepseek-reasoner')
  expect(input.value).toBe('DeepSeek Reasoner')
  await type(input, 'zzz'); await key(input, 'Escape')
  expect(input.value).toBe('DeepSeek Reasoner')
})

it('Combobox accepts free text when allowCustom is set', async () => {
  const onChange = vi.fn()
  const el = await mount(<Combobox label="Model" options={options} value={null} onChange={onChange} allowCustom />)
  const input = el.querySelector<HTMLInputElement>('input')!
  await type(input, ' my-model ')
  await key(input, 'Enter')
  expect(onChange).toHaveBeenLastCalledWith('my-model')
})

it('reorder moves one item and clamps the target', () => {
  expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  expect(reorder(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
  expect(reorder(['a'], 3, 0)).toEqual(['a'])
})

it('MultiSelect adds from the list, reorders with Alt+arrows, removes with Delete, and announces moves', async () => {
  function Harness() {
    const [v, setV] = useState<string[]>(['qwen'])
    return <><MultiSelect label="Presets" options={options} value={v} onChange={setV}
      labels={{ remove: item => `Remove ${item}`, moved: (item, at, total) => `${item} moved to ${at} of ${total}` }} /><output>{v.join(',')}</output></>
  }
  const el = await mount(<Harness />)
  const input = el.querySelector<HTMLInputElement>('input')!
  await type(input, 'chat'); await key(input, 'Enter')
  expect(el.querySelector('output')?.textContent).toBe('qwen,deepseek-chat')
  expect(input.value).toBe('')
  const chips = () => [...el.querySelectorAll<HTMLElement>('.hx-chip')]
  chips()[1]!.focus()
  await key(chips()[1]!, 'ArrowLeft', { altKey: true }); await frame()
  expect(el.querySelector('output')?.textContent).toBe('deepseek-chat,qwen')
  expect(document.activeElement).toBe(chips()[0])
  expect(el.querySelector('[aria-live]')?.textContent).toBe('DeepSeek Chat moved to 1 of 2')
  await key(chips()[0]!, 'Delete'); await frame()
  expect(el.querySelector('output')?.textContent).toBe('qwen')
})

it('MultiSelect reorders by drag and drop', async () => {
  const onChange = vi.fn()
  const el = await mount(<MultiSelect label="P" options={options} value={['qwen', 'deepseek-chat', 'deepseek-reasoner']} onChange={onChange}
    labels={{ remove: i => i, moved: () => '' }} />)
  const chips = [...el.querySelectorAll<HTMLElement>('.hx-chip')]
  const drag = (target: Element, name: string) => act(async () => {
    const event = new Event(name, { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, effectAllowed: '' } })
    target.dispatchEvent(event)
  })
  await drag(chips[2]!, 'dragstart'); await drag(chips[0]!, 'dragover'); await drag(chips[0]!, 'drop')
  expect(onChange).toHaveBeenCalledWith(['deepseek-reasoner', 'qwen', 'deepseek-chat'])
})

it('Drawer traps focus, closes on Escape and returns focus to the row that opened it', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <><button type="button" onClick={() => setOpen(true)}>row</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Ticket #1" closeLabel="Close"><input aria-label="note" /></Drawer></>
  }
  const el = await mount(<Harness />)
  const opener = el.querySelector('button')!
  opener.focus(); await click(opener)
  const dialog = document.querySelector('[role="dialog"]')!
  expect(document.activeElement).toBe(dialog)
  expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id)
  await key(document, 'Tab'); await key(document, 'Tab', { shiftKey: true })
  expect(dialog.contains(document.activeElement)).toBe(true)
  await key(document, 'Escape')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('ConfirmDialog stays open while an async confirm runs and shows its error in place', async () => {
  let fail = true
  const onClose = vi.fn()
  await mount(<ConfirmDialog open onClose={onClose} title="Delete preset?" danger labels={{ confirm: 'Delete', cancel: 'Cancel', close: 'Close' }}
    onConfirm={async () => { if (fail) throw new Error('409 conflict') }} />)
  expect(document.activeElement?.textContent).toBe('Cancel')
  const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Delete')!
  await click(confirm)
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('409 conflict')
  expect(onClose).not.toHaveBeenCalled()
  fail = false
  await click(confirm)
  expect(onClose).toHaveBeenCalled()
})

it('Popover opens from its trigger, closes on Escape and outside press, and returns focus', async () => {
  const el = await mount(<><Popover label="Filters" trigger={props => <button type="button" {...props}>filters</button>}><input aria-label="q" /></Popover>
    <p>outside</p></>)
  const trigger = el.querySelector('button')!
  trigger.focus(); await click(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(trigger.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('dialog')
  await key(document, 'Escape')
  expect(document.querySelector('.hx-popover')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await click(trigger)
  await act(async () => { el.querySelector('p')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  expect(document.querySelector('.hx-popover')).toBeNull()
})

it('Tooltip shows after the hover delay, describes its trigger and hides on Escape', async () => {
  vi.useFakeTimers()
  try {
    const el = await mount(<Tooltip content="Runs every 5 minutes"><button type="button">i</button></Tooltip>)
    const button = el.querySelector('button')!
    await act(async () => { button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })) })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(450) })
    const tip = document.querySelector('[role="tooltip"]')!
    expect(button.getAttribute('aria-describedby')).toBe(tip.id)
    await key(document, 'Escape')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  } finally { vi.useRealTimers() }
})

it('Toast replaces by id, keeps errors until dismissed and auto-dismisses others', async () => {
  vi.useFakeTimers()
  try {
    let api!: ReturnType<typeof useToast>
    function Grab() { api = useToast(); return null }
    await mount(<ToastProvider closeLabel="Dismiss"><Grab /></ToastProvider>)
    await act(async () => { api.show({ id: 'save', title: 'Saving…' }) })
    await act(async () => { api.success('Saved', { id: 'save' }) })
    expect([...document.querySelectorAll('.hx-toast')].map(node => node.textContent)).toEqual(['Saved'])
    await act(async () => { api.error('Failed') })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Failed')
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect([...document.querySelectorAll('.hx-toast-title')].map(node => node.textContent)).toEqual(['Failed'])
  } finally { vi.useRealTimers() }
})

type Row = { id: string; name: string; runs: number }
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', sortable: true }, { key: 'runs', header: 'Runs', sortable: true, align: 'end' }]

it('viewRows filters across columns and sorts stably with empty values last', () => {
  const rows = [{ id: '1', name: 'beta', runs: 2 }, { id: '2', name: 'alpha', runs: 10 }, { id: '3', name: '', runs: 2 }]
  expect(viewRows(rows, columns, '', { key: 'name', dir: 'desc' }).map(row => row.id)).toEqual(['1', '2', '3'])
  expect(viewRows(rows, columns, '', { key: 'runs', dir: 'asc' }).map(row => row.id)).toEqual(['1', '3', '2'])
  expect(viewRows(rows, columns, 'alp', undefined).map(row => row.id)).toEqual(['2'])
})

it('DataTable sorts from the header, opens rows with Enter, moves with arrows and filters', async () => {
  const onRowClick = vi.fn()
  const rows = [{ id: '1', name: 'beta', runs: 2 }, { id: '2', name: 'alpha', runs: 10 }]
  const el = await mount(<DataTable label="Tickets" rows={rows} columns={columns} rowKey={row => row.id} onRowClick={onRowClick}
    filter={{ label: 'Filter', placeholder: 'Filter' }} empty={<EmptyState title="Nothing" compact />} />)
  const header = el.querySelector<HTMLButtonElement>('th button')!
  await click(header)
  expect(el.querySelector('th')?.getAttribute('aria-sort')).toBe('ascending')
  const names = () => [...el.querySelectorAll('tbody tr')].map(tr => tr.firstElementChild?.textContent)
  expect(names()).toEqual(['alpha', 'beta'])
  const first = el.querySelector<HTMLElement>('tbody tr')!
  first.focus(); await key(first, 'ArrowDown'); await frame()
  expect(document.activeElement?.getAttribute('data-row')).toBe('1')
  await key(document.activeElement!, 'Enter')
  expect(onRowClick).toHaveBeenCalledWith(rows[0])
  await type(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'zzz')
  expect(el.textContent).toContain('Nothing')
})

it('DataTable renders only a window of rows when virtualized', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `row ${i}`, runs: i }))
  const el = await mount(<DataTable label="Big" rows={rows} columns={columns} rowKey={row => row.id} height={400} rowHeight={40} />)
  const rendered = el.querySelectorAll('tbody tr.hx-tr').length
  expect(rendered).toBeGreaterThan(5)
  expect(rendered).toBeLessThan(40)
  expect(el.querySelector('table')?.getAttribute('aria-rowcount')).toBe('1001')
})

it('KeyValue shows an em dash for empty values; Kbd renders chords', async () => {
  const el = await mount(<><KeyValue items={[{ key: 'a', label: 'Model', value: '' }]} /><Kbd keys={['⌘', 'K']} /></>)
  expect(el.querySelector('dd')?.textContent).toBe('—')
  expect(el.querySelectorAll('kbd').length).toBe(2)
})

it('Textarea grows with content up to maxRows', async () => {
  const el = await mount(<Textarea value={'a\nb'} onChange={() => {}} />)
  expect(el.querySelector('textarea')?.style.height).toMatch(/px$/)
})

it('useOptimistic applies at once and rolls back on failure', async () => {
  let run!: (next: boolean, fail: boolean) => Promise<void>
  function Harness({ server }: { server: boolean }) {
    const [value, apply] = useOptimistic(server)
    run = (next, fail) => apply(next, async () => { if (fail) throw new Error('nope') }).catch(() => {})
    return <output>{String(value)}</output>
  }
  const el = await mount(<Harness server={false} />)
  await act(async () => { await run(true, false) })
  expect(el.textContent).toBe('true')
  await act(async () => { await run(false, true) })
  expect(el.textContent).toBe('true')
})

it('useDraft follows live server values while clean and keeps edits (flagging stale) while dirty', async () => {
  let api!: ReturnType<typeof useDraft<string>>
  function Harness({ server }: { server: string }) { api = useDraft(server); return <output>{api.draft}</output> }
  const el = await mount(<Harness server="a" />)
  await act(async () => { root!.render(<Harness server="b" />) })
  expect(el.textContent).toBe('b')
  await act(async () => { api.setDraft('mine') })
  await act(async () => { root!.render(<Harness server="c" />) })
  expect(el.textContent).toBe('mine')
  expect(api.dirty && api.stale).toBe(true)
  await act(async () => { api.reset() })
  expect(el.textContent).toBe('c')
})

/** Waits past an animation frame (focus moves that wait for the next render). */
const paint = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })

it('moves a radio group with every arrow, wrapping at the ends, and keeps one Tab stop', async () => {
  function Radios() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
    return <SegmentedControl label="mode" value={value} onChange={setValue}
      options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} />
  }
  const el = await mount(<Radios />)
  const checked = () => el.querySelector('[aria-checked="true"]')!
  const group = el.querySelector('[role="radiogroup"]')!
  ;(checked() as HTMLElement).focus()
  await key(document.activeElement!, 'ArrowDown'); await paint()
  expect(checked().textContent).toBe('B')
  expect(document.activeElement).toBe(checked())
  await key(document.activeElement!, 'ArrowUp'); await key(document.activeElement!, 'ArrowUp'); await paint()
  expect(checked().textContent).toBe('C')
  await key(document.activeElement!, 'ArrowRight'); await paint()
  expect(checked().textContent).toBe('A')
  expect([...group.querySelectorAll('[role="radio"]')].map(radio => (radio as HTMLElement).tabIndex)).toEqual([0, -1, -1])
})

it('skips disabled tabs, wraps, and points aria-controls only at the panel that exists', async () => {
  function Tabbed() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
    return <><Tabs idBase="t" label="views" value={value} onChange={setValue}
      items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }]} />
      <TabPanel idBase="t" value={value} active>{value}</TabPanel></>
  }
  const el = await mount(<Tabbed />)
  ;(el.querySelector('[aria-selected="true"]') as HTMLElement).focus()
  await key(document.activeElement!, 'ArrowRight')
  expect(document.activeElement?.textContent).toBe('C')
  await key(document.activeElement!, 'ArrowRight')
  expect(document.activeElement?.textContent).toBe('A')
  for (const tab of el.querySelectorAll('[role="tab"]')) {
    const controls = tab.getAttribute('aria-controls')
    if (controls) expect(document.getElementById(controls)).not.toBeNull()
  }
  expect(el.querySelectorAll('[aria-controls]')).toHaveLength(1)
})

it('keeps focus on a field that took it when a dialog opened, and returns it to the opener when the dialog closes', async () => {
  function WithField() {
    const [open, setOpen] = useState(false)
    return <><Button onClick={() => setOpen(true)}>open</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="search" closeLabel="close"><input aria-label="query" autoFocus /></Modal></>
  }
  const el = await mount(<WithField />)
  const opener = el.querySelector('button')!
  opener.focus()
  await click(opener)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('query')
  await key(document.activeElement!, 'Escape')
  expect(document.activeElement).toBe(opener)
})

it('sends focus to the page fallback region when the element that opened a drawer is gone', async () => {
  function Gone() {
    const [open, setOpen] = useState(false)
    const [row, setRow] = useState(true)
    return <main tabIndex={-1} {...{ [FOCUS_FALLBACK]: '' }} aria-label="page">
      {row && <Button onClick={() => setOpen(true)}>row</Button>}
      <Drawer open={open} onClose={() => setOpen(false)} title="detail" closeLabel="close">
        <Button onClick={() => setRow(false)}>delete row</Button></Drawer></main>
  }
  const el = await mount(<Gone />)
  const row = el.querySelector('button')!
  row.focus(); await click(row)
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'delete row')!)
  await key(document.activeElement!, 'Escape')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('page')
})

it('hides a tooltip on Escape without closing the dialog around it', async () => {
  function Tipped() {
    const [open, setOpen] = useState(true)
    return <Modal open={open} onClose={() => setOpen(false)} title="dialog" closeLabel="close">
      <Tooltip content="explains" delay={0}><button type="button">tipped</button></Tooltip></Modal>
  }
  await mount(<Tipped />)
  const tipped = [...document.querySelectorAll('button')].find(button => button.textContent === 'tipped')!
  await act(async () => { tipped.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  await paint()
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
  await key(tipped, 'Escape')
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await key(tipped, 'Escape')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('moves focus to the input when the last chip of a MultiSelect is removed', async () => {
  function One() {
    const [value, setValue] = useState(['x'])
    return <MultiSelect label="items" value={value} onChange={setValue} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]}
      labels={{ remove: item => `remove ${item}`, moved: () => '' }} />
  }
  const el = await mount(<One />)
  const chip = el.querySelector<HTMLElement>('.hx-chip')!
  chip.focus()
  await key(chip, 'Delete'); await paint()
  expect(el.querySelector('.hx-chip')).toBeNull()
  expect(document.activeElement?.tagName).toBe('INPUT')
})

it('Pill is a toggle button that Enter and Space press, with aria-pressed', async () => {
  function Harness() { const [on, setOn] = useState(false); return <Pill active={on} onClick={() => setOn(!on)}>Open</Pill> }
  const el = await mount(<Harness />)
  const pill = el.querySelector<HTMLButtonElement>('button')!
  expect(pill.getAttribute('type')).toBe('button')
  expect(pill.getAttribute('aria-pressed')).toBe('false')
  await click(pill)
  expect(pill.getAttribute('aria-pressed')).toBe('true')
})

it('DisclosureRow toggles on Enter and Space, with aria-expanded and aria-controls pointing at the content it shows', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <DisclosureRow icon={<span />} title="Rule" open={open} onToggle={() => setOpen(!open)}><p>details</p></DisclosureRow>
  }
  const el = await mount(<Harness />)
  const row = el.querySelector<HTMLElement>('[role="button"]')!
  expect(row.tabIndex).toBe(0)
  expect(row.getAttribute('aria-expanded')).toBe('false')
  expect(row.hasAttribute('aria-controls')).toBe(false)
  await key(row, 'Enter')
  expect(row.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(row.getAttribute('aria-controls')!)?.textContent).toBe('details')
  await key(row, ' ')
  expect(row.getAttribute('aria-expanded')).toBe('false')
  expect(el.textContent).not.toContain('details')
})
