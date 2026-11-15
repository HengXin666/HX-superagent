// @vitest-environment jsdom
// Form atoms (src/client/ui/field.tsx): every control reads the field around it, so a label, a note, an error and the control are
// wired the same way everywhere, and the pipeline map still reads where a focused control is.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { focusOf } from '../src/client/pipeline-view.tsx'
import { TagInput } from '../src/client/tag-input.tsx'
import { CheckboxGroup, Combobox, ControlGroup, Field, FieldError, FieldHint, FormField, Input, Label, MultiSelect, RadioGroup, SegmentedControl,
  Select, Switch, Textarea } from '../src/client/ui/index.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number

let root: Root | undefined, host: HTMLElement | undefined
async function mount(node: ReactNode) {
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.body.innerHTML = ''; root = undefined })
const key = async (target: Element, k: string) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
/** Every id an `aria-describedby` or `aria-labelledby` names exists. */
function wired(container: Element) {
  for (const element of container.querySelectorAll('[aria-describedby], [aria-labelledby]'))
    for (const name of ['aria-describedby', 'aria-labelledby'])
      for (const id of element.getAttribute(name)?.split(/\s+/).filter(Boolean) ?? []) expect(document.getElementById(id), `${name}=${id}`).not.toBeNull()
}

it('wires the label, the note and the control of a field, and swaps the note for an error that marks it invalid', async () => {
  function Harness() {
    const [error, setError] = useState<string>()
    return <><Field label="Name" hint="Shown on cards" info="help" error={error} required><Input value="" onChange={() => {}} /></Field>
      <button type="button" onClick={() => setError(error ? undefined : 'Needed')}>toggle</button></>
  }
  const el = await mount(<Harness />)
  const input = el.querySelector('input')!
  const label = el.querySelector('label')!
  expect(label.htmlFor).toBe(input.id)
  expect(input.labels?.[0]).toBe(label)
  expect(input.getAttribute('aria-label')).toBeNull()
  expect(input.required).toBe(true)
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Shown on cards')
  wired(el)
  await act(async () => { el.querySelector<HTMLButtonElement>('button:not(.hx-info)')!.click() })
  const error = document.getElementById(input.getAttribute('aria-describedby')!)!
  expect(error.textContent).toBe('Needed')
  expect(error.getAttribute('role')).toBe('alert')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(el.querySelector('.hx-input')?.hasAttribute('data-invalid')).toBe(true)
  expect(el.querySelector('.hx-field-hint')).toBeNull()
  wired(el)
})

it('names a labelable control by the label element and a composite by aria-labelledby, with the label then a plain span', async () => {
  const el = await mount(<>
    <Field label="Mode" hint="How it runs"><SegmentedControl label="Mode" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' },
      { value: 'b', label: 'B' }]} /></Field>
    <Field label="Kind"><Select label="Kind" value="x" onChange={() => {}} options={[{ value: 'x', label: 'X' }]} /></Field>
    <Field label="On"><Switch label="On" checked={false} onChange={() => {}} /></Field>
    <Field label="Model"><Combobox label="Model" value={null} onChange={() => {}} options={[]} /></Field>
  </>)
  const group = el.querySelector('[role="radiogroup"]')!
  const name = document.getElementById(group.getAttribute('aria-labelledby')!)!
  expect(name.tagName).toBe('SPAN')
  expect(name.textContent).toBe('Mode')
  expect(group.getAttribute('aria-label')).toBeNull()
  expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('How it runs')
  for (const control of el.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[role="combobox"], [role="switch"], input[role="combobox"]')) {
    expect(control.getAttribute('aria-label')).toBeNull()
    expect(control.labels?.[0]?.textContent).toBeTruthy()
  }
  wired(el)
})

it('keeps a control\'s own name when it says more than the field label, and outside any field', async () => {
  const el = await mount(<>
    <Field label="Cells"><Select label="Row 1 · cell" value="x" onChange={() => {}} options={[{ value: 'x', label: 'X' }]} /></Field>
    <Input aria-label="Alone" />
    <FormField><Input aria-label="Skill name" /><FieldError>Bad name</FieldError></FormField>
  </>)
  expect(el.querySelector('button[role="combobox"]')?.getAttribute('aria-label')).toBe('Row 1 · cell')
  expect(el.querySelector('[aria-label="Alone"]')).not.toBeNull()
  const skill = el.querySelector<HTMLInputElement>('[aria-label="Skill name"]')!
  expect(skill.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(skill.getAttribute('aria-describedby')!)?.textContent).toBe('Bad name')
})

