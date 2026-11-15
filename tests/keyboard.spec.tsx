// @vitest-environment jsdom
// Keyboard-only acceptance: the panel's main tasks done with Tab, arrows, Enter, Space, Escape and typing only (no clicks, no
// direct focus), and the tab order checked on every page for traps and for controls a keyboard cannot reach.
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { TABS } from '../src/client/route.ts'
import { mount, usePanel } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'
import { describe, focused, named, press, tabOrder, tabTo, typeText } from './fixtures/keyboard.ts'

usePanel()
// Each step settles the fake server, so a whole flow takes longer than the default 5 s.
vi.setConfig({ testTimeout: 60_000 })
globalThis.requestAnimationFrame ??= (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) as unknown as number
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

const pageTab = (element: HTMLElement) => element.matches('.hx-pagetabs [role="tab"]')
const currentPage = () => document.getElementById('dt-page')?.getAttribute('aria-labelledby')
/** From anywhere, Tab to the page tab bar and arrow to `page`. */
async function goTo(page: typeof TABS[number]) {
  await tabTo(pageTab, { what: 'the page tabs' })
  await press('Home')
  for (let step = 0; step < TABS.indexOf(page); step++) await press('ArrowRight')
  expect(currentPage(), `focus is on ${describe(focused())}`).toBe(`dt-tab-${page}`)
}

it('moves through every page with the page tabs: arrows choose, Home and End jump, and only the chosen tab is a Tab stop', async () => {
  await mount()
  await tabTo(pageTab, { what: 'the page tabs' })
  for (const page of TABS.slice(1)) {
    await press('ArrowRight')
    expect(focused()?.id).toBe(`dt-tab-${page}`)
    expect(focused()?.getAttribute('aria-selected')).toBe('true')
    expect(currentPage()).toBe(`dt-tab-${page}`)
  }
  await press('ArrowRight')
  expect(currentPage()).toBe(`dt-tab-${TABS[0]}`)
  await press('End')
  expect(currentPage()).toBe(`dt-tab-${TABS.at(-1)}`)
  expect(tabOrder().filter(pageTab)).toHaveLength(1)
  // Tab leaves the tab list for the page, not for the next tab.
  await press('Tab')
  expect(pageTab(focused()!)).toBe(false)
})

it('opens a Ticket from the Execution list, keeps Tab inside the drawer, and returns focus to its row on Escape', async () => {
  await mount()
  await goTo('execution')
  const row = await tabTo(element => element.matches('#dt-page .dt-open') && named('修复回归')(element), { what: 'the Ticket row' })
  await press('Enter')
  const drawer = document.querySelector<HTMLElement>('.hx-drawer')!
  expect(drawer.querySelector('[data-drawer-route]')?.getAttribute('data-drawer-route')).toBe('execution:t1')
  expect(drawer.contains(focused())).toBe(true)
  for (let step = 0; step < tabOrder().length + 3; step++) {
    await press('Tab')
    expect(drawer.contains(focused()), `Tab ${step} left the drawer for ${describe(focused())}`).toBe(true)
  }
  await press('Escape')
  expect(document.querySelector('.hx-drawer')).toBeNull()
  expect(focused()).toBe(row)
})

it('runs the command palette from the keyboard: Ctrl+K opens it, typing filters, Enter goes, and focus does not drop to the page body', async () => {
  await mount()
  await press('k', { ctrlKey: true })
  const input = focused()
  expect(input?.classList.contains('dt-command-input')).toBe(true)
  await typeText(zh['tab.console'])
  await press('Enter')
  expect(document.querySelector('.dt-command-input')).toBeNull()
  expect(currentPage()).toBe('dt-tab-console')
  expect(focused()).not.toBe(document.body)
  // Escape closes it without running anything, and focus goes back where it was.
  const before = await tabTo(pageTab, { what: 'the page tabs' })
  await press('k', { ctrlKey: true })
  await press('Escape')
  expect(document.querySelector('.dt-command-input')).toBeNull()
  expect(focused()).toBe(before)
})

it('changes and saves a setting with the keyboard only', async () => {
  await mount()
  await goTo('settings')
  await tabTo(element => element.matches('.dt-settings-link') && named(zh['settingsGroup.eval'])(element), { what: 'the Eval group' })
  await press('Enter')
  const radio = await tabTo(element => element.matches('[role="radiogroup"] [role="radio"]'), { what: 'the accept mode' })
  const before = radio.textContent
  await press('ArrowRight')
  expect(focused()?.getAttribute('aria-checked')).toBe('true')
  expect(focused()?.textContent).not.toBe(before)
  await tabTo(named(zh.save), { what: 'Save' })
  await press('Enter')
  expect(server.requests.some(request => request.method === 'PUT' && request.path === 'settings/eval')).toBe(true)
})

it('has no keyboard trap and no control a keyboard cannot reach on any page', async () => {
  await mount()
  const problems: string[] = []
  for (const page of TABS) {
    await goTo(page)
    // Tab visits every stop once and comes back round: no element holds focus, and nothing is skipped.
    const order = tabOrder()
    const seen = new Set<HTMLElement>()
    for (let step = 0; step < order.length; step++) {
      await press('Tab')
      const at = focused()
      if (!at || at === document.body) { problems.push(`${page}: Tab ${step} dropped focus`); break }
      seen.add(at)
    }
    if (seen.size < Math.min(order.length, tabOrder().length) - 1) problems.push(`${page}: Tab visited ${seen.size} of ${order.length} stops`)
    // Every visible control is a Tab stop, or one item of a composite widget whose arrows reach it (APG roving tabindex).
    const COMPOSITE = '[role="tablist"], [role="radiogroup"], [role="listbox"], [role="grid"], [role="menu"], [role="toolbar"], .hx-table, .hx-chips, .hx-combobox'
    for (const control of document.querySelectorAll<HTMLElement>('#dt-page button, #dt-page a[href], #dt-page input, #dt-page select, #dt-page textarea, #dt-page [role="button"]')) {
      if (control.matches(':disabled') || control.closest('[hidden], [aria-hidden="true"]') || control.tabIndex >= 0) continue
      if (control.closest(COMPOSITE)) continue
      problems.push(`${page}: ${describe(control)} is not reachable by Tab`)
    }
  }
  expect(problems).toEqual([])
})
