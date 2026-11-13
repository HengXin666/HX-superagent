/**
 * The panel's code editor, on CodeMirror 6: line numbers, the active line, Markdown highlighting, `{placeholder}` and `$VARIABLE`
 * marks, `$` completion of the environment's variables, search, undo history and bracket matching. Where the browser lacks what
 * CodeMirror measures layout with (`ResizeObserver`), it falls back to a plain text area with the same label and value.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap,
  lineNumbers, placeholder as hint, type DecorationSet, type ViewUpdate } from '@codemirror/view'

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
  /** The id a field's label points at. */
  id?: string
}
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
  '&': { fontSize: '12.5px', backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--ds-font-family-code, Menlo, monospace)', padding: '8px 0', caretColor: 'var(--dsw-alias-brand-primary)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-caption)', border: 'none', paddingLeft: '4px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-secondary)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent) !important' },
  '.cm-placeholder': { color: 'var(--dsw-alias-label-dimmed)' },
  '.cm-tooltip': { border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: '10px', backgroundColor: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden', boxShadow: 'var(--dsw-elevation-prominent)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-primary-foreground)' },
  '.cm-panels': { backgroundColor: 'var(--dsw-alias-bg-layer-2)', color: 'inherit' },
})
function variableCompletion(variables: readonly { key: string; description: string }[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/\$\{?[A-Z0-9_]*/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    return { from: word.from, validFor: /^\$\{?[A-Z0-9_]*$/,
      options: variables.map(variable => ({ label: `$${variable.key}`, apply: `"$${variable.key}"`, detail: variable.description, type: 'variable' })) }
  }
}

export const CodeEditor = forwardRef(function CodeEditor(props: CodeEditorProps, ref: Ref<CodeEditorHandle>) {
  const { value, onChange, label, language = 'markdown', placeholder, className, minLines = 6, maxLength, variables, readOnly, id } = props
  const host = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const view = useRef<EditorView>(undefined)
  const changed = useRef(onChange)
  changed.current = onChange
  const editable = useRef(new Compartment())
  const fancy = capable()
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
      ...language === 'markdown' ? [markdown(), syntaxHighlighting(defaultHighlightStyle, { fallback: true })] : [],
      ...variables?.length ? [autocompletion({ override: [variableCompletion(variables)], icons: false })] : [],
      ...placeholder ? [hint(placeholder)] : [],
      ...maxLength ? [EditorState.changeFilter.of(transaction => transaction.newDoc.length <= maxLength)] : [],
      editable.current.of(EditorView.editable.of(!readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
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
  if (!fancy) return <textarea ref={area} id={id} className={`dt-textarea dt-mono ${className ?? ''}`} spellCheck={false} aria-label={label}
    rows={minLines} maxLength={maxLength} placeholder={placeholder} readOnly={readOnly} value={value}
    onChange={event => onChange(event.target.value)} />
  return <div ref={host} id={id} className={`dt-code-editor ${className ?? ''}`} style={{ ['--dt-editor-lines' as string]: minLines }} />
})
