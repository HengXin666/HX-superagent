// @vitest-environment jsdom
// The monitoring console: lanes per slot with what each runs now, the live event log, and the pipeline filter.
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, settle, click, text, all, find } from './fixtures/panel.tsx'
import { liveFeed, server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

it('shows a lane per working ticket and the main Session, free slots up to the limit, and the queue', async () => {
  server.queuedTickets = [ticketSummary({ id: 't9', title: '排队的工单' })]
  server.activities['worker-t1'] = { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'bash', summary: 'pnpm test',
    at: new Date().toISOString(), state: 'running' }
  await mount()
  await click(zh['tab.console'])
  expect(all('.dt-lane-name').map(item => item.textContent)).toEqual([zh['term.mainSession'], '修复回归'])
  expect(all('.dt-lane-free')).toHaveLength(server.settings.executor.maxWorkers - 1)
  expect(document.querySelector('.dt-lane[data-running] .dt-lane-cmd')?.textContent).toBe('pnpm test')
  expect(text()).toContain('排队的工单')
  expect(all('.dt-kpi-value').map(item => item.textContent).slice(0, 4)).toEqual([`1/${server.settings.executor.maxWorkers}`, '1', '2', '2'])
  await click(find(zh['decision.stop'], '.dt-lane button'))
  await click(zh.confirm)
  expect(server.requests.some(request => request.method === 'POST' && request.path === 'tickets/t1/stop')).toBe(true)
})

it('streams activity into the lanes and the event log, holds it while paused, and filters by a pipeline step', async () => {
  server.live = liveFeed()
  await mount()
  await click(zh['tab.console'])
  await vi.waitFor(() => expect(server.live!.connected()).toBe(1))
  server.live.send('activity', { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'read', summary: 'src/app.ts',
    at: new Date().toISOString(), state: 'running' })
  await wait(50); await settle()
  expect(document.querySelector('.dt-lane[data-running] .dt-lane-cmd')?.textContent).toBe('src/app.ts')
  expect(all('.dt-log-line').map(line => line.querySelector('.dt-log-text')?.textContent)).toEqual(['t1 · read src/app.ts'])
  await click(zh.consolePause)
  server.live.send('ticket')
  await wait(200); await settle()
  expect(all('.dt-log-line')).toHaveLength(1)
  await click(`${zh.consoleResume} (1)`)
  expect(all('.dt-log-line')).toHaveLength(2)
  // Picking the Replies step shows only its topics.
  await click(document.querySelector<HTMLElement>('.dt-pipeline-node[data-node="reply"]')!)
  expect(all('.dt-log-line')).toHaveLength(0)
  await click(`${zh['pipeline.reply']} ×`)
  expect(all('.dt-log-line')).toHaveLength(2)
})
