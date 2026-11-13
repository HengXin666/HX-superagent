// @vitest-environment jsdom
// The code editor: CodeMirror where the browser can lay it out, with marks, completion and insertion; a text area elsewhere.
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeEditor, type CodeEditorHandle } from '../src/client/code-editor.tsx'
import { tagsOf } from '../src/client/tag-input.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
function render(node: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return { container, unmount: () => act(() => root.unmount()) }
}

it('runs CodeMirror with the label, marks placeholders and variables, inserts at the caret and reports the line', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const changes: string[] = []
  const ref = createRef<CodeEditorHandle>()
  const { container, unmount } = render(<CodeEditor ref={ref} label="Prepare" language="shell" value={'echo {name}\ncd $DSH_SUPERAGENT_DIR'}
    variables={[{ key: 'DSH_SUPERAGENT_DIR', description: 'The ticket directory' }]} onChange={next => changes.push(next)} />)
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Prepare')
  expect(container.querySelector('.dt-cm-placeholder')?.textContent).toBe('{name}')
  expect(container.querySelector('.dt-cm-var')?.textContent).toBe('$DSH_SUPERAGENT_DIR')
  act(() => { ref.current!.insert('X') })
  expect(changes.at(-1)).toBe('Xecho {name}\ncd $DSH_SUPERAGENT_DIR')
  expect(container.querySelector('.dt-code-editor')?.getAttribute('data-line')).toBe('1')
  unmount()
})

it('falls back to a text area with the same label where CodeMirror cannot lay out', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  const { container } = render(<CodeEditor label="Body" value="text" onChange={() => {}} />)
  expect(container.querySelector('textarea')?.getAttribute('aria-label')).toBe('Body')
})

it('reads a tag input\'s chips and the name still being typed from its value', () => {
  expect(tagsOf('a  b, a c')).toEqual({ tags: ['a', 'b'], typing: 'c' })
  expect(tagsOf('a b ')).toEqual({ tags: ['a', 'b'], typing: '' })
  expect(tagsOf('')).toEqual({ tags: [], typing: '' })
})