it('passes the field\'s disabled and read-only state to its control', async () => {
  const el = await mount(<>
    <Field label="Id" readOnly><Input /></Field>
    <Field label="Body" disabled><Textarea /></Field>
    <Field label="Order" disabled><MultiSelect label="Order" value={['a']} onChange={() => {}} options={[{ value: 'a', label: 'A' }]}
      labels={{ remove: name => `remove ${name}`, moved: () => '' }} /></Field>
  </>)
  expect(el.querySelector<HTMLInputElement>('input')!.readOnly).toBe(true)
  expect(el.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
  const order = el.querySelectorAll<HTMLInputElement>('input')[1]!
  expect(order.disabled).toBe(true)
  expect(order.labels?.[0]?.textContent).toBe('Order')
  expect(el.querySelector('.hx-chip')?.getAttribute('tabindex')).toBe('-1')
})

it('makes a group field one named group whose controls keep their own names, described by its note', async () => {
  const el = await mount(<ControlGroup label="Base" hint="Where the roles run">
    <RadioGroup label="Base" value="k" onChange={() => {}} options={[{ value: 'k', label: 'Keep' }, { value: 'o', label: 'Other' }]} />
    <Input aria-label="Other id" />
  </ControlGroup>)
  const group = el.querySelector('[role="group"]')!
  expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Base')
  expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Where the roles run')
  expect(el.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Base')
  const input = el.querySelector('input')!
  expect(input.getAttribute('aria-label')).toBe('Other id')
  expect(input.hasAttribute('aria-describedby')).toBe(false)
  expect(el.querySelector('label')).toBeNull()
  wired(el)
})

it('composes the atoms by hand the same way Field does', async () => {
  const el = await mount(<FormField label="Commands" required><div><Label>Commands</Label>
    <TagInput label="Commands" value="rm curl" onChange={() => {}} pattern={/^[a-z]+$/} /><FieldHint>Blocked in the sandbox</FieldHint></div></FormField>)
  const input = el.querySelector<HTMLInputElement>('.dt-tags-input')!
  expect(input.labels?.[0]?.textContent).toBe('Commands*')
  expect(el.querySelector('.hx-field-req')?.getAttribute('aria-hidden')).toBe('true')
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Blocked in the sandbox')
  expect(input.getAttribute('aria-invalid')).toBeNull()
})

it('marks a tag input invalid while a chip does not match its pattern', async () => {
  const el = await mount(<Field label="Tools"><TagInput label="Tools" value="ok Bad! " onChange={() => {}} pattern={/^[a-z]+$/} /></Field>)
  expect(el.querySelector('.dt-tags-input')?.getAttribute('aria-invalid')).toBe('true')
  expect(el.querySelector('.dt-tag-chip[data-invalid]')?.textContent).toContain('Bad!')
})

it('describes a tag input by the chips that do not match, ahead of the field\'s note, and drops it once they are gone', async () => {
  function Harness() {
    const [value, setValue] = useState('ok Bad! ')
    return <><Field label="Tools" hint="Names only"><TagInput label="Tools" value={value} onChange={setValue} pattern={/^[a-z]+$/}
      invalidLabel="Not a tool name" /></Field><button type="button" onClick={() => setValue('ok ')}>fix</button></>
  }
  const el = await mount(<Harness />)
  const input = el.querySelector<HTMLInputElement>('.dt-tags-input')!
  const ids = () => input.getAttribute('aria-describedby')!.split(' ')
  expect(ids().map(id => document.getElementById(id)?.textContent)).toEqual(['Not a tool name: Bad!', 'Names only'])
  wired(el)
  await act(async () => { el.querySelector<HTMLButtonElement>('button:not(.dt-tag-remove)')!.click() })
  expect(ids().map(id => document.getElementById(id)?.textContent)).toEqual(['Names only'])
  expect(input.getAttribute('aria-invalid')).toBeNull()
})

it('marks composite controls required and invalid from their field, the way it marks a text input', async () => {
  const el = await mount(<>
    <Field label="Mode" required error="Pick one"><SegmentedControl label="Mode" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} /></Field>
    <Field label="Base" required error="Pick one"><RadioGroup label="Base" value="k" onChange={() => {}} options={[{ value: 'k', label: 'Keep' }]} /></Field>
    <Field label="Roles" required error="Pick one"><CheckboxGroup label="Roles" value={[]} onChange={() => {}} options={[{ value: 'w', label: 'W' }]} /></Field>
    <Field label="On" required error="Turn it on"><Switch label="On" checked={false} onChange={() => {}} /></Field>
    <Field label="Plain"><RadioGroup label="Plain" value="k" onChange={() => {}} options={[{ value: 'k', label: 'Keep' }]} /></Field>
  </>)
  const [mode, base, plain] = [...el.querySelectorAll('[role="radiogroup"]')]
  for (const group of [mode!, base!]) {
    expect(group.getAttribute('aria-required')).toBe('true')
    expect(group.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Pick one')
  }
  const roles = el.querySelector('[role="group"]')!
  expect(roles.getAttribute('aria-invalid')).toBe('true')
  expect(roles.hasAttribute('aria-required')).toBe(false)
  const toggle = el.querySelector('[role="switch"]')!
  expect(toggle.getAttribute('aria-required')).toBe('true')
  expect(toggle.getAttribute('aria-invalid')).toBe('true')
  expect(plain!.hasAttribute('aria-required')).toBe(false)
  expect(plain!.hasAttribute('aria-invalid')).toBe(false)
  wired(el)
})

it('moves a radio group with the arrows, skipping disabled items, with one Tab stop; a checkbox group toggles each item', async () => {
  const seen: string[] = []
  function Harness() {
    const [value, setValue] = useState('a')
    const [checks, setChecks] = useState<string[]>([])
    return <Field label="Pick"><div>
      <RadioGroup label="Pick" value={value} onChange={next => { seen.push(next); setValue(next) }}
        options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }]} />
      <CheckboxGroup label="Also" value={checks} onChange={setChecks} options={[{ value: 'x', label: 'X', data: { 'data-deny': '' } }, { value: 'y', label: 'Y' }]} />
    </div></Field>
  }
  const el = await mount(<Harness />)
  const radios = [...el.querySelectorAll<HTMLElement>('[role="radio"]')]
  expect(radios.map(radio => radio.tabIndex)).toEqual([0, -1, -1])
  radios[0]!.focus()
  await key(radios[0]!, 'ArrowRight')
  expect(seen).toEqual(['c'])
  expect(document.activeElement).toBe(radios[2])
  await key(radios[2]!, 'ArrowRight')
  expect(seen).toEqual(['c', 'a'])
  const boxes = [...el.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')]
  expect(boxes[0]!.hasAttribute('data-deny')).toBe(true)
  await act(async () => { boxes[1]!.click() })
  expect(boxes[1]!.getAttribute('aria-checked')).toBe('true')
  expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Also')
})

