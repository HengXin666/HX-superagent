/**
 * A list of short names typed as chips: a space, a comma or Enter turns what was typed into a chip, Backspace in the empty field
 * takes the last one back to edit, and each chip has its own remove button. The value stays one string of names separated by
 * spaces, the last one still being typed, so a draft keeps exactly what the person typed. In a library Field the input is the
 * field's control: named by its label, described by its note and error, and marked invalid while a chip does not match `pattern`.
 */
import { useId, useRef, type KeyboardEvent } from 'react'
import { Icon, useFieldControl } from './ui/index.ts'

const SEPARATOR = /[\s,]+/
/** The names a value holds as chips, and the one still being typed after the last separator. */
export function tagsOf(value: string): { tags: string[]; typing: string } {
  const parts = value.split(SEPARATOR)
  const typing = SEPARATOR.test(value.slice(-1)) ? '' : parts.pop() ?? ''
  return { tags: [...new Set(parts.filter(Boolean))], typing }
}
const join = (tags: string[], typing: string) => [...tags, typing].filter((part, index, all) => part || index === all.length - 1).join(' ')
  .replace(/^ /, '')

export function TagInput({ value, onChange, label, placeholder, pattern, invalidLabel, id, disabled }: {
  value: string; onChange: (next: string) => void; label: string; placeholder?: string; pattern?: RegExp; invalidLabel?: string; id?: string
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const { tags, typing } = tagsOf(value)
  const bad = pattern ? tags.filter(tag => !pattern.test(tag)) : []
  // While a chip does not match, the input is described by which ones and why, ahead of the field's note and error.
  const problemId = useId()
  const problem = bad.length > 0 ? `${invalidLabel ? `${invalidLabel}: ` : ''}${bad.join(' ')}` : ''
  const control = useFieldControl({ id, label, disabled, invalid: bad.length > 0 || undefined, describedBy: problem ? problemId : undefined })
  const set = (next: string[], text: string) => onChange(join(next, text))
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && typing) { event.preventDefault(); set(tags.includes(typing) ? tags : [...tags, typing], '') }
    else if (event.key === 'Backspace' && !typing && tags.length) { event.preventDefault(); set(tags.slice(0, -1), tags.at(-1)!) }
  }
  return <div className="dt-tags" data-invalid={control.invalid || undefined} onClick={() => input.current?.focus()}>
    {tags.map(tag => {
      const wrong = bad.includes(tag)
      return <span key={tag} className="dt-tag-chip" data-invalid={wrong || undefined} title={wrong ? invalidLabel : undefined}>
        <span className="dt-mono">{tag}</span>
        <button type="button" className="dt-tag-remove" aria-label={`${label}: ${tag} ×`} disabled={control.disabled || undefined}
          onClick={event => { event.stopPropagation()
          set(tags.filter(item => item !== tag), typing) }}><Icon name="close" size={10} /></button>
      </span>
    })}
    <input ref={input} id={control.id} className="dt-tags-input dt-mono" aria-label={control.ariaLabel} aria-describedby={control.describedBy}
      aria-invalid={control.invalid || undefined} disabled={control.disabled || undefined} spellCheck={false} value={typing}
      placeholder={tags.length ? undefined : placeholder} onKeyDown={keys}
      onChange={event => onChange(tags.length ? `${tags.join(' ')} ${event.target.value}` : event.target.value)} />
    {problem && <span id={problemId} className="hx-sr">{problem}</span>}
  </div>
}
