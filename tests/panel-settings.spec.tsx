// @vitest-environment jsdom
// The Settings groups, drafts, save bars and history.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Fields } from '../src/client/settings-kit.tsx'
import { expect, it, onTestFinished } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, find, tab, click, type, text, field, enter, press } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
it('keeps a person\'s own value where another save changed the same setting, and says so', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  server.settings = { ...server.settings, executor: { ...server.settings.executor, maxWorkers: 4 } }
  server.revisions.executor = 1
  await click(zh.save)
  expect(document.querySelector('.dt-savebar [role="alert"]')?.textContent).toBe(zh.saveConflict)
  expect(field<HTMLInputElement>(zh.maxWorkers).value).toBe('6')
  await click(zh.save)
  expect(server.settings.executor.maxWorkers).toBe(6)
})

it('saves the Eval block on the Policy settings and the Executor with its execution environment on the Execution settings, each against its own revision', async () => {
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await click(zh['mode.auto'])
  await type(field<HTMLInputElement>(zh.evalTimeout), '180')
  // The model is three linked choices from the host's catalog; a value it does not list can still be typed.
  const [provider, model] = all('.dt-model input')
  await enter(provider!, 'worker-provider'); await enter(all('.dt-model input')[1]!, 'worker-model')
  void model
  await click(zh.save)
  expect(server.settings.eval).toEqual({ mode: 'auto', timeoutSeconds: 180, model: { provider: 'worker-provider', model: 'worker-model' },
    agentPreset: 'dsh-superagent-router', overlays: [] })
  await click(find(zh['promptPart.runtime/work'], '.dt-settings-link'))
  await type(field<HTMLInputElement>(zh.maxWorkers), '5')
  // An empty root uses the default directory, which the field names instead of looking set.
  expect(field<HTMLInputElement>(zh.executionDirectory).closest('.dt-field')!.querySelector('small')?.textContent).toBe('留空时用 /srv/dsh-superagent/work')
  await type(field<HTMLInputElement>(zh.executionDirectory), '/srv/work')
  // A variable picked from the list goes where the caret is in the prepare command.
  const prepare = field<HTMLTextAreaElement>(zh.prepareCommand)
  await type(prepare, 'git worktree add ')
  prepare.setSelectionRange(17, 17)
  await click('可用的环境变量 3')
  expect(all('.dt-table tbody tr').map(row => row.textContent)).toEqual(['DSH_SUPERAGENT_DIR工单的执行目录执行器', 'DSH_SUPERAGENT_NAME工单短名执行器',
    'DSH_SUPERAGENT_GITHUB_REPOSITORY仓库GitHub · 已关闭'])
  await click('DSH_SUPERAGENT_DIR')
  expect(field<HTMLTextAreaElement>(zh.prepareCommand).value).toBe('git worktree add "$DSH_SUPERAGENT_DIR"')
  await type(field<HTMLInputElement>(zh.blockedCommands), 'gh-personal  gh.other')
  await enter(all('.dt-model input')[0]!, 'worker-provider')
  await enter(all('.dt-model input')[1]!, 'worker-model')
  // The efforts offered are the chosen model's own, after the inherited default.
  const effort = all('.dt-model input')[2]!
  await act(async () => { effort.click() })
  expect(all('[role="option"]').map(option => option.getAttribute('data-value'))).toEqual(['', 'high'])
  await press(effort, 'Escape')
  await enter(effort, 'high')
  await click(zh.save)
  expect(server.settings.executor).toEqual({ maxWorkers: 5, directory: '/srv/work',
    prepare: 'git worktree add "$DSH_SUPERAGENT_DIR"', blockedCommands: ['gh-personal', 'gh.other'], model: { provider: 'worker-provider',
      model: 'worker-model', reasoningEffort: 'high' }, agentPreset: 'dsh-superagent-worker', overlays: [] })
  expect(server.requests.filter(request => request.method === 'PUT').map(request => request.path)).toEqual(['settings/eval',
    'settings/executor'])
})

