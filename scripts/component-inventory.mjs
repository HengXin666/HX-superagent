#!/usr/bin/env node
// Component inventory for the panel client: which components come from the new library (src/client/ui/) and which are
// hand-written in the page layer (src/client/*.tsx), who imports each one, and how many times each importer uses it.
// Usage: node scripts/component-inventory.mjs [--json]   (run from the repository root; reads only src/ and tests/)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const CLIENT = join(ROOT, 'src/client')
const UI = join(CLIENT, 'ui')
/** The 13 components that lived in the old src/client/controls.tsx (removed in 908923a) and now live in ui/. */
const FROM_CONTROLS = new Set(['Icon', 'Button', 'Tag', 'Pill', 'PageTabs', 'SegmentedControl', 'Input', 'Switch', 'StateDot', 'Dot',
  'DisclosureRow', 'Modal', 'InfoTip'])

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|mts)$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
})
const parse = path => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
  path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const isComponentName = name => (/^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name)) || /^use[A-Z]/.test(name)

/** Exported values of a module: functions, consts and classes declared with `export`, plus `export { a } from` re-exports. */
function exportsOf(source) {
  const out = []
  for (const node of source.statements) {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(node) && node.name) out.push({ name: node.name.text, kind: node.name.text.startsWith('use') ? 'hook' : 'function' })
    if (ts.isClassDeclaration(node) && node.name) out.push({ name: node.name.text, kind: 'class' })
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, kind: d.name.text.startsWith('use') ? 'hook' : 'const' })
  }
  return out
}

/** Every identifier reference in a file that is not part of an import or the declaration's own name. */
function usesIn(source) {
  const counts = new Map()
  const visit = node => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isDeclName = parent && (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node
      const isProp = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node))
      const isClosingTag = parent && ts.isJsxClosingElement(parent)
      if (!isDeclName && !isProp && !isClosingTag) counts.set(node.text, (counts.get(node.text) ?? 0) + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return counts
}

/** The module a relative import points at, with ui/index.ts resolved through its re-exports later. */
function importsOf(source, file) {
  const out = []
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const spec = node.moduleSpecifier.text
    if (!spec.startsWith('.')) continue
    const target = resolve(dirname(file), spec)
    const names = node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      ? node.importClause.namedBindings.elements.filter(e => !e.isTypeOnly && !node.importClause.isTypeOnly)
        .map(e => ({ imported: (e.propertyName ?? e.name).text, local: e.name.text })) : []
    out.push({ target, names })
  }
  return out
}

const srcFiles = walk(CLIENT)
const testFiles = walk(join(ROOT, 'tests'))
const parsed = new Map([...srcFiles, ...testFiles].map(f => [f, parse(f)]))

// Where each name is defined: ui/index.ts re-exports point back to the ui/ module that declares it.
const defined = new Map() // `${file}#${name}` -> { name, file, layer }
for (const file of srcFiles) {
  if (file.endsWith('ui/index.ts')) continue
  for (const { name, kind } of exportsOf(parsed.get(file))) {
    if (!isComponentName(name) && !file.startsWith(UI)) continue
    const layer = file.startsWith(UI) ? 'ui' : 'page'
    defined.set(`${file}#${name}`, { name, kind, file: relative(ROOT, file), layer, users: new Map(), tests: new Map() })
  }
}
const uiIndex = join(UI, 'index.ts')
const uiOwner = new Map()
for (const node of parsed.get(uiIndex).statements) {
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
    const target = resolve(UI, node.moduleSpecifier.text)
    for (const e of node.exportClause.elements) if (!e.isTypeOnly) uiOwner.set(e.name.text, target)
  }
}

for (const file of [...srcFiles, ...testFiles]) {
  const source = parsed.get(file)
  const uses = usesIn(source)
  const isTest = !file.startsWith(join(ROOT, 'src'))
  for (const { target, names } of importsOf(source, file)) {
    for (const { imported, local } of names) {
      const owner = target === uiIndex ? uiOwner.get(imported) : target
      const entry = defined.get(`${owner}#${imported}`)
      if (!entry) continue
      const count = uses.get(local) ?? 0
      ;(isTest ? entry.tests : entry.users).set(relative(isTest ? join(ROOT, 'tests') : CLIENT, file), count)
    }
  }
}

const rows = [...defined.values()].map(entry => ({
  name: entry.name, kind: entry.kind, file: entry.file.replace('src/client/', ''), layer: entry.layer,
  origin: entry.layer === 'page' ? 'page layer' : FROM_CONTROLS.has(entry.name) ? 'moved from controls.tsx' : 'ui/ native',
  users: [...entry.users].sort(), tests: [...entry.tests].sort(),
}))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const cell = list => list.length ? list.map(([f, n]) => n > 1 ? `${f}×${n}` : f).join(', ') : '—'
  for (const layer of ['ui', 'page']) {
    console.log(`\n## ${layer === 'ui' ? 'ui/' : 'page layer'}\n`)
    console.log('| Component | Kind | File | Origin | Used by (src/client, ×uses) | Tests |')
    console.log('|---|---|---|---|---|---|')
    for (const r of rows.filter(r => r.layer === layer)) console.log(`| \`${r.name}\` | ${r.kind} | \`${r.file}\` | ${r.origin} | ${cell(r.users)} | ${cell(r.tests)} |`)
  }
}
