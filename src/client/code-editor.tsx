/**
 * The panel's code editor, on CodeMirror 6: line numbers, the active line, Markdown highlighting, `{placeholder}` and `$VARIABLE`
 * marks, `$` completion of the environment's variables, search, undo history and bracket matching. Where the browser lacks what
 * CodeMirror measures layout with (`ResizeObserver`), it falls back to a plain text area with the same label and value.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from 'react'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap,
  lineNumbers, placeholder as hint, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { useFieldControl } from './ui/index.ts'

export interface CodeEditorHandle {
  /** Replace the selection with `text` and put the caret after it. */
  insert(text: string): void
  focus(): void
}
export interface CodeEditorProps {
  value: string; onChange: (next: string) => void; label: string
  language?: 'markdown' | 'shell'; placeholder?: string; className?: string; minLines?: number; maxLength?: number
  /** Variables `$` completes, with what each holds. */
  variables?: readonly { key: string; description: string }[]
  readOnly?: boolean
  /** The id a field's label points at; inside a library Field the field's own id is used. */
  id?: string
  /**
   * How a keyboard leaves the editor, read to screen readers with its label. Tab indents in an editable CodeMirror, so Escape then Tab
   * (or Ctrl+M, Shift+Alt+M on macOS) is the way out (docs/010-keyboard.md).
   */
  keysHint?: string
}
/** How long after Escape a second Escape goes on to the layer around the editor (CodeMirror keeps Tab free for 2 s after Escape). */
const ESCAPE_WINDOW = 2000
/** Whether this browser can lay CodeMirror out; jsdom and very old browsers get the text area. */
const capable = () => typeof window !== 'undefined' && typeof ResizeObserver !== 'undefined' && typeof document.createRange === 'function'

const marks = new MatchDecorator({ regexp: /\{\w+\}|\$\{?[A-Z][A-Z0-9_]*\}?/g,
  decoration: match => Decoration.mark({ class: match[0].startsWith('$') ? 'dt-cm-var' : 'dt-cm-placeholder' }) })
const markPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = marks.createDeco(view) }
  update(update: ViewUpdate) { this.decorations = marks.updateDeco(update, this.decorations) }
}, { decorations: plugin => plugin.decorations })
const theme = EditorView.theme({
  '&': { fontSize: 'var(--hx-ui-fs-code)', backgroundColor: 'var(--hx-c-bg-layer-1)', color: 'var(--hx-c-label-primary)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--hx-ui-font-mono)', padding: 'var(--hx-ui-space-2) 0', caretColor: 'var(--hx-c-brand-primary)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--hx-c-label-caption)', border: 'none', paddingLeft: 'var(--hx-ui-space-1)' },
  '.cm-activeLine': { backgroundColor: 'var(--hx-c-brand-faint)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--hx-c-label-secondary)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--hx-c-brand-selection) !important' },
  '.cm-placeholder': { color: 'var(--hx-c-label-dimmed)' },
  '.cm-tooltip': { border: 'var(--hx-ui-line)', borderRadius: 'var(--hx-ui-radius-lg)', backgroundColor: 'var(--hx-c-bg-layer-2)', overflow: 'hidden', boxShadow: 'var(--hx-ui-shadow-pop)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--hx-c-brand-fill)', color: 'var(--hx-c-label-on-brand)' },
  '.cm-panels': { backgroundColor: 'var(--hx-c-bg-layer-2)', color: 'inherit' },
})
/**
 * The semantic color a CodeMirror default highlight color stands for. CodeMirror's `defaultHighlightStyle` writes dark-on-white colors
 * (its meta gray is 1.9:1 on the dark card), so each of its colors is mapped by hue to the panel token of that role, which has a light and
 * a dark value that both pass AA on the editor's surface. Gray (meta marks, comments in some grammars) reads as caption text.
 */