it('loads configuration history on demand with localized changes, Source field labels and notified Tickets', async () => {
  server.history = { current: 3, policyVersion: 'abcdef1234567890', items: [{ revision: 3, savedAt: '2026-09-22T00:00:00Z',
    source: 'sync', policyVersion: 'abcdef1234567890', policyChanged: true, notified: [{ id: 't1', title: '修复回归' }], block: 'policy',
    changes: [{ code: 'mode', from: 'off', to: 'observe' }, { code: 'sourceRowsAdded', source: 'feishu', field: 'allowed', items: ['Bob'],
      part: true }, { code: 'sourceField', source: 'feishu', field: 'syncChat', from: '', to: 'oc_team', part: true }] }] }
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(server.requests.some(request => request.path === 'policy/history')).toBe(false)
  await click(zh.configHistory)
  for (const expected of ['第 3 次保存 · 从群同步', '生成策略版本 abcdef12', '接单模式：关闭 → 仅观察', '飞书 · 能发起工作的飞书用户 新增：Bob', '飞书 · 同步来源群：未设置 → oc_team',
    '因策略变更通知了 1 个进行中的工单：修复回归']) expect(text()).toContain(expected)
})

it('shows save and discard only while a settings block has edits, at the end of that block', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(all('.dt-savebar')).toHaveLength(0)
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  expect(all('.dt-savebar')).toHaveLength(1)
  await type(field<HTMLInputElement>(zh.maxWorkers), '3')
  expect(all('.dt-savebar')).toHaveLength(0)
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  await click(zh.discard)
  expect(all('.dt-savebar')).toHaveLength(0)
  // A save submitted from a field keeps the focus there; one from the bar hands it to the block when the bar closes.
  const workers = field<HTMLInputElement>(zh.maxWorkers)
  await type(workers, '5')
  workers.focus()
  await act(async () => { workers.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle()
  expect(server.settings.executor.maxWorkers).toBe(5)
  expect(document.activeElement).toBe(workers)
  await type(workers, '4')
  const save = find(zh.save)
  save.focus()
  await click(save)
  expect(all('.dt-savebar')).toHaveLength(0)
  expect(document.activeElement).toBe(workers.form)
  await click(find(zh['term.source'], '.dt-settings-link'))
  expect(all('.dt-savebar')).toHaveLength(0)
  const github = all('.dt-card').find(card => card.querySelector('.dt-card-title')?.textContent === 'GitHub')!
  await type(field<HTMLInputElement>('智能体的 GitHub CLI'), 'gh-other')
  expect(github.lastElementChild!.classList.contains('dt-savebar')).toBe(true)
  // The agent CLI is read by setup, so the bar warns that saving restarts dsh-superagent and interrupts running work.
  expect(github.lastElementChild!.textContent).toContain('2 个进行中的派工会中断')
})

it('gives the focus back to the field that had it once a block\'s save ends', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  onTestFinished(() => { act(() => { root.unmount() }); container.remove() })
  const render = (disabled: boolean) => act(async () => { root.render(<Fields disabled={disabled}><input aria-label="value" /></Fields>) })
  await render(false)
  const input = container.querySelector('input')!
  input.focus()
  await render(true)
  // jsdom does not blur a control when it becomes disabled; move focus away manually.
  const elsewhere = document.createElement('button'); document.body.append(elsewhere); elsewhere.focus(); elsewhere.remove()
  expect(document.activeElement).toBe(document.body)
  await render(false)
  expect(document.activeElement).toBe(input)
})

it('lists the settings groups stages first, opens each stage\'s group from its status, and returns to the last group opened',
  async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual(['来源', '评估', '执行', '预设', '提示词', '部署'])
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['term.source'])
  for (const [tab, group] of [['来源', '来源'], ['评估', '评估'], ['执行', '执行']] as const) {
    await click(find(tab, '[role="tab"]'))
    await click(find(zh['tab.settings'], '.dt-status-head button'))
    expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(group)
  }
  // The Trigger stage has no settings, so its status offers none.
  await click(tab(zh['tab.trigger']))
  expect(all('.dt-status-head button').map(button => button.textContent)).not.toContain(zh['tab.settings'])
  await click(tab(zh['tab.settings']))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['promptPart.runtime/work'])
  await click(tab(zh['tab.trigger']))
  await remount()
  await click(tab(zh['tab.settings']))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['promptPart.runtime/work'])
})

