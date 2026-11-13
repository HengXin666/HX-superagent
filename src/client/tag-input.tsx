/**
 * A list of short names typed as chips: a space, a comma or Enter turns what was typed into a chip, Backspace in the empty field
 * takes the last one back to edit, and each chip has its own remove button. The value stays one string of names separated by
 * spaces, the last one still being typed, so a draft keeps exactly what the person typed.
 */
import { useRef, type KeyboardEvent } from 'react'
import { Icon } from './controls.tsx'

const SEPARATOR = /[\s,]+/
/** The names a value holds as chips, and the one still being typed after the last separator. */
export function tagsOf(value: string): { tags: string[]; typing: string } {
  const parts = value.split(SEPARATOR)
  const typing = SEPARATOR.test(value.slice(-1)) ? '' : parts.pop() ?? ''
  return { tags: [...new Set(parts.filter(Boolean))], typing }
}
const join = (tags: string[], typing: string) => [...tags, typing].filter((part, index, all) => part || index === all.length - 1).join(' ')
  .replace(/^ /, '')

export function TagInput({ value, onChange, label, placeholder, pattern, invalidLabel, id }: {
  value: string; onChange: (next: string) => void; label: string; placeholder?: string; pattern?: RegExp; invalidLabel?: string; id?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const { tags, typing } = tagsOf(value)
  const set = (next: string[], text: string) => onChange(join(next, text))
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && typing) { event.preventDefault(); set(tags.includes(typing) ? tags : [...tags, typing], '') }
    else if (event.key === 'Backspace' && !typing && tags.length) { event.preventDefault(); set(tags.slice(0, -1), tags.at(-1)!) }
  }
  return <div className="dt-tags" onClick={() => input.current?.focus()}>
    {tags.map(tag => {
      const bad = pattern && !pattern.test(tag)
      return <span key={tag} className="dt-tag-chip" data-invalid={bad || undefined} title={bad ? invalidLabel : undefined}>
        <span className="dt-mono">{tag}</span>
        <button type="button" className="dt-tag-remove" aria-label={`${label}: ${tag} ×`} onClick={event => { event.stopPropagation()
          set(tags.filter(item => item !== tag), typing) }}><Icon name="close" size={10} /></button>
      </span>
    })}
    <input ref={input} id={id} className="dt-tags-input dt-mono" aria-label={label} spellCheck={false} value={typing}
      placeholder={tags.length ? undefined : placeholder} onKeyDown={keys}
      onChange={event => onChange(tags.length ? `${tags.join(' ')} ${event.target.value}` : event.target.value)} />
  </div>
}