it('lets the pipeline map name a focused control from its field label, without a page hook class', async () => {
  const el = await mount(<div data-pipeline-block="executor" data-pipeline-title="Executor">
    <Field className="dt-field" label="Max workers" required><Input /></Field>
    <Field label="Mode"><SegmentedControl label="Mode" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} /></Field>
  </div>)
  expect(focusOf(el.querySelector('input')!)?.trail).toEqual(['Executor', 'Max workers'])
  expect(focusOf(el.querySelector('[role="radio"]')!)?.trail).toEqual(['Executor', 'Mode'])
})

it('leaves no hand-built field markup in the pages: labels, notes and errors come from the form atoms', () => {
  const dir = join(process.cwd(), 'src/client')
  const pages = readdirSync(dir).filter(name => /\.tsx$/.test(name))
  const found: string[] = []
  // Raw elements a page may still draw: hidden file pickers, the command palette's search box (a combobox of its own), and the
  // controls that read the field themselves: the tag input's text box and the code editor's fallback text area.
  const ALLOWED = [/type="file"/, /dt-command-input/, /dt-tags-input/, /ref=\{area\}/]
  for (const name of pages) {
    const source = readFileSync(join(dir, name), 'utf8')
    for (const [index, line] of source.split('\n').entries()) {
      const at = `${name}:${index + 1}`
      if (/dt-field-head|<label\b/.test(line)) found.push(`${at} hand-built label`)
      if (/<(input|textarea|select)\b/.test(line) && !ALLOWED.some(pattern => pattern.test(line))) found.push(`${at} raw control`)
    }
  }
  expect(found).toEqual([])
})
