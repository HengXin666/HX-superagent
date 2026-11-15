// @vitest-environment jsdom
// Runtime check of the BUILT lib/client.js: loaded through a __ModuleLoader__ shim with real React, mounted as DSH would mount it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { consoleView, liveFeed, server, usePanelServer } from './fixtures/panel-server.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const OUT = process.env.PANEL_SHOTS_DIR ?? join(tmpdir(), 'panel-shots'); mkdirSync(OUT, { recursive: true })
let root: ReactDOMClient.Root | undefined; let box: HTMLElement | undefined
usePanelServer(() => { act(() => root?.unmount()); box?.remove() })

function loadBuilt() {
  const source = readFileSync('lib/client.js', 'utf8')
  let exported: any
  ;(window as any).__ModuleLoader__ = { load: ({ factory }: any) => { exported = factory((name: string) => ({ react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient } as any)[name] ?? (() => { throw new Error(`require ${name}`) })()) } }
  new Function(source)()
  return exported
}
const tr = (key: string, p?: Record<string, unknown>) => { const s = (zh as any)[key] ?? key; return p ? s.replace(/\{(\w+)\}/g, (m: string, n: string) => n in p ? String(p[n]) : m) : s }
async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
async function mountBuilt() {
  const mod = loadBuilt(); const entries: any[] = []
  mod.apply({ slots: { inject: (_: string, f: () => void) => f(), register: (o: any, c: any) => { entries.push({ o, c }); return () => {} } },
    locale: { register: () => () => {}, bind: () => tr }, effect: (f: () => void) => f(),
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) }, refresh: async () => {} }, uiWorkspace: { openSession: vi.fn() }, get: () => undefined })
  const Main = entries.find(e => e.o.name === 'main').c
  box = document.createElement('div'); document.body.append(box); root = ReactDOMClient.createRoot(box)
  await act(async () => { root!.render(<Main t={tr} />) }); await settle()
  return mod
}
const all = (s: string) => [...document.querySelectorAll<HTMLElement>(s)]
async function clickText(name: string, sel = 'button, [role="tab"]') {
  const el = all(sel).find(e => e.textContent?.trim() === name || e.getAttribute('aria-label') === name)
  if (!el) throw new Error(`no ${name}`); await act(async () => { el.click() }); await settle()
}
const snap = (name: string) => writeFileSync(`${OUT}/${name}.html`, box!.innerHTML)

it('built panel: preset with a base, layered architecture map, and the console timeline all run', async () => {
  const lib = server.overlays.view()
  server.overlays.save([...lib.overlays.filter((o: any) => !o.builtin),
    { id: 'reviewer-lite', name: '只读审阅', description: '只读+换底座', roles: ['worker'], deny: ['bash'], allow: [], instructions: '只看不改', base: 'reviewer' }] as never, lib.revision)
  server.settings.executor.overlays = ['no-web', 'reviewer-lite'].filter(id => server.overlays.view().overlays.some((o: any) => o.id === id))
  server.live = liveFeed()
  const mod = await mountBuilt()
  expect(typeof mod.apply).toBe('function')
  // Settings: the map draws each preset as its own layer and names the base the chain decides.
  await clickText(zh['tab.settings'])
  const layers = all('.dt-pipeline-part[data-part^="executor-pack:"]').map(e => e.textContent)
  const base = all('.dt-pipeline-part[data-part="executor-preset"]').map(e => e.textContent)
  console.log('LAYERS', JSON.stringify(layers), 'BASE', JSON.stringify(base))
  expect(layers.length).toBe(server.settings.executor.overlays!.length)
  // This chain takes bash away, which a worker cannot run without: the service keeps the setting's base, and so does the map.
  expect(base.join()).toContain('dsh-superagent-worker · 预设底座未生效')
  snap('settings')
  // Console: live events become lanes with bars and ticks on the time axis.
  await clickText(zh['tab.console'])
  await vi.waitFor(() => expect(server.live!.connected()).toBe(1))
  const now = Date.now()
  server.live.send('stage', { type: 'assignment.started', node: 'executor', at: new Date(now - 4 * 60_000).toISOString(), ticketId: 't1' })
  server.live.send('activity', { sessionId: 'worker-t1', role: 'worker', ticketId: 't1', kind: 'tool', tool: 'bash', summary: 'pnpm test', at: new Date(now - 60_000).toISOString(), state: 'running' })
  server.live.send('stage', { type: 'decision.recorded', node: 'main', at: new Date(now - 3 * 60_000).toISOString(), detail: 'accept' })
  await act(async () => { await new Promise(r => setTimeout(r, 80)) }); await settle()
  console.log('LOG', all('.dt-log-line').length, document.querySelector('.dt-timeline')?.outerHTML.slice(0,1500))
  const rows = all('.dt-timeline-row'); const bars = all('.dt-timeline-bar'); const ticks = all('.dt-timeline-tick')
  console.log('TIMELINE rows', rows.length, 'bars', bars.length, 'open', all('.dt-timeline-bar[data-open]').length, 'ticks', ticks.length)
  expect(rows.length).toBeGreaterThanOrEqual(2); expect(bars.length).toBeGreaterThanOrEqual(1); expect(ticks.length).toBeGreaterThanOrEqual(2)
  snap('console')
  // Clicking a lane opens that Ticket's call chain.
  await act(async () => { all('.dt-timeline-row[data-role="ticket"] .dt-timeline-name')[0]!.click() }); await settle()
  console.log('TRACE', all('.dt-trace-step .dt-trace-what').map(e => e.textContent))
  expect(document.querySelector('.dt-trace')).not.toBeNull()
})

