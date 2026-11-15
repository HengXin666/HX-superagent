import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(process.cwd(), 'src/client')
const css = readFileSync(join(dir, 'client.css'), 'utf8')
const code = readdirSync(dir).filter(name => /\.tsx?$/.test(name)).map(name => readFileSync(join(dir, name), 'utf8')).join('\n')

it('styles only classes a component uses', () => {
  // Template literals like `dt-btn-${variant}` match any class with that prefix.
  const prefixes = [...code.matchAll(/(dt-[\w-]*-)\$\{/g)].map(match => match[1]!)
  const used = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code) || prefixes.some(prefix => name.startsWith(prefix))
  const classes = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(dt-[\w-]+)/g)].map(match => match[1]!))
  expect([...classes].filter(name => !used(name))).toEqual([])
})

it('writes one rule per line, each selector once within its block', () => {
  const blocks: string[][] = [[]]
  for (const line of css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(text => text.trim()).filter(Boolean)) {
    if (line === '}') { blocks.pop(); continue }
    if (/^@(media|container|supports)\b.*\{$/.test(line)) { blocks.push([]); continue }
    // A rule, or a keyframes rule with its steps, opens and closes on its line.
    expect(line).toMatch(/^[^{}]+\{[^{}]*\}$|^@keyframes [\w-]+ \{( [^{}]+ \{[^{}]*\})+ \}$/)
    if (line.startsWith('@')) continue
    const selector = line.slice(0, line.indexOf('{')).trim()
    expect(blocks.at(-1)).not.toContain(selector)
    blocks.at(-1)!.push(selector)
  }
})

it('draws keyboard focus with the one focus ring, from its tokens only', () => {
  const sheets = { 'client.css': css, 'ui/ui.css': readFileSync(join(dir, 'ui/ui.css'), 'utf8') }
  const RING = 'outline: var(--hx-ui-focus-outline)'
  // Surfaces that take focus only as a fallback (dialog, drawer, page region) and fields whose wrapper draws the ring may hide it.
  const HIDES = ['.hx-modal', '.hx-drawer', '.dt-main:focus-visible', '.dt-open:focus-visible', '.hx-input input', '.dt-tags-input',
    '.dt-command-input', ':focus:not(:focus-visible)']
  const found: string[] = []
  for (const [name, text] of Object.entries(sheets)) {
    for (const line of text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(item => item.trim()).filter(item => item.includes('{') && item.endsWith('}'))) {
      const selector = line.slice(0, line.indexOf('{')).trim(), body = line.slice(line.indexOf('{'))
      const focus = /:focus|:has\(:focus/.test(selector)
      // No focus style of its own: no box-shadow ring, no literal outline width or colour, offsets only from the tokens.
      if (focus && /box-shadow/.test(body)) found.push(`${name}: ${selector} draws a box-shadow ring`)
      for (const outline of body.match(/outline:[^;}]+/g) ?? []) {
        const value = outline.trim()
        if (value === 'outline: none' ? !HIDES.some(item => selector.includes(item)) : value !== RING && value !== 'outline-color: Highlight')
          found.push(`${name}: ${selector} sets ${value}`)
      }
      for (const offset of body.match(/outline-offset:[^;}]+/g) ?? [])
        if (!/var\(--hx-ui-focus-offset(-tight|-inset)?\)/.test(offset)) found.push(`${name}: ${selector} sets ${offset.trim()}`)
    }
  }
  expect(found).toEqual([])
})
