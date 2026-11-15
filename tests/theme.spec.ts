/**
 * Light and dark contrast guard for the panel's colors (docs: src/client/ui/README.md, "暗色与对比度").
 *
 * jsdom computes no colors, so this file resolves the token sheets itself: it reads theme.css and tokens.css, takes the fallback palette
 * `--hx-fb-*` for light (`:root`) and for dark (`body[data-ds-dark-theme]`), drops every host alias to its fallback (the case the panel
 * owns: a host that leaves a token out), mixes `color-mix()` and alpha over the surface underneath, and measures WCAG 2.x contrast.
 *
 *   text      4.5:1   every text color on every surface it is drawn on (WCAG 1.4.3, AA)
 *   graphics  3:1     focus indicators, switch tracks, check and radio marks, status dots (WCAG 1.4.11, AA)
 *
 * Three nets: the semantic pairs below (every text token on every surface), the component pairs (a fill and the text drawn on it),
 * and a scan of every rule in client.css and ui.css that sets `color` next to a solid `background`, so a new pair is checked without
 * being listed here. A real host's `--dsw-alias-*` values are not in this repository; they are checked in the screenshot pass.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const THEME = read('src/client/ui/theme.css')
const TOKENS = read('src/client/ui/tokens.css')
const RULE_SHEETS = { 'src/client/client.css': read('src/client/client.css'), 'src/client/ui/ui.css': read('src/client/ui/ui.css') }

type Scheme = 'light' | 'dark'
type Props = Map<string, string>
interface Block { selector: string; body: string }

/** Top-level and one-level-nested (`@media`) blocks of a sheet, in order. */
function blocks(css: string): Block[] {
  const found: Block[] = []
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) found.push({ selector: match[1]!.trim().replace(/^.*\{\s*/, ''), body: match[2]! })
  return found
}
function props(body: string): Props {
  const map: Props = new Map()
  for (const part of body.split(/;(?![^(]*\))/)) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const name = part.slice(0, colon).trim()
    if (name) map.set(name, part.slice(colon + 1).trim())
  }
  return map
}
const ROOT_SELECTOR = ':where(body, .dt-page, .dt-embedded)'
const DARK_SELECTOR = ':where(body[data-ds-dark-theme])'
const MEDIA_DARK_SELECTOR = ':where(html:not([data-ds-theme-source]) body:not([data-ds-dark-theme]))'
const themeBlocks = blocks(THEME)
const tokenBlocks = blocks(TOKENS)
const blockProps = (list: Block[], selector: string): Props[] => list.filter(b => b.selector === selector).map(b => props(b.body))
const merge = (...maps: Props[]): Props => new Map(maps.flatMap(map => [...map]))
const lightPalette = merge(...blockProps(themeBlocks, ':root'))
const darkPalette = merge(...blockProps(themeBlocks, DARK_SELECTOR))
const mediaDarkPalette = merge(...blockProps(themeBlocks, MEDIA_DARK_SELECTOR))
const semantic = merge(...blockProps(themeBlocks, ROOT_SELECTOR), ...blockProps(tokenBlocks, ROOT_SELECTOR))
const tokens = (scheme: Scheme): Props => merge(lightPalette, scheme === 'dark' ? darkPalette : new Map(), semantic)

// ---- values ---------------------------------------------------------------------------------------------------------------------

/** Split on top-level commas. */
function args(text: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1 }
  }
  out.push(text.slice(start).trim())
  return out
}
/** Substitute every `var()`; an undefined name takes its fallback, and one with none resolves to undefined. */
function substitute(value: string, env: Props, extra: Props = new Map(), depth = 0): string | undefined {
  if (depth > 40) throw new Error(`token cycle in ${value}`)
  const at = value.indexOf('var(')
  if (at < 0) return value
  let level = 0, end = at + 4
  for (; end < value.length; end++) {
    if (value[end] === '(') level++
    else if (value[end] === ')') { if (level === 0) break; level-- }
  }
  const [name, ...rest] = args(value.slice(at + 4, end))
  const own = extra.get(name!) ?? env.get(name!)
  const replacement = own !== undefined ? substitute(own, env, extra, depth + 1) : rest.length ? substitute(rest.join(','), env, extra, depth + 1) : undefined
  if (replacement === undefined) return undefined
  return substitute(value.slice(0, at) + replacement + value.slice(end + 1), env, extra, depth + 1)
}

