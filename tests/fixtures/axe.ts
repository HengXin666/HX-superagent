/**
 * The panel's automated accessibility bar, shared by the page-level run (a11y.spec.tsx) and the open-layer run (a11y-layers.spec.tsx):
 * axe-core with zero `critical` and zero `serious` violations. Colour contrast is left to the dark/light screenshot pass, because
 * jsdom does not lay out or paint and axe cannot compute colours there.
 */
import axe from 'axe-core'

/**
 * Rules axe cannot judge here: those that need layout or paint, which jsdom does not have, and the two about the host document
 * (its <title> and <html lang>), which belong to the DSH page the panel is embedded in. Everything else runs.
 */
export const SKIPPED = ['color-contrast', 'color-contrast-enhanced', 'link-in-text-block', 'target-size', 'scrollable-region-focusable',
  'document-title', 'html-has-lang']
export const SEVERE = ['critical', 'serious'] as const

/** Runs axe on the whole document and returns the severe violations as readable lines (rule, impact, first nodes). */
export async function severe(context: axe.ElementContext = document): Promise<string[]> {
  const result = await axe.run(context, {
    resultTypes: ['violations'],
    rules: Object.fromEntries(SKIPPED.map(rule => [rule, { enabled: false }])),
  })
  return result.violations.filter(violation => (SEVERE as readonly string[]).includes(violation.impact ?? ''))
    .map(violation => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map(node => node.target.join(' ')).join(' | ')}`)
}
