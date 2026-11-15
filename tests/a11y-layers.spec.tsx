// @vitest-environment jsdom
// Automated accessibility check (axe-core) of every component in its open, layered state: the page-level run in a11y.spec.tsx
// only sees what a page shows at rest, so an open listbox, popover, tooltip or dialog is checked here. Same bar: zero `critical`
// and zero `serious` violations, with the same rules left to the screenshot pass.
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Combobox, ConfirmDialog, DataTable, DisclosureRow, Drawer, EmptyState, Modal, MultiSelect, Pill, Popover, SegmentedControl, Select,
  Switch, Tabs, TabPanel, Tooltip, type Column } from '../src/client/ui/index.ts'
import { severe } from './fixtures/axe.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

let root: Root | undefined, host: HTMLElement | undefined
async function mount(node: ReactNode) {
  host = document.createElement('main'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.body.innerHTML = ''; root = undefined })
const key = async (target: Element | Document, k: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const paint = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
const type = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

const options = [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }, { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  { value: 'gpt', label: 'GPT', disabled: true }, { value: 'qwen', label: 'Qwen' }]
interface Row { id: string; name: string; runs: number }
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', sortable: true }, { key: 'runs', header: 'Runs', sortable: true, align: 'end' }]

it('has no severe violations in the controls at rest: tabs, radio group, switch, pills, disclosure, table and chip list', async () => {
  function Controls() {
    const [tab, setTab] = useState<'a' | 'b'>('a')
    const [mode, setMode] = useState<'on' | 'off'>('on')
    const [open, setOpen] = useState(true)
    const [chips, setChips] = useState(['qwen', 'deepseek-chat'])
    return <>
      <Tabs idBase="v" label="Views" value={tab} onChange={setTab} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
      <TabPanel idBase="v" value={tab} active>panel {tab}</TabPanel>
      <SegmentedControl label="Mode" value={mode} onChange={setMode} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      <Switch label="Enabled" checked onChange={() => {}} />
      <Pill active onClick={() => {}}>Open</Pill>
      <DisclosureRow icon={<span />} title="Rule" open={open} onToggle={() => setOpen(!open)}><p>body</p></DisclosureRow>
      <DataTable label="Tickets" rows={[{ id: '1', name: 'beta', runs: 2 }]} columns={columns} rowKey={row => row.id} onRowClick={() => {}}
        empty={<EmptyState title="Nothing" compact />} />
      <MultiSelect label="Presets" options={options} value={chips} onChange={setChips}
        labels={{ remove: item => `Remove ${item}`, moved: (item, at, total) => `${item} moved to ${at} of ${total}` }} />
    </>
  }
  await mount(<Controls />)
  expect(await severe()).toEqual([])
})

it('has no severe violations with a Select listbox open', async () => {
  const el = await mount(<Select label="Model" options={options} value="qwen" onChange={() => {}} />)
  const button = el.querySelector<HTMLElement>('[role="combobox"]')!
  button.focus(); await key(button, 'ArrowDown'); await paint()
  expect(document.querySelector('[role="listbox"]')).not.toBeNull()
  expect(await severe()).toEqual([])
})

it('has no severe violations with a Combobox list open while typing', async () => {
  const el = await mount(<Combobox label="Model" options={options} value={null} onChange={() => {}} />)
  const input = el.querySelector<HTMLInputElement>('input')!
  input.focus(); await type(input, 'deep'); await paint()
  expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
  expect(await severe()).toEqual([])
})

it('has no severe violations with a Popover and a Tooltip open', async () => {
  const el = await mount(<><Popover label="Filters" trigger={props => <button type="button" {...props}>filters</button>}>
    <input aria-label="query" /></Popover>
    <Tooltip content="Runs every 5 minutes" delay={0}><button type="button">info</button></Tooltip></>)
  const [trigger, tipped] = [...el.querySelectorAll('button')]
  trigger!.focus(); await act(async () => { trigger!.click() })
  await act(async () => { tipped!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) }); await paint()
  expect(document.querySelector('.hx-popover')).not.toBeNull()
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
  expect(await severe()).toEqual([])
})

it('has no severe violations with a Modal, a ConfirmDialog and a Drawer open', async () => {
  await mount(<Modal open onClose={() => {}} title="Glossary" closeLabel="Close"><p>terms</p></Modal>)
  expect(await severe()).toEqual([])
  act(() => root?.unmount()); document.body.innerHTML = ''
  await mount(<ConfirmDialog open onClose={() => {}} title="Delete preset?" danger labels={{ confirm: 'Delete', cancel: 'Cancel', close: 'Close' }}
    onConfirm={async () => {}} />)
  expect(await severe()).toEqual([])
  act(() => root?.unmount()); document.body.innerHTML = ''
  await mount(<Drawer open onClose={() => {}} title="Ticket #1" closeLabel="Close"><input aria-label="note" /></Drawer>)
  expect(await severe()).toEqual([])
})