interface RGBA { r: number; g: number; b: number; a: number }
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 }
const percent = (text: string): number => text.trim().endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
function hsl(h: number, s: number, l: number, a = 1): RGBA {
  const k = (n: number) => (n + h / 30) % 12
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a }
}
/** Parse a resolved color: hex, rgb()/hsl() in either syntax, `transparent`, `color-mix(in srgb, …)`. */
function parse(text: string): RGBA | undefined {
  const value = text.trim()
  if (value === 'transparent') return TRANSPARENT
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex) {
    let h = hex[1]!
    if (h.length <= 4) h = [...h].map(c => c + c).join('')
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?|color-mix)\(([\s\S]*)\)$/i.exec(value)
  if (!fn) return undefined
  const kind = fn[1]!.toLowerCase(), inner = fn[2]!
  if (kind === 'color-mix') {
    const [space, first, second] = args(inner)
    if (!/^in srgb$/.test(space!.trim()) || !first || !second) return undefined
    const split = (part: string): [RGBA | undefined, number | undefined] => {
      const m = /^(.*?)\s+(\d*\.?\d+%)$/.exec(part.trim())
      return m ? [parse(m[1]!), percent(m[2]!)] : [parse(part), undefined]
    }
    const [a, pa] = split(first), [b, pb] = split(second)
    if (!a || !b) return undefined
    const p1 = pa ?? (pb === undefined ? 0.5 : 1 - pb), p2 = pb ?? 1 - p1
    // CSS color-mix interpolates premultiplied channels.
    const alpha = a.a * p1 + b.a * p2
    if (alpha === 0) return TRANSPARENT
    const ch = (k: 'r' | 'g' | 'b') => (a[k] * a.a * p1 + b[k] * b.a * p2) / alpha
    return { r: ch('r'), g: ch('g'), b: ch('b'), a: alpha * (p1 + p2 < 1 ? p1 + p2 : 1) }
  }
  const parts = inner.replace(/\//, ' / ').split(/[\s,]+/).filter(Boolean)
  const slash = parts.indexOf('/')
  const channels = slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3)
  const alphaText = slash >= 0 ? parts[slash + 1] : parts[3]
  const a = alphaText === undefined ? 1 : percent(alphaText)
  if (kind.startsWith('rgb')) return { r: parseFloat(channels[0]!), g: parseFloat(channels[1]!), b: parseFloat(channels[2]!), a }
  return hsl(parseFloat(channels[0]!), percent(channels[1]!), percent(channels[2]!), a)
}
/** `top` painted over `bottom`. */
const over = (top: RGBA, bottom: RGBA): RGBA => {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return TRANSPARENT
  const ch = (k: 'r' | 'g' | 'b') => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a
  return { r: ch('r'), g: ch('g'), b: ch('b'), a }
}
const luminance = ({ r, g, b }: RGBA): number => {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const ratio = (a: RGBA, b: RGBA): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

/** Resolve a color expression (a token name or any value) in a scheme; `--x` alone means `var(--x)`. */
function color(expr: string, scheme: Scheme, extra?: Props): RGBA {
  const value = substitute(expr.startsWith('--') ? `var(${expr})` : expr, tokens(scheme), extra)
  const parsed = value === undefined ? undefined : parse(value)
  if (!parsed) throw new Error(`cannot resolve ${expr} in ${scheme}: ${value}`)
  return parsed
}
/** A surface: layers listed bottom first, each painted over the last; the page underneath is opaque bg-base. */
const surface = (layers: string[], scheme: Scheme, extra?: Props): RGBA =>
  layers.reduce((under, layer) => over(color(layer, scheme, extra), under), color('--hx-c-bg-base', scheme))
/** Contrast of `fg` over the surface; a translucent fg is painted over it first. */
const contrast = (fg: string, layers: string[], scheme: Scheme, extra?: Props): number => {
  const under = surface(layers, scheme, extra)
  return ratio(over(color(fg, scheme, extra), under), under)
}
const SCHEMES: Scheme[] = ['light', 'dark']
const TEXT = 4.5, GRAPHIC = 3
const fmt = (n: number) => n.toFixed(2)

// ---- pairs ----------------------------------------------------------------------------------------------------------------------

/** Every surface body text can sit on: the page, the three layers, the module tint, popovers and toasts, and the hover, active and selected states over a card. */
const SURFACES: string[][] = [
  ['--hx-c-bg-base'], ['--hx-c-bg-layer-1'], ['--hx-c-bg-layer-2'], ['--hx-c-bg-layer-3'], ['--hx-c-bg-module-platform'], ['--hx-c-toast-bg'],
  ['--hx-c-bg-layer-1', '--hx-c-interactive-bg-hover'], ['--hx-c-bg-layer-1', '--hx-c-interactive-bg-active'],
  ['--hx-c-bg-layer-2', '--hx-c-interactive-bg-hover'], ['--hx-c-bg-layer-3', '--hx-c-interactive-bg-hover'],
  ['--hx-c-bg-layer-1', '--hx-c-brand-selected'], ['--hx-c-bg-layer-1', '--hx-c-row-selected'], ['--hx-c-bg-layer-1', '--hx-c-brand-soft'],
  ['--hx-c-brand-surface'], ['--hx-c-brand-surface-strong'], ['--hx-c-bg-layer-1', '--hx-c-neutral-subtle'],
  ['--hx-c-bg-layer-1', '--hx-c-button-ghost-active-fill'], ['--hx-c-bg-layer-1', '--hx-c-brand-faint'],
  // The gradients the guard cannot follow: the pipeline map (brand-subtle at its corner) and the preset bar (brand-surface-faint at its start).
  ['--hx-c-bg-layer-1', '--hx-c-brand-subtle'], ['--hx-c-brand-surface-faint'], ['--hx-c-brand-surface-subtle'],
]
/** Text tokens that may sit on any of SURFACES. `label-dimmed` is not text: it is for decoration and disabled states only. */
const TEXT_TOKENS = ['--hx-c-label-primary', '--hx-c-label-secondary', '--hx-c-label-tertiary', '--hx-c-label-caption']
/** Colored text (links, status words, badges): on the plain surfaces, and on its own tint, which is how a badge, banner or chip draws it. */
const TONES = ['--hx-c-brand-primary', '--hx-c-link', '--hx-c-state-success-primary', '--hx-c-state-warn-primary', '--hx-c-state-error-primary',
  '--hx-c-state-business-primary', '--hx-c-state-idle-primary']
const TONE_SURFACES: string[][] = [['--hx-c-bg-base'], ['--hx-c-bg-layer-1'], ['--hx-c-bg-layer-2'], ['--hx-c-bg-layer-3'], ['--hx-c-bg-module-platform'],
  ['--hx-c-bg-layer-1', '--hx-c-interactive-bg-hover'], ['--hx-c-bg-layer-1', '--hx-c-brand-faint']]
/**
 * The badge tint (12%), on every surface a badge is drawn on: the cards and popovers, and the selected and tinted cards
 * (a checked preset card is brand-surface-subtle, and its "current" badge sits on top of that). Stronger tints that carry
 * their own tone's text are listed in FILLS or found by the rule scan.
 */
const BADGE_BASES: string[][] = [['--hx-c-bg-layer-1'], ['--hx-c-bg-layer-2'], ['--hx-c-bg-layer-3'], ['--hx-c-bg-module-platform'],
  ['--hx-c-brand-surface-faint'], ['--hx-c-brand-surface-subtle'], ['--hx-c-brand-surface'], ['--hx-c-brand-surface-strong'],
  ['--hx-c-bg-layer-1', '--hx-c-row-selected'], ['--hx-c-bg-layer-1', '--hx-c-interactive-bg-hover'], ['--hx-c-bg-layer-2', '--hx-c-interactive-bg-hover']]
const toneTints = (tone: string): string[][] => [12].flatMap(p => BADGE_BASES.map(base => [...base, `color-mix(in srgb, var(${tone}) ${p}%, transparent)`]))
/** A solid fill and the text drawn on it. */
const FILLS: [fg: string, layers: string[], where: string][] = [
  ['--hx-c-label-primary-foreground', ['--hx-c-button-primary-fill'], 'primary button'],
  ['--hx-c-label-primary-foreground', ['--hx-c-button-primary-hover'], 'primary button, hover'],
  ['--hx-c-label-on-brand', ['--hx-c-brand-fill'], 'brand fill: current-step pill, lit pipeline icon, selected completion'],
  ['--hx-c-label-on-danger', ['--hx-c-danger-fill'], 'danger button'],
  ['--hx-c-label-on-danger', ['--hx-c-danger-hover'], 'danger button, hover'],
  ['--hx-c-label-primary-foreground', ['--hx-c-tooltip-bg'], 'tooltip'],
  ['--hx-c-label-primary', ['--hx-c-bg-layer-1', '--hx-c-highlight'], 'search mark'],
  ['--hx-c-label-primary', ['--hx-c-bg-layer-1', '--hx-c-success-strong'], 'diff insert'],
  ['--hx-c-label-primary', ['--hx-c-bg-layer-1', '--hx-c-error-strong'], 'diff delete'],
  ['--hx-c-label-primary', ['--hx-c-bg-layer-1', '--hx-c-brand-selection'], 'editor selection'],
  ['--hx-c-label-primary', ['--hx-c-bg-layer-1', '--hx-c-brand-faint'], 'editor active line'],
  ['--hx-c-state-warn-primary', ['--hx-c-bg-layer-1', '--hx-c-warn-soft'], 'editor {placeholder} mark'],
  ['--hx-c-state-business-primary', ['--hx-c-bg-layer-1', '--hx-c-business-medium'], 'editor $VARIABLE mark'],
]
/** Graphics that carry meaning against what surrounds them. */
const GRAPHICS: [fg: string, layers: string[], where: string][] = [
  ['--hx-c-brand-primary', ['--hx-c-bg-base'], 'focus outline on the page'],
  ['--hx-c-brand-primary', ['--hx-c-bg-layer-1'], 'focus outline, switch on, radio and check marks'],
  ['--hx-c-brand-primary', ['--hx-c-bg-layer-2'], 'focus outline in a popover'],
  ['--hx-c-control-edge', ['--hx-c-bg-layer-1'], 'switch track off, check and radio boxes'],
  ['--hx-c-control-edge', ['--hx-c-bg-layer-2'], 'switch track off in a popover'],
  ['--hx-c-bg-layer-1', ['--hx-c-control-edge'], 'switch thumb on the off track'],
  ['--hx-c-bg-layer-1', ['--hx-c-brand-primary'], 'switch thumb on the on track'],
  ['--hx-c-control-edge', ['--hx-c-bg-layer-1', '--hx-c-brand-subtle'], 'pipeline edges and arrowheads'],
  ['--hx-c-state-business-primary', ['--hx-c-bg-layer-1', '--hx-c-brand-subtle'], 'flowing pipeline edge'],
  ['--hx-c-state-idle-primary', ['--hx-c-bg-layer-1'], 'idle status dot'],
  ['--hx-c-label-on-brand', ['--hx-c-brand-fill'], 'check glyph on a brand fill'],
]

// ---- tests ----------------------------------------------------------------------------------------------------------------------

describe('fallback palette', () => {
  it('gives every light color a dark value and the reverse', () => {
    expect([...darkPalette.keys()].sort()).toEqual([...lightPalette.keys()].sort())
  })
  it('keeps the prefers-color-scheme copy of the dark palette identical to body[data-ds-dark-theme]', () => {
    expect(Object.fromEntries(mediaDarkPalette)).toEqual(Object.fromEntries(darkPalette))
  })
  it('maps every semantic color to a host alias with a fallback or to the palette, so no scheme leaves one unresolved', () => {
    const bad: string[] = []
    for (const scheme of SCHEMES) for (const [name, value] of semantic) {
      if (!/^--hx-c-/.test(name) || /font|shadow-alpha|elevation|frame-top/.test(name) || /currentColor/.test(value)) continue
      if (substitute(value, tokens(scheme)) === undefined) bad.push(`${scheme} ${name}`)
      else try { color(name, scheme) } catch (error) { bad.push(String(error)) }
    }
    expect(bad).toEqual([])
  })
})

describe('text contrast, WCAG AA 4.5:1', () => {
  for (const scheme of SCHEMES) {
    it(`${scheme}: every text token on every surface`, () => {
      const bad = TEXT_TOKENS.flatMap(fg => SURFACES.map(layers => [fg, layers, contrast(fg, layers, scheme)] as const))
        .filter(([, , value]) => value < TEXT).map(([fg, layers, value]) => `${fg} on ${layers.join(' + ')}: ${fmt(value)}`)
      expect(bad).toEqual([])
    })
    it(`${scheme}: every tone on the plain surfaces and on its own tint`, () => {
      const bad = TONES.flatMap(fg => [...TONE_SURFACES, ...toneTints(fg)].map(layers => [fg, layers, contrast(fg, layers, scheme)] as const))
        .filter(([, , value]) => value < TEXT).map(([fg, layers, value]) => `${fg} on ${layers.join(' + ')}: ${fmt(value)}`)
      expect(bad).toEqual([])
    })
    it(`${scheme}: text on fills`, () => {
      const bad = FILLS.map(([fg, layers, where]) => [where, contrast(fg, layers, scheme)] as const)
        .filter(([, value]) => value < TEXT).map(([where, value]) => `${where}: ${fmt(value)}`)
      expect(bad).toEqual([])
    })
    it(`${scheme}: the preset number on its hue, for every hue a preset can get`, () => {
      const bad: string[] = []
      for (let hue = 0; hue < 360; hue++) {
        const extra = new Map([['--dt-hue', String(hue)]])
        const fill = substitute('var(--hx-preset-fill)', tokens(scheme), merge(presetTokens(scheme), extra))!
        const value = ratio(color('--hx-c-label-on-brand', scheme), parse(fill)!)
        if (value < TEXT) bad.push(`hue ${hue}: ${fmt(value)}`)
      }
      expect(bad).toEqual([])
    })
  }
})

describe('graphics contrast, WCAG AA 3:1', () => {
  for (const scheme of SCHEMES) it(`${scheme}: focus, controls and status marks`, () => {
    const bad = GRAPHICS.map(([fg, layers, where]) => [where, contrast(fg, layers, scheme)] as const)
      .filter(([, value]) => value < GRAPHIC).map(([where, value]) => `${where}: ${fmt(value)}`)
    expect(bad).toEqual([])
  })
})

/** The preset tokens of tokens.css, which resolve on the element that carries `--dt-hue`. */
function presetTokens(scheme: Scheme): Props {
  const list = tokenBlocks.filter(b => /\.dt-preset-chip/.test(b.selector) && !b.selector.includes('dark'))
  const dark = scheme === 'dark' ? tokenBlocks.filter(b => /\.dt-preset-chip/.test(b.selector) && b.selector.includes('dark')) : []
  return merge(...list.map(b => props(b.body)), ...dark.map(b => props(b.body)))
}

describe('every rule that pairs a text color with a solid background', () => {
  const pairs: { where: string; fg: string; bg: string }[] = []
  for (const [file, css] of Object.entries(RULE_SHEETS)) for (const block of blocks(css)) {
    const own = props(block.body)
    const fg = own.get('color')
    const bg = own.get('background-color') ?? own.get('background')
    if (!fg || !bg || /inherit|currentcolor/i.test(fg) || /^(none|transparent|inherit)$|gradient|url\(/i.test(bg)) continue
    // Disabled controls are exempt from 1.4.3; they also carry opacity.
    if (/:disabled|\[aria-disabled|\[disabled|placeholder-shown/.test(block.selector)) continue
    pairs.push({ where: `${file} ${block.selector}`, fg, bg })
  }
  it('finds the pairs', () => {
    expect(pairs.length).toBeGreaterThan(10)
  })
  for (const scheme of SCHEMES) it(`${scheme}: each reaches 4.5:1`, () => {
    const bad: string[] = []
    for (const { where, fg, bg } of pairs) {
      // A translucent background sits on a card, which is where these rules draw.
      for (const base of ['--hx-c-bg-layer-1', '--hx-c-bg-layer-2']) {
        let value: number
        try { value = contrast(fg, [base, bg], scheme) } catch { continue }
        if (value < TEXT) bad.push(`${where} over ${base}: ${fmt(value)}`)
      }
    }
    expect(bad).toEqual([])
  })
})

/** Follow a component token (`var(--hx-btn-fg)`) down to the semantic color it stands for (`var(--hx-c-label-primary)`). */
function semanticOf(value: string): string {
  let current = value.trim()
  for (let i = 0; i < 10; i++) {
    const m = /^var\((--hx-[a-z0-9-]+)\)$/.exec(current)
    if (!m || m[1]!.startsWith('--hx-c-')) return current
    const next = semantic.get(m[1]!)
    if (next === undefined) return current
    current = next.trim()
  }
  return current
}

describe('text colors in the rule sheets', () => {
  /** Colors a rule may set as `color` with no background of its own: text tokens and tones checked on every surface above. */
  const ALLOWED = new Set([...TEXT_TOKENS, ...TONES].map(name => `var(${name})`))
  /** Colors that are only legible on the fill their rule (or its parent's) paints, each checked in FILLS or the rule scan. */
  const ON_FILL = new Set(['var(--hx-c-label-primary-foreground)', 'var(--hx-c-label-on-brand)', 'var(--hx-c-label-on-danger)'])
  it('draws text only in tokens that pass on every surface, never label-dimmed', () => {
    const bad: string[] = []
    for (const [file, css] of Object.entries(RULE_SHEETS)) for (const block of blocks(css)) {
      const own = props(block.body).get('color')
      if (!own || /^(inherit|currentcolor|transparent)$/i.test(own)) continue
      const fg = semanticOf(own)
      if (ALLOWED.has(fg) || ON_FILL.has(fg) || /^(inherit|currentcolor|transparent)$/i.test(fg)) continue
      // A badge or toast takes its tone from data-tone; every tone is in TONES, and the default is label-tertiary.
      if (fg === 'var(--hx-tone)' || fg === 'var(--hx-badge-fg)') continue
      bad.push(`${file} ${block.selector} { color: ${fg} }`)
    }
    expect(bad).toEqual([])
  })
})

describe('code editor', () => {
  const source = readFileSync(join(ROOT, 'src/client/code-editor.tsx'), 'utf8')
  it("highlights through the panel's tokens, not CodeMirror's light-only default colors", () => {
    expect(source).not.toMatch(/syntaxHighlighting\(\s*defaultHighlightStyle/)
    const used = [...source.matchAll(/var\((--hx-c-[a-z0-9-]+)\)/g)].map(m => m[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(semantic.has(name), name).toBe(true)
  })
  it('maps each highlight color to a text token or tone, and each passes on the editor surface and its active line in both schemes', async () => {
    const { highlightToken } = await import('../src/client/code-editor.tsx')
    const { defaultHighlightStyle } = await import('@codemirror/language')
    const colors = defaultHighlightStyle.specs.map(spec => spec.color).filter((value): value is string => typeof value === 'string')
    expect(colors.length).toBeGreaterThan(5)
    const bad: string[] = []
    for (const hex of colors) {
      const token = highlightToken(hex).slice(4, -1)
      if (![...TEXT_TOKENS, ...TONES].includes(token)) bad.push(`${hex} -> ${token}`)
      for (const scheme of SCHEMES) for (const layers of [['--hx-c-bg-layer-1'], ['--hx-c-bg-layer-1', '--hx-c-brand-faint']]) {
        const value = contrast(token, layers, scheme)
        if (value < TEXT) bad.push(`${scheme} ${hex} -> ${token} on ${layers.join(' + ')}: ${fmt(value)}`)
      }
    }
    expect(bad).toEqual([])
  })
})