it('built console draws a realistic 15 minutes from the snapshot history (for the screenshot)', async () => {
  const now = Date.now(); let seq = 0
  const ev = (min: number, topic: string, data: any) => ({ seq: ++seq, at: new Date(now - min * 60_000).toISOString(), topic, data: { ...data, at: new Date(now - min * 60_000).toISOString() } })
  const st = (min: number, type: string, x: any = {}) => ev(min, 'stage', { type, node: type.startsWith('decision') ? 'main' : 'executor', ...x })
  const tool = (min: number, ticketId: string, tool: string, summary: string) => ev(min, 'activity', { sessionId: `worker-${ticketId}`, role: 'worker', ticketId, kind: 'tool', tool, summary, state: 'running' })
  const events = [st(13, 'decision.recorded', { detail: 'accept' }), st(12.5, 'assignment.started', { ticketId: 't1', assignmentId: 'a1' }),
    ...[12, 11.2, 10.4, 9, 8.1, 7, 6.2, 5].map((m, i) => tool(m, 't1', i % 2 ? 'read' : 'bash', 'pnpm test')),
    st(4.5, 'assignment.ended', { ticketId: 't1', assignmentId: 'a1', detail: 'ready' }), st(9.5, 'decision.recorded', { detail: 'accept' }),
    st(9, 'assignment.started', { ticketId: 't2', assignmentId: 'b1' }), ...[8, 6.5, 4, 2.2, 1, 0.3].map(m => tool(m, 't2', 'edit', 'src/app.ts')),
    st(7.5, 'assignment.started', { ticketId: 't3', assignmentId: 'c1' }), tool(7, 't3', 'bash', 'go test'), st(5.5, 'assignment.ended', { ticketId: 't3', assignmentId: 'c1', detail: 'failed' }),
    st(3, 'decision.recorded', { detail: 'accept' })]
  const inner = globalThis.fetch as any
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => String(url).includes('console/snapshot')
    ? new Response(JSON.stringify({ ...consoleView(), events }), { status: 200, headers: { 'content-type': 'application/json' } }) : inner(url, init))
  await mountBuilt()
  await clickText(zh['tab.console'])
  console.log('SNAP rows', all('.dt-timeline-row').length, 'bars', all('.dt-timeline-bar').length, 'ticks', all('.dt-timeline-tick').length)
  expect(all('.dt-timeline-bar').length).toBe(3)
  snap('console-history')
})

it('built panel: every page and every settings group renders from lib/client.js without an error', async () => {
  const lib = server.overlays.view()
  server.overlays.save([{ id: 'reviewer-lite', name: '只读审阅', description: '只读+换底座', roles: ['worker'], deny: ['subagent'], allow: [], instructions: '只看不改', base: 'reviewer' }] as never, lib.revision)
  server.settings.executor.overlays = ['no-web', 'reviewer-lite']
  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(String(args[0]).slice(0, 160)) })
  await mountBuilt()
  const report: Record<string, unknown>[] = []
  const check = (name: string) => {
    const main = document.querySelector('#dt-page')!
    const bad = [...main.querySelectorAll('[role="alert"], .dt-error, .dt-load-error')].map(e => e.textContent?.slice(0, 80))
    report.push({ page: name, chars: main.textContent!.length, sections: main.querySelectorAll('section, .dt-section').length, buttons: main.querySelectorAll('button').length, alerts: bad })
    snap(`page-${name}`)
  }
  for (const tab of ['overview', 'source', 'trigger', 'eval', 'execution', 'console', 'settings'] as const) {
    await act(async () => { document.getElementById(`dt-tab-${tab}`)!.click() }); await settle(); check(tab)
  }
  for (const group of ['source', 'eval', 'execution', 'presets', 'prompts', 'deployment'] as const) {
    await clickText((zh as any)[`settingsGroup.${group}`], '.dt-settings-link')
    // The effective tools are asked for after a 150 ms pause in editing.
    await act(async () => { await new Promise(r => setTimeout(r, 300)) }); await settle()
    if (group === 'presets') report.push({ baseLines: all('.dt-overlay-base').map(e => e.textContent), chipsWithBase: all('.dt-preset-chip').filter(e => e.textContent!.includes('⌂')).map(e => e.textContent),
      mapLayers: all('.dt-pipeline-part[data-part*="-pack:"]').map(e => e.textContent), mapBase: all('.dt-pipeline-part[data-part="executor-preset"]').map(e => e.textContent), newPresetButton: all('button').some(e => e.textContent === (zh as any).overlaysNew) })
    check(`settings-${group}`)
  }
  // The presets group: the chain shows its base, and the library opens straight into a new preset.
  spy.mockRestore()
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, consoleErrors: errors }, null, 1))
  console.log('REPORT', JSON.stringify(report), 'ERRORS', errors.length)
  expect(report.filter(r => 'chars' in r && (r.chars as number) < 40)).toEqual([])
})
