// @vitest-environment jsdom
// The panel's shared data layer: one request per address in flight, actions that show on screen at once and go back when refused,
// health that reaches the page as it changes, and a header that says how current the page is when it is not live.
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { shareRead, readsInFlight, usePoll } from '../src/client/api.ts'
import { zh } from '../src/client/locales.ts'
import { assignmentStep } from '../src/client/provider.tsx'
import { usePanel, mount, settle } from './fixtures/panel.tsx'
import { liveFeed, server } from './fixtures/panel-server.ts'

usePanel()
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

it('shares one read of an address among everyone who asks while it is in flight', async () => {
  let calls = 0
  let finish: (value: string) => void = () => {}
  const load = () => { calls++; return new Promise<string>(resolve => { finish = resolve }) }
  const first = shareRead('sources', load), second = shareRead('sources', load)
  expect(calls).toBe(1)
  expect(readsInFlight()).toBe(1)
  finish('rows')
  await expect(Promise.all([first, second])).resolves.toEqual(['rows', 'rows'])
  expect(readsInFlight()).toBe(0)
  void shareRead('sources', load)
  expect(calls).toBe(2)
  finish('again')
})

it('sends the panel one request for an address several views read at once', async () => {
  await mount()
  const counts = server.requests.filter(request => request.method === 'GET').reduce<Record<string, number>>((all, request) =>
    ({ ...all, [request.path]: (all[request.path] ?? 0) + 1 }), {})
  // The state poll and every view mounted with it read once each on the first render.
  for (const [path, count] of Object.entries(counts)) expect([path, count]).toEqual([path, 1])
})

type Probe = { data?: number[]; mutate: (patch: (data: number[]) => number[], action: () => Promise<unknown>) => Promise<unknown> }
function Rows({ load, probe }: { load: () => Promise<number[]>; probe: { current?: Probe } }) {
  const { data, mutate } = usePoll(load, [], 60_000)
  useEffect(() => { probe.current = { ...data ? { data } : {}, mutate } })
  return <ul>{data?.map(row => <li key={row}>{row}</li>)}</ul>
}
it('shows an action on screen at once, keeps the host\'s answer when it succeeds, and goes back when it is refused', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  let rows = [1, 2, 3]
  const probe: { current?: Probe } = {}
  await act(async () => { root.render(<Rows load={async () => rows} probe={probe} />) })
  await wait(0)
  expect(probe.current?.data).toEqual([1, 2, 3])
  let release: () => void = () => {}
  let done: Promise<unknown> = Promise.resolve()
  await act(async () => { done = probe.current!.mutate(data => data.filter(row => row !== 2), () => new Promise<void>(resolve => { release = resolve })) })
  expect(container.textContent).toBe('13')
  rows = [1, 3]
  await act(async () => { release(); await done })
  expect(container.textContent).toBe('13')
  let failure: unknown
  await act(async () => { await probe.current!.mutate(data => [...data, 9], async () => { throw new Error('refused') }).catch(error => { failure = error }) })
  expect((failure as Error).message).toBe('refused')
  expect(container.textContent).toBe('13')
  act(() => { root.unmount() }); container.remove()
})

it('reloads the page\'s state and the overview when a health reading changes', async () => {
  server.live = liveFeed()
  await mount()
  await vi.waitFor(() => expect(document.querySelector('.dt-live')?.getAttribute('data-status')).toBe('live'))
  const reads = (path: string) => server.requests.filter(request => request.path === path).length
  const state = reads('state'), overview = reads('overview')
  server.live.send('health', { entries: ['github'] })
  await wait(200); await settle()
  expect(reads('state')).toBeGreaterThan(state)
  expect(reads('overview')).toBeGreaterThan(overview)
})

it('reloads the panel state on an Assignment\'s steps, and not on every other step', () => {
  const stage = (type: string) => ({ seq: 1, at: '', topic: 'stage' as const, data: { type, node: 'executor' as const, at: '' } })
  expect(assignmentStep(stage('assignment.started'))).toBe(true)
  expect(assignmentStep(stage('ticket.ended'))).toBe(true)
  expect(assignmentStep(stage('decision.recorded'))).toBe(false)
  expect(assignmentStep({ seq: 2, at: '', topic: 'health', data: { entries: ['github'] } })).toBe(true)
})

it('says how old the page\'s data is once it falls back to polling', async () => {
  server.live = liveFeed()
  await mount()
  await vi.waitFor(() => expect(document.querySelector('.dt-live')?.getAttribute('data-status')).toBe('live'))
  expect(document.querySelector('.dt-live-age')).toBeNull()
  server.live.drop()
  await vi.waitFor(() => expect(document.querySelector('.dt-live')?.getAttribute('data-status')).toBe('polling'))
  expect(document.querySelector('.dt-live')?.getAttribute('data-behind')).toBe('true')
  expect(document.querySelector('.dt-live-age')?.textContent).toMatch(new RegExp(zh.liveAsOf.replace('{age}', '.+')))
})
