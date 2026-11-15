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

it('lights the step work passes through, and traces one Ticket from its steps to its tool calls with the time between them', async () => {
  server.live = liveFeed()
  await mount()
  await click(zh['tab.console'])
  await vi.waitFor(() => expect(server.live!.connected()).toBe(1))
  const start = Date.now()
  server.live.send('stage', { type: 'assignment.started', node: 'executor', at: new Date(start).toISOString(), ticketId: 't1' })
  server.live.send('activity', { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'bash', summary: 'pnpm test',
    at: new Date(start + 1500).toISOString(), state: 'running' })
  server.live.send('stage', { type: 'decision.recorded', node: 'main', at: new Date(start).toISOString(), threadKey: 'github:9' })
  await wait(50); await settle()
  expect(document.querySelector('.dt-pipeline-node[data-node="executor"]')?.hasAttribute('data-pulse')).toBe(true)
  expect(document.querySelector('.dt-pipeline-edge[data-flowing]')).not.toBeNull()
  expect(all('.dt-log-line .dt-log-text').map(line => line.textContent)).toContain(`${zh['stage.assignment.started']} · t1`)
  // A lane's name opens its Ticket's call chain: only that Ticket's steps, oldest first, each with the time since the one before.
  await click(find('修复回归', '.dt-lane-trace'))
  expect(all('.dt-trace-step .dt-trace-what').map(step => step.textContent)).toEqual([zh['stage.assignment.started'], 'bash pnpm test'])
  expect(all('.dt-trace-step .dt-trace-gap')[1]?.textContent).toBe('+1.5s')
  server.live.send('activity', { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'turn', summary: 'turn ended',
    at: new Date(start + 2000).toISOString(), state: 'idle' })
  await wait(50); await settle()
  expect(all('.dt-trace-step')).toHaveLength(3)
  await click(find(zh.close, '.dt-trace button'))
  expect(document.querySelector('.dt-trace')).toBeNull()
})

it('says plainly when the live feed is down and how old what it shows is', async () => {
  // Without a feed the panel polls, which the console names rather than passing old numbers off as live.
  await mount()
  await click(zh['tab.console'])
  await vi.waitFor(() => expect(document.querySelector('.dt-console-stale')).not.toBeNull())
  expect(document.querySelector('.dt-console-stale')?.getAttribute('role')).toBe('status')
})

it('shows no stale warning while the live feed is connected', async () => {
  server.live = liveFeed()
  await mount()
  await click(zh['tab.console'])
  await vi.waitFor(() => expect(server.live!.connected()).toBe(1))
  await wait(50); await settle()
  expect(document.querySelector('.dt-console-stale')).toBeNull()
})

it('grows the time axis from the live feed alone: a new step opens a lane with a bar, a tool call adds a tick, the end closes the bar', async () => {
  server.live = liveFeed()
  await mount()
  await click(zh['tab.console'])
  await vi.waitFor(() => expect(server.live!.connected()).toBe(1))
  const row = () => document.querySelector<HTMLElement>('.dt-timeline-row[data-role="ticket"]')
  expect(row()).toBeNull()
  const start = Date.now() - 60_000
  server.live.send('stage', { type: 'assignment.started', node: 'executor', at: new Date(start).toISOString(), ticketId: 't1', assignmentId: 'a1' })
  await wait(50); await settle()
  // No reload: the lane, its open bar and its name come from the event the feed carried.
  expect(row()).not.toBeNull()
  expect(row()!.querySelectorAll('.dt-timeline-bar[data-open]')).toHaveLength(1)
  const ticks = () => row()!.querySelectorAll('.dt-timeline-tick').length
  const before = ticks()
  server.live.send('activity', { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'bash', summary: 'pnpm test',
    at: new Date(start + 10_000).toISOString(), state: 'running' })
  await wait(50); await settle()
  expect(ticks()).toBe(before + 1)
  expect(row()!.querySelector('.dt-timeline-tick[data-kind="tool"]')?.getAttribute('title')).toContain('bash · pnpm test')
  server.live.send('stage', { type: 'assignment.ended', node: 'executor', at: new Date(start + 20_000).toISOString(), ticketId: 't1',
    assignmentId: 'a1', detail: 'completed' })
  await wait(50); await settle()
  expect(row()!.querySelectorAll('.dt-timeline-bar[data-open]')).toHaveLength(0)
  expect(row()!.querySelectorAll('.dt-timeline-bar')).toHaveLength(1)
  expect(server.requests.filter(request => request.path === 'console/timeline')).toHaveLength(0)
})
