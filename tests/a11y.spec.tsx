// @vitest-environment jsdom
// Automated accessibility check (axe-core) over every panel page, every settings group and the panel's dialogs.
// The bar (zero `critical` and zero `serious` violations) and the rules left out are in tests/fixtures/axe.ts.
import { act } from 'react'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { TABS } from '../src/client/route.ts'
import { severe } from './fixtures/axe.ts'
import { all, click, mount, settle, tab, usePanel } from './fixtures/panel.tsx'

usePanel()

it('has no critical or serious axe violations on any page', async () => {
  await mount()
  const found: string[] = []
  for (const name of TABS) {
    await click(tab(zh[`tab.${name}` as keyof typeof zh] ?? name))
    found.push(...(await severe()).map(line => `${name}: ${line}`))
  }
  expect(found).toEqual([])
})

it('has no critical or serious axe violations in any settings group', async () => {
  await mount()
  await click(tab(zh['tab.settings' as keyof typeof zh]))
  const groups = all('.dt-settings-nav [role="tab"], .dt-settings-nav button, .dt-settings-nav a')
  const found: string[] = []
  for (const group of groups) {
    await click(group)
    found.push(...(await severe()).map(line => `${group.textContent?.trim()}: ${line}`))
  }
  expect(found).toEqual([])
})

it('has no critical or serious axe violations with the command palette open', async () => {
  await mount()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })) })
  await settle()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(await severe()).toEqual([])
})

it('has no critical or serious axe violations with a Ticket open in the drawer', async () => {
  await mount()
  await click(tab(zh['tab.execution' as keyof typeof zh]))
  const row = all('#dt-page .dt-open').find(element => element.textContent?.includes('修复回归'))
  expect(row).toBeDefined()
  await click(row!)
  expect(document.querySelector('.hx-drawer [data-drawer-route]')).not.toBeNull()
  expect(await severe()).toEqual([])
})
