// @vitest-environment jsdom
// The live connection: views reload when their topic changes, the header says whether the page is live, and search as one types.
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, settle, click, type, text, field, all } from './fixtures/panel.tsx'
import { liveFeed, server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

it('reloads the open view when the live feed says its topic changed, and says when it falls back to polling', async () => {
  server.live = liveFeed()
  await mount()
  await vi.waitFor(() => expect(document.querySelector('.dt-live')?.getAttribute('data-status')).toBe('live'))
  expect(document.querySelector('.dt-live')?.textContent).toBe(zh['live.live'])
  await click(zh['tab.execution'])
  const before = server.requests.filter(request => request.path.startsWith('tickets?')).length
  server.tickets.open = [ticketSummary({ title: '实时到达的工单' })]
  server.live.send('ticket')
  await wait(200); await settle()
  expect(server.requests.filter(request => request.path.startsWith('tickets?')).length).toBeGreaterThan(before)
  expect(text()).toContain('实时到达的工单')
  // An event of another topic leaves the list alone.
  const after = server.requests.filter(request => request.path.startsWith('tickets?')).length
  server.live.send('prompts')
  await wait(200); await settle()
  expect(server.requests.filter(request => request.path.startsWith('tickets?')).length).toBe(after)
  server.live.drop()
  await vi.waitFor(() => expect(document.querySelector('.dt-live')?.getAttribute('data-status')).toBe('polling'))
})

it('searches once a person pauses typing, without Enter', async () => {
  await mount()
  await type(field<HTMLInputElement>(zh.searchLabel), 'issue')
  expect(server.requests.some(request => request.path.startsWith('search'))).toBe(false)
  await wait(320); await settle()
  expect(server.requests.filter(request => request.path.startsWith('search')).map(request => request.path)).toEqual(['search?q=issue'])
  expect(all('.dt-search-results').length).toBe(1)
})
