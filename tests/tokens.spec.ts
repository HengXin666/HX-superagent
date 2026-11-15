/**
 * Style guard for the panel's three token layers (docs: src/client/ui/README.md, "Design tokens").
 *
 *   host alias   `--dsw-*`, `--ds-*`, `--dsh-*`      written by the DSH host; read only in theme.css
 *   semantic     `--hx-c-*` colors, `--hx-ui-*` scale  declared only in theme.css and tokens.css
 *   component    `--hx-<component>-*`, `--hx-tone`     declared only in tokens.css, from semantic tokens
 *
 * Every other stylesheet and every component colors, spaces, rounds, sets type, animates and draws focus through those tokens,
 * so a visual change is a change to one token. This file fails when a written-down value comes back.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CLIENT = join(ROOT, 'src/client')
const THEME = 'src/client/ui/theme.css'
const TOKENS = 'src/client/ui/tokens.css'
const files = (dir: string, pattern: RegExp): string[] => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && pattern.test(entry.name)).map(entry => relative(ROOT, join(entry.parentPath, entry.name))).sort()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const sheets = files(CLIENT, /\.css$/)
const tokenSheets = [THEME, TOKENS]
const ruleSheets = sheets.filter(path => !tokenSheets.includes(path))
const scripts = files(CLIENT, /\.tsx?$/).filter(path => !path.endsWith('locales.ts') && !path.endsWith('.d.ts'))

interface Declaration { file: string; selector: string; property: string; value: string }
/** Every declaration of a stylesheet with the selector it sits under (keyframe steps included). */
function declarations(file: string): Declaration[] {
  const css = strip(read(file))
  const found: Declaration[] = []
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim().replace(/^.*\{\s*/, '')
    for (const part of match[2]!.split(/;(?![^(]*\))/)) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const property = part.slice(0, colon).trim()
      if (!property) continue
      found.push({ file, selector, property, value: part.slice(colon + 1).trim() })
    }
  }
  return found
}
const all = sheets.flatMap(declarations)
const where = (d: Declaration): string => `${d.file} ${d.selector} { ${d.property}: ${d.value} }`

const HOST = /var\(\s*--(dsw|ds|dsh)-/
const FALLBACK = /--hx-fb-/
/** A color written down: hex, a color function with a literal channel, or a named color. */
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]|\b(white|black|red|green|blue|gray|grey|orange|yellow|purple)\b/i
/** A length or a duration written down; `0` and unitless numbers are fine. */
const RAW_UNIT = /(?<![\w-])-?\d*\.?\d+(px|rem|em|ms|s)\b/
/** Properties whose value is a color, a space, a radius, type, motion or focus: these read tokens only. */
const GUARDED = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline))?(-(color|width|style))?|border-radius|outline(-color|-offset|-width)?|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|accent-color|gap|row-gap|column-gap|padding(-[a-z]+)?|margin(-[a-z]+)?|inset(-[a-z]+)?|top|right|bottom|left|scroll-(padding|margin)(-[a-z]+)?|font|font-size|font-weight|font-family|line-height|letter-spacing|transition(-[a-z]+)?|animation(-duration|-delay)?|z-index)$/
/** Numeric weights and z-indexes above the in-component stacking range are written down too. */
const RAW_NUMBER: Record<string, RegExp> = { 'font-weight': /^\d+$/, 'z-index': /^(?:[5-9]|\d{2,})$/, font: /^\d{3}\b/ }

describe('host alias layer', () => {
  it('reads --dsw-*, --ds-* and --dsh-* only in theme.css', () => {
    const css = all.filter(d => d.file !== THEME && (HOST.test(d.value) || HOST.test(d.property)))
    const code = scripts.filter(path => /--(dsw|ds|dsh)-/.test(read(path)))
    expect([...css.map(where), ...code]).toEqual([])
  })
  it('keeps the fallback palette --hx-fb-* inside theme.css', () => {
    expect([...all.filter(d => d.file !== THEME && FALLBACK.test(d.property + d.value)).map(where),
      ...scripts.filter(path => FALLBACK.test(read(path)))]).toEqual([])
  })
})

