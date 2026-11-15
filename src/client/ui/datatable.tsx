/**
 * Tabular data with sortable headers (aria-sort), a text filter across columns, keyboard row navigation
 * (↑/↓/Home/End, Enter opens) and windowed rendering for long lists (fixed `rowHeight`, spacer rows keep the scrollbar honest).
 */
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Skeleton } from './basic.tsx'
import { Input } from './field.tsx'
import { Icon } from './icon.tsx'
import { cx } from './util.ts'

export interface Column<R> {
  key: string; header: ReactNode; width?: number | string; align?: 'start' | 'end' | 'center'
  /** Plain value used for sorting and filtering; defaults to `row[key]`. */
  value?: (row: R) => string | number | undefined | null
  render?: (row: R) => ReactNode
  sortable?: boolean
  /** Excludes the column from the text filter. */
  unfiltered?: boolean
}
export type SortState = { key: string; dir: 'asc' | 'desc' } | undefined

const valueOf = <R,>(column: Column<R>, row: R) => column.value ? column.value(row) : (row as Record<string, unknown>)[column.key] as string | number | undefined
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function compareValues(a: unknown, b: unknown) {
  if (a === b) return 0
  if (a === undefined || a === null || a === '') return 1
  if (b === undefined || b === null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}
/** Filters and sorts rows the way the table shows them; exported for views that need the same order (e.g. drawer prev/next). */
export function viewRows<R>(rows: readonly R[], columns: Column<R>[], query: string, sort: SortState): R[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  let out = terms.length ? rows.filter(row => {
    const hay = columns.filter(column => !column.unfiltered).map(column => String(valueOf(column, row) ?? '')).join(' ').toLowerCase()
    return terms.every(term => hay.includes(term))
  }) : [...rows]
  const column = sort && columns.find(item => item.key === sort.key)
  if (column && sort) {
    const sign = sort.dir === 'asc' ? 1 : -1
    out = out.map((row, index) => ({ row, index })).sort((a, b) => {
      const va = valueOf(column, a.row), vb = valueOf(column, b.row)
      // Empty values stay last whatever the direction; ties keep the incoming order.
      const empty = (v: unknown) => v === undefined || v === null || v === ''
      if (empty(va) !== empty(vb)) return empty(va) ? 1 : -1
      return sign * compareValues(va, vb) || a.index - b.index
    }).map(item => item.row)
  }
  return out
}

export function DataTable<R>({ rows, columns, rowKey, label, onRowClick, selectedKey, filter, sort: controlledSort, onSortChange,
  defaultSort, empty, loading, toolbar, height, rowHeight = 40, overscan = 8, virtualizeAt = 80, dense }: {
  rows: readonly R[]; columns: Column<R>[]; rowKey: (row: R) => string; label: string
  onRowClick?: (row: R) => void; selectedKey?: string
  filter?: { placeholder: string; label: string; value?: string; onChange?: (query: string) => void }
  sort?: SortState; onSortChange?: (sort: SortState) => void; defaultSort?: SortState
  empty?: ReactNode; loading?: boolean; toolbar?: ReactNode
  /** Max height of the scroll area in px; required for virtualization. */
  height?: number; rowHeight?: number; overscan?: number; virtualizeAt?: number; dense?: boolean
}) {
  const [ownSort, setOwnSort] = useState<SortState>(defaultSort)
  const sort = controlledSort !== undefined || onSortChange ? controlledSort : ownSort
  const [ownQuery, setOwnQuery] = useState('')
  const query = filter?.value ?? ownQuery
  const shown = useMemo(() => viewRows(rows, columns, query, sort), [rows, columns, query, sort])
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [cursor, setCursor] = useState(0)
  const virtual = height !== undefined && shown.length > virtualizeAt
  const first = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0
  const last = virtual ? Math.min(shown.length, Math.ceil((scrollTop + height) / rowHeight) + overscan) : shown.length
  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, shown.length - 1))
    setCursor(clamped)
    const element = scroller.current
    if (virtual && element) {
      const top = clamped * rowHeight
      if (top < element.scrollTop) element.scrollTop = top
      else if (top + rowHeight > element.scrollTop + height!) element.scrollTop = top + rowHeight - height!
      setScrollTop(element.scrollTop)
    }
    const find = () => scroller.current?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)
    const row = find()
    // A windowed row may not be rendered until the scroll update commits.
    if (row) row.focus(); else requestAnimationFrame(() => find()?.focus())
  }
  const toggleSort = (key: string) => {
    const next: SortState = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : undefined
    if (onSortChange) onSortChange(next); else setOwnSort(next)
  }
  const onRowKey = (event: KeyboardEvent, index: number, row: R) => {
    const step = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: shown.length - 1, PageDown: index + 10, PageUp: index - 10 }[event.key]
    if (step !== undefined) { event.preventDefault(); focusRow(step) }
    else if ((event.key === 'Enter' || event.key === ' ') && onRowClick) { event.preventDefault(); onRowClick(row) }
  }
  const tabRow = Math.min(cursor, Math.max(0, shown.length - 1))
  return <div className="hx-table-wrap" data-dense={dense || undefined}>
    {(filter || toolbar) && <div className="hx-table-toolbar">
      {filter && <Input size="sm" start={<Icon name="search" size={14} />} type="search" aria-label={filter.label} placeholder={filter.placeholder}
        value={query} wrapperClassName="hx-table-filter"
        onChange={event => { filter.onChange ? filter.onChange(event.target.value) : setOwnQuery(event.target.value); setCursor(0) }} />}
      {toolbar}
    </div>}
    <div ref={scroller} className="hx-table-scroll" style={height !== undefined ? { maxHeight: height } : undefined}
      onScroll={virtual ? event => setScrollTop(event.currentTarget.scrollTop) : undefined}>
      <table className="hx-table" aria-label={label} aria-rowcount={shown.length + 1} aria-busy={loading || undefined}>
        <colgroup>{columns.map(column => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
        <thead><tr aria-rowindex={1}>{columns.map(column => {
          const active = sort?.key === column.key
          return <th key={column.key} scope="col" data-align={column.align}
            aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : column.sortable ? 'none' : undefined}>
            {column.sortable ? <button type="button" className="hx-th-sort" onClick={() => toggleSort(column.key)}>
              {column.header}<Icon name={active ? (sort!.dir === 'asc' ? 'sort-asc' : 'sort-desc') : 'sort'} size={12}
                className={cx('hx-th-icon', active && 'hx-th-icon-on')} /></button> : column.header}
          </th>
        })}</tr></thead>
        <tbody>
          {loading && rows.length === 0 ? Array.from({ length: 4 }, (_, index) => <tr key={`s${index}`} className="hx-tr-skeleton">
            {columns.map(column => <td key={column.key}><Skeleton width="70%" /></td>)}</tr>)
            : shown.length === 0 ? <tr><td colSpan={columns.length} className="hx-td-empty">{empty}</td></tr>
            : <>
              {virtual && first > 0 && <tr aria-hidden="true" style={{ height: first * rowHeight }} />}
              {shown.slice(first, last).map((row, offset) => {
                const index = first + offset, key = rowKey(row)
                return <tr key={key} data-row={index} aria-rowindex={index + 2} tabIndex={index === tabRow ? 0 : -1}
                  className="hx-tr" data-clickable={onRowClick ? true : undefined} aria-selected={selectedKey !== undefined ? key === selectedKey : undefined}
                  style={virtual ? { height: rowHeight } : undefined} onFocus={() => setCursor(index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={event => onRowKey(event, index, row)}>
                  {columns.map(column => <td key={column.key} data-align={column.align}>
                    {column.render ? column.render(row) : String(valueOf(column, row) ?? '')}</td>)}
                </tr>
              })}
              {virtual && last < shown.length && <tr aria-hidden="true" style={{ height: (shown.length - last) * rowHeight }} />}
            </>}
        </tbody>
      </table>
    </div>
  </div>
}