it('runs new Executor Sessions under the agent preset a person picks, and refuses the router preset for them', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await settle()
  const card = (id: string) => (all('.dt-preset-card') as HTMLButtonElement[]).find(item => item.textContent?.includes(id))!
  expect(card('dsh-superagent-worker').getAttribute('aria-checked')).toBe('true')
  expect(card('dsh-superagent-router').disabled).toBe(true)
  await click(card('team-reviewer'))
  expect(document.querySelector('.dt-preset-field')!.textContent).toContain(zh.agentPresetApplies)
  await click(zh.save)
  expect(server.settings.executor.agentPreset).toBe('team-reviewer')
})

it('draws the dispatch pipeline over the settings, lights the step a focused field configures and names where it is', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  const node = (name: string) => document.querySelector<HTMLElement>(`.dt-pipeline-node[data-node="${name}"]`)!
  expect(node('executor').hasAttribute('data-near')).toBe(true)
  expect(node('executor').getAttribute('aria-current')).toBeNull()
  const workers = field<HTMLInputElement>(zh.maxWorkers)
  await act(async () => { workers.focus() })
  expect(node('executor').getAttribute('aria-current')).toBe('step')
  expect(node('main').getAttribute('aria-current')).toBeNull()
  expect(all('.dt-pipeline-crumb').map(item => item.textContent)).toEqual([zh['pipeline.executor'], zh['term.executor'], zh.maxWorkers])
  // The steps downstream of the edit are shaded and named, so the person sees what saving reaches.
  expect(node('reply').hasAttribute('data-impact')).toBe(true)
  expect(node('main').hasAttribute('data-impact')).toBe(false)
  expect(document.querySelector('.dt-pipeline-impact')?.textContent).toContain(zh['pipeline.reply'])
  // Under each step the map draws its components from the saved settings, and lights the one being edited.
  const part = (id: string) => document.querySelector<HTMLElement>(`.dt-pipeline-part[data-part="${id}"]`)!
  expect(part('executor-preset').textContent).toContain('dsh-superagent-worker')
  expect(part('main-overlays').textContent).toContain(zh['part.default'])
  expect(part('executor-slots').getAttribute('aria-current')).toBe('location')
  expect(part('executor-preset').getAttribute('aria-current')).toBeNull()
  // A component opens its own settings: the Policy rules on the Eval settings.
  await click(part('policy'))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.eval'])
  await click(find(zh['promptPart.runtime/work'], '.dt-settings-link'))
  // A step opens the settings that configure it.
  await click(node('policy'))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.eval'])
})

it('draws the map at the width it is shown at, so every step fits a narrow panel and the edges meet the nodes', async () => {
  const observers: { callback: ResizeObserverCallback; target?: Element }[] = []
  const original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    entry: { callback: ResizeObserverCallback; target?: Element }
    constructor(callback: ResizeObserverCallback) { this.entry = { callback }; observers.push(this.entry) }
    observe(target: Element) { this.entry.target = target }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  onTestFinished(() => { globalThis.ResizeObserver = original })
  await mount()
  await click(zh['tab.settings'])
  const resize = async (width: number) => act(async () => {
    for (const { callback, target } of observers) if (target?.classList.contains('dt-pipeline-scroll'))
      callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
  })
  const svg = () => document.querySelector<SVGSVGElement>('.dt-pipeline-svg')!
  const box = () => svg().getAttribute('viewBox')!.split(' ').map(Number)
  await resize(600)
  // The drawing is as wide as the panel (no scaling, so a node's middle and its edge sit at the same height) and five steps fit it.
  expect(box()[2]).toBeCloseTo(600, 0)
  expect(svg().style.height).toBe(`${box()[3]}px`)
  const slots = document.querySelector<HTMLElement>('.dt-pipeline-nodes')!
  const share = parseFloat(slots.style.getPropertyValue('--dt-pipeline-w')), gap = parseFloat(slots.style.getPropertyValue('--dt-pipeline-gap'))
  expect(share * 5 + gap * 4).toBeCloseTo(100, 1)
  // A last edge ends inside the drawing.
  const ends = all('.dt-pipeline-edge:not(.dt-pipeline-back)').map(path => Number(/H(-?[\d.]+)$/.exec(path.getAttribute('d')!)?.[1]))
  expect(Math.max(...ends)).toBeLessThan(600)
  // Below the floor it keeps a readable width and scrolls instead of squeezing.
  await resize(200)
  expect(box()[2]).toBeCloseTo(360, 0)
})
