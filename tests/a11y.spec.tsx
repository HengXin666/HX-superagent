// @vitest-environment jsdom
// Automated accessibility check (axe-core) over every panel page, every settings group and the panel's dialogs.
// The bar: zero `critical` and zero `serious` violations. Colour contrast is left to the dark/light screenshot pass,
// because jsdom does not lay out or paint and axe cannot compute colours there.
import axe from 'axe-core'
import { act } from 'react'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { TABS } from '../src/client/route.ts'
import { all, click, mount, settle, tab, usePanel } from './fixtures/panel.tsx'

usePanel()

/**
 * Rules axe cannot judge here: those that need layout or paint, which jsdom does not have, and the two about the host document
 * (its <title> and <html lang>), which belong to the DSH page the panel is embedded in. Everything else runs.
 */
const SKIPPED = ['color-contrast', 'color-contrast-enhanced', 'link-in-text-block', 'target-size', 'scrollable-region-focusable',
  'document-title', 'html-has-lang']
export const SEVERE = ['critical', 'serious'] as const

/** Runs axe on the whole document and returns the severe violations as readable lines (rule, impact, first nodes). */
export async function severe(context: axe.ElementContext = document): Promise<string[]> {
  const result = await axe.run(context, {
    resultTypes: ['violations'],
    rules: Object.fromEntries(SKIPPED.map(rule => [rule, { enabled: false }])),
  })
  return result.violations.filter(violation => (SEVERE as readonly string[]).includes(violation.impact ?? ''))
    .map(violation => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(' | ')}`)
}

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