describe('semantic layer', () => {
  it('declares --hx-c-* and --hx-ui-* only in theme.css and tokens.css', () => {
    expect(all.filter(d => /^--hx-(c|ui)-/.test(d.property) && !tokenSheets.includes(d.file)).map(where)).toEqual([])
  })
  it('declares semantic colors from host aliases and the fallback palette, never from component tokens', () => {
    const bad = all.filter(d => d.file === THEME && /^--hx-c-/.test(d.property) && /var\(--hx-(?!c-|fb-|ui-)/.test(d.value))
    expect(bad.map(where)).toEqual([])
  })
})

describe('component layer', () => {
  it('declares custom properties in token sheets only (pages may pass --dt-* data inline)', () => {
    expect(all.filter(d => d.property.startsWith('--') && !tokenSheets.includes(d.file)).map(where)).toEqual([])
  })
  it('builds component tokens from semantic tokens, not host aliases or written-down colors', () => {
    const component = all.filter(d => d.file === TOKENS && /^--hx-(?!c-|ui-)/.test(d.property))
    expect(component.filter(d => HOST.test(d.value) || FALLBACK.test(d.value) || /#[0-9a-f]{3,8}\b/i.test(d.value)).map(where)).toEqual([])
  })
  it('defines every token a stylesheet or a component reads', () => {
    const defined = new Set(all.filter(d => d.property.startsWith('--')).map(d => d.property))
    const inline = new Set(scripts.flatMap(path => [...read(path).matchAll(/'(--dt-[\w-]+)'/g)].map(match => match[1]!)))
    const read_ = (text: string) => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]!)
    const used = [...all.flatMap(d => read_(d.value).map(name => ({ name, at: where(d) }))),
      ...scripts.flatMap(path => read_(read(path)).map(name => ({ name, at: path })))]
    const missing = used.filter(({ name }) => /^--hx-/.test(name) && !defined.has(name)
      || /^--dt-/.test(name) && !defined.has(name) && !inline.has(name))
    expect(missing.map(({ name, at }) => `${name} in ${at}`)).toEqual([])
  })
  it('colors ui.css components through their component tokens only, never a semantic color directly', () => {
    expect(all.filter(d => d.file === 'src/client/ui/ui.css' && /var\(\s*--hx-c-/.test(d.value)).map(where)).toEqual([])
  })
  it('reads every component token it declares', () => {
    const text = [...sheets.map(read), ...scripts.map(read)].join('\n')
    const component = [...new Set(all.filter(d => d.file === TOKENS && /^--hx-(?!c-|ui-)/.test(d.property)).map(d => d.property))]
    expect(component.filter(name => !new RegExp(`var\\(\\s*${name}[,)\\s]`).test(text))).toEqual([])
  })
})

describe('focus', () => {
  // One way to draw focus: the outline built from --hx-ui-focus-width, --hx-ui-focus-color and an --hx-ui-focus-offset* step.
  const focusTokens = [...new Set(all.filter(d => tokenSheets.includes(d.file) && /^--hx-.*focus/.test(d.property)).map(d => d.property))]
  it('declares no per-component focus token and no box-shadow ring, so the focus look changes in one place', () => {
    const allowed = /^--hx-ui-focus-(width|color|outline|border|offset(-inset)?)$|^--hx-input-focus-border$/
    expect(focusTokens.filter(name => !allowed.test(name))).toEqual([])
  })
  it('reads every focus token it declares, so no second focus style waits in the sheets', () => {
    const text = [...sheets.map(file => strip(read(file))), ...scripts.map(read)].join('\n')
    expect(focusTokens.filter(name => !new RegExp(`var\\(\\s*${name}[,)\\s]`).test(text))).toEqual([])
  })
})

describe('no written-down values', () => {
  it('writes no colors outside theme.css and tokens.css', () => {
    expect(all.filter(d => !tokenSheets.includes(d.file) && RAW_COLOR.test(d.value)).map(where)).toEqual([])
  })
  it('mixes colors only in the token sheets', () => {
    expect(all.filter(d => !tokenSheets.includes(d.file) && /color-mix\(/.test(d.value)).map(where)).toEqual([])
  })
  it('spaces, rounds, sets type, animates and draws focus through tokens', () => {
    const bad = all.filter(d => !tokenSheets.includes(d.file) && GUARDED.test(d.property)).filter(d => {
      const value = d.value.replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, 'TOKEN')
      return RAW_UNIT.test(value) || RAW_NUMBER[d.property]?.test(value) === true
    })
    expect(bad.map(where)).toEqual([])
  })
  it('keeps component scale, focus and color tokens on tokens, never on raw lengths, outside the scale itself', () => {
    // Component tokens may hold percentages (mix strengths, gradients) but take lengths and times from --hx-ui-*.
    const component = all.filter(d => d.file === TOKENS && /^--hx-(?!c-|ui-)/.test(d.property))
    expect(component.filter(d => RAW_UNIT.test(d.value.replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, 'TOKEN'))).map(where)).toEqual([])
  })
  it('passes no styling literals from components: colors, lengths and host tokens stay in the stylesheets', () => {
    // Inline styles may carry layout numbers (a width, a row height) and --dt-* data, never a color, a font size or a spacing string.
    const literal = /['"`](?:[^'"`]*\s)?-?\d*\.?\d+(px|rem|em|ms)\b[^'"`]*['"`]|#[0-9a-f]{3,8}\b['"`]|\b(rgba?|hsla?)\(\s*\d/i
    expect(scripts.filter(path => literal.test(read(path).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')))).toEqual([])
  })
})

describe('token sheets', () => {
  it('ships the three layers in order: theme, tokens, components', () => {
    expect(read('src/client/ui/index.ts')).toMatch(/UI_STYLES = `\$\{THEME\}\\n\$\{TOKENS\}\\n\$\{COMPONENTS\}`/)
  })
  it('keeps the reduced-motion switch on the motion tokens', () => {
    expect(strip(read(TOKENS))).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \{[^}]*--hx-ui-dur-fast: 0ms/)
  })
})