export function highlightToken(hex: string): string {
  const full = hex.replace('#', '').length === 3 ? [...hex.replace('#', '')].map(c => c + c).join('') : hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min
  if (chroma < 0.15) return 'var(--hx-c-label-caption)'
  const hue = (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60
  if (hue < 12 || hue >= 330) return 'var(--hx-c-state-error-primary)'
  if (hue < 60) return 'var(--hx-c-state-warn-primary)'
  if (hue < 165) return 'var(--hx-c-state-success-primary)'
  if (hue < 215) return 'var(--hx-c-state-business-primary)'
  if (hue < 265) return 'var(--hx-c-link)'
  return 'var(--hx-c-brand-primary)'
}
/** CodeMirror's default highlighting, same tags and weights, colored through the panel's tokens. */
const highlight = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => typeof spec.color === 'string' ? { ...spec, color: highlightToken(spec.color) } : spec))
function variableCompletion(variables: readonly { key: string; description: string }[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/\$\{?[A-Z0-9_]*/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    return { from: word.from, validFor: /^\$\{?[A-Z0-9_]*$/,
      options: variables.map(variable => ({ label: `$${variable.key}`, apply: `"$${variable.key}"`, detail: variable.description, type: 'variable' })) }
  }
}

export const CodeEditor = forwardRef(function CodeEditor(props: CodeEditorProps, ref: Ref<CodeEditorHandle>) {
  const { value, onChange, label, language = 'markdown', placeholder, className, minLines = 6, maxLength, variables, keysHint } = props
  const hintId = useId()
  const escaped = useRef(0)
  const fancy = capable()
  // In a field, the text area is named by the label element; the editor's content is not labelable, so it takes aria-labelledby.
  const control = useFieldControl({ id: props.id, label, readOnly: props.readOnly }, { labelable: !fancy })
  const { id, readOnly } = control
  // Described by the field's note or error, then (in the editor) by how a keyboard leaves it.
  const describedBy = [control.describedBy, fancy && keysHint ? hintId : undefined].filter(Boolean).join(' ') || undefined
  const named = { ...control.ariaLabel !== undefined ? { 'aria-label': control.ariaLabel } : {},
    ...control.labelledBy ? { 'aria-labelledby': control.labelledBy } : {}, ...describedBy ? { 'aria-describedby': describedBy } : {} }
  const host = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const view = useRef<EditorView>(undefined)
  const changed = useRef(onChange)
  changed.current = onChange
  const editable = useRef(new Compartment())
  const attributes = useRef(new Compartment())
  useImperativeHandle(ref, () => ({
    insert(text) {
      const editor = view.current
      if (editor) {
        const { from, to } = editor.state.selection.main
        editor.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } }); editor.focus(); return
      }
      const field = area.current
      if (!field) return
      const at = field.selectionStart ?? value.length, to = field.selectionEnd ?? at
      changed.current(`${value.slice(0, at)}${text}${value.slice(to)}`)
      requestAnimationFrame(() => { field.focus(); field.setSelectionRange(at + text.length, at + text.length) })
    },
    focus() { (view.current ?? area.current)?.focus() },
  }), [value])
  useEffect(() => {
    if (!fancy || !host.current) return
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]), EditorView.lineWrapping, markPlugin, theme,
      ...language === 'markdown' ? [markdown(), syntaxHighlighting(highlight, { fallback: true })] : [],
      ...variables?.length ? [autocompletion({ override: [variableCompletion(variables)], icons: false })] : [],
      ...placeholder ? [hint(placeholder)] : [],
      ...maxLength ? [EditorState.changeFilter.of(transaction => transaction.newDoc.length <= maxLength)] : [],
      editable.current.of(EditorView.editable.of(!readOnly)),
      attributes.current.of(EditorView.contentAttributes.of({ ...named, 'aria-multiline': 'true' })),
      EditorView.updateListener.of(update => {
        if (update.docChanged) changed.current(update.state.doc.toString())
        if (update.selectionSet || update.docChanged) {
          const line = update.state.doc.lineAt(update.state.selection.main.head).number
          host.current?.setAttribute('data-line', String(line))
        }
      }),
    ] }) })
    view.current = editor
    return () => { editor.destroy(); view.current = undefined }
    // The editor is made once; value, read-only state and label follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fancy, language, variables?.map(variable => variable.key).join()])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) }) }, [readOnly])
  // The label, the note and the error can come and go after the editor is made: keep its content's name and description current.
  const naming = JSON.stringify(named)
  useEffect(() => {
    view.current?.dispatch({ effects: attributes.current.reconfigure(EditorView.contentAttributes.of({ ...named, 'aria-multiline': 'true' })) })
  }, [naming]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!fancy) return <textarea ref={area} id={id} className={`hx-textarea dt-mono ${className ?? ''}`} spellCheck={false} {...named}
    rows={minLines} maxLength={maxLength} placeholder={placeholder} readOnly={readOnly} value={value}
    onChange={event => onChange(event.target.value)} />
  /**
   * Escape in an editable editor frees Tab to leave it (CodeMirror's tab focus mode), so it stops here instead of closing the dialog or
   * drawer around it; a second Escape soon after goes on and closes that layer. A read-only editor never takes Tab, so Escape passes.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || readOnly || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const now = Date.now()
    if (now - escaped.current > ESCAPE_WINDOW) { escaped.current = now; event.stopPropagation() }
    else escaped.current = 0
  }
  return <>
    <div ref={host} id={id} className={`dt-code-editor ${className ?? ''}`} style={{ ['--dt-editor-lines' as string]: minLines }} onKeyDown={onKeyDown} />
    {keysHint && <span id={hintId} className="hx-sr">{readOnly ? '' : keysHint}</span>}
  </>
})
