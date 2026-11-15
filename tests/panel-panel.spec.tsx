// @vitest-environment jsdom
// Panel search, glossary, route persistence, and host-down fallback.
import { act } from 'react'
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, click, type, text } from './fixtures/panel.tsx'
import { server, found } from './fixtures/panel-server.ts'

usePanel()
/** Searches from the command palette, which is the panel's one search: open it, type, and press Enter to search at once. */
async function search(query: string) {
  if (!document.querySelector('.dt-command-input')) await click(zh.commandOpen)
  const input = document.querySelector<HTMLInputElement>('.dt-command-input')!
  await type(input, query)
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }); await settle()
}
const resultLabels = () => all('.dt-command-item[data-result] .dt-command-label').map(item => item.textContent)
it('states why a filtered search result has no Thread instead of opening an empty one', async () => {
  server.search = { items: [found('e9', '2026-09-20T00:00:00Z', { source: 'github', actor: { source: 'github', id: 'someone' },
    preview: 'issue text', threads: ['github:7'],
    filtered: 'source_disabled' })], threads: [] }
  await mount()
  await search('issue')
  expect(text()).toContain('被来源过滤：来源已停用')
  // It is listed, but not as something to open.
  expect(all('.dt-command-item[data-result]').find(item => item.textContent?.includes('issue text'))?.getAttribute('aria-disabled')).toBe('true')
})

it('opens a search result older than the newest page around its Trigger', async () => {
  server.search = { items: [found('e1', '2026-09-20T00:00:00Z')], threads: [] }
  await mount()
  await search('message')
  expect(text()).toContain('找到 0 个工单、0 个线程、1 条触发')
  await click(all('.dt-command-item[data-result]').find(item => item.querySelector('.dt-command-label')?.textContent === 'message e1')!)
  expect(server.requests.some(request => request.path.includes('around=e1'))).toBe(true)
  expect(document.querySelector('.dt-highlight')?.textContent).toContain('message e1')
})

it('explains what can be searched when nothing matches', async () => {
  await mount()
  await search('nothing')
  expect(text()).toContain('没有找到。可以输入触发文字')
})

it('returns to the exact page after a remount of the main panel', async () => {
  await mount()
  await click('修复回归')
  await remount()
  expect(document.querySelector('.dt-page-title h2')?.textContent).toBe('修复回归')
})

it('shows domain terms in the interface language only and lists both languages in the (?) glossary', async () => {
  await mount(en)
  expect(all('[role="tab"]').map(tab => tab.textContent)).toEqual(['Overview', 'Source', 'Trigger', 'Eval', 'Execution', 'Console', 'Settings'])
  await click('Glossary')
  const dialog = document.querySelector('[role="dialog"]')!
  const row = [...dialog.querySelectorAll('tr')].find(item => item.textContent?.startsWith('Ticket'))!
  expect([...row.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['Ticket', '工单', 'An authorized unit of work'])
  expect(dialog.textContent).toContain('Accept 接单')
  // Terms are grouped the way the tabs follow the flow, after the roles that act in it.
  expect([...dialog.querySelectorAll('th.dt-glossary-group')].map(cell => cell.textContent)).toEqual(['Roles', 'Source', 'Trigger', 'Eval',
    'Execution'])
  expect([...dialog.querySelectorAll('tr')].find(item => item.textContent?.startsWith('Main Session'))!.textContent).toContain('prompts call it the orchestrator')
})

it('says dsh-superagent is not answering when its routes are gone, as while it restarts', async () => {
  server.down = true
  await mount()
  expect(text()).toContain(zh.hostNotRunning)
  expect(text()).not.toContain('404')
})

it('closes the search on Escape, and picks a result with the arrow keys and Enter', async () => {
  server.search = { items: [found('e1', 'Sun 2026-09-20 8:00 AM CST (UTC+08:00)')], threads: [] }
  await mount()
  await search('message')
  expect(resultLabels()).toEqual(['message e1'])
  const input = document.querySelector<HTMLInputElement>('.dt-command-input')!
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  expect(document.querySelector('.dt-command-item[aria-selected="true"] .dt-command-label')?.textContent).toBe('message e1')
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }); await settle()
  expect(document.querySelector('.dt-command-input')).toBeNull()
})

it('shows the answer to the latest search only', async () => {
  server.search = { items: [found('e1', '2026-09-20T00:00:00Z', { preview: 'old message' }), found('e2', '2026-09-21T00:00:00Z',
    { preview: 'new message' })], threads: [] }
  let release = () => {}
  server.searching = async query => { if (query === 'old') await new Promise<void>(resolve => { release = resolve }) }
  await mount()
  for (const query of ['old', 'new']) await search(query)
  expect(resultLabels()).toEqual(['new message'])
  await act(async () => { release() }); await settle()
  expect(resultLabels()).toEqual(['new message'])
})
