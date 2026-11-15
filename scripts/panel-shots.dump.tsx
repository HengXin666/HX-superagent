// @vitest-environment jsdom
// Stage 0 light/dark comparison, step 1: render Settings, Execution and Console from src/ with the test fixtures' fake server
// and write each page's HTML to $PANEL_SHOTS_DIR (default .artifacts/panel-shots). Step 2 is scripts/panel-shots.py.
// Run: pnpm exec vitest run --config scripts/panel-shots.vitest.config.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { liveFeed, server } from '../tests/fixtures/panel-server.ts'
import { click, mount, settle, tab, usePanel } from '../tests/fixtures/panel.tsx'

const OUT = process.env.PANEL_SHOTS_DIR ?? '.artifacts/panel-shots'
usePanel()

it('writes the HTML of each compared page', async () => {
  mkdirSync(OUT, { recursive: true })
  server.live = liveFeed()
  await mount()
  for (const page of ['settings', 'execution', 'console'] as const) {
    await click(tab(zh[`tab.${page}`]))
    await settle()
    writeFileSync(`${OUT}/${page}.html`, '<!doctype html>' + document.documentElement.outerHTML)
  }
})
