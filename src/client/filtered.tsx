/**
 * What the Sources kept out in the last day, as a table to sort and filter by reason (SRC-4, OV-1): the messages the Sources filtered
 * before any Eval, and the replies that were dropped instead of sent. Each row says who, what, why and when; a dropped reply opens
 * its Ticket or Thread.
 */
import { useState } from 'react'
import { usePoll, type DroppedReply, type SourceStatusRow } from './api.ts'
import { usePanel } from './provider.tsx'
import type { Route } from './route.ts'
import { actorName, localized, readableMarkers, reasonLabel, valueLabel, when } from './text.ts'
import { DataTable, Drawer, Tabs, type Column } from './ui/index.ts'
import { LoadState } from './widgets.tsx'

type Filtered = SourceStatusRow['filtered'][number] & { source: string }
type Dropped = DroppedReply & { source: string }

export function FilteredTable({ rows, sources = false }: { rows: Filtered[]; sources?: boolean }) {
  const { t } = usePanel()
  const columns: Column<Filtered>[] = [
    ...sources ? [{ key: 'source', header: t('term.source'), sortable: true } as Column<Filtered>] : [],
    { key: 'actor', header: t('filteredSender'), sortable: true, value: row => actorName(t, row.actor) },
    { key: 'preview', header: t('filteredMessage'), value: row => readableMarkers(t, row.preview) || t('empty') },
    { key: 'reason', header: t('filteredReason'), sortable: true, value: row => reasonLabel(t, row.reason) },
    { key: 'at', header: t('filteredAt'), sortable: true, align: 'end', value: row => row.at, render: row => when(row.at, t('lang')) },
  ]
  return <DataTable dense label={t('sourceFilteredTitle')} rows={rows} rowKey={row => row.id} columns={columns}
    defaultSort={{ key: 'at', dir: 'desc' }} height={360} rowHeight={36}
    filter={{ label: t('filteredSearch'), placeholder: t('filteredSearch') }} empty={t('none')} />
}

export function DroppedTable({ rows, sources = false }: { rows: Dropped[]; sources?: boolean }) {
  const { t, navigate } = usePanel()
  // A message opens its Ticket, or its Thread for messages queued before receipts recorded the Ticket.
  const target = (item: DroppedReply): Route | undefined => item.ticket ? { page: 'execution', id: item.ticket.id }
    : item.thread ? { page: 'trigger', id: item.thread } : undefined
  const columns: Column<Dropped>[] = [
    ...sources ? [{ key: 'source', header: t('term.source'), sortable: true } as Column<Dropped>] : [],
    { key: 'preview', header: t('filteredMessage'), value: row => readableMarkers(t, row.preview) || t('empty') },
    { key: 'where', header: t('droppedWhere'), value: row => row.ticket?.title ?? (row.thread ? t('term.thread') : ''), render: row => {
      const route = target(row)
      return route ? <button type="button" className="dt-textlink" onClick={event => { event.stopPropagation(); navigate(route) }}>
        {row.ticket?.title ?? t('term.thread')}</button> : null
    } },
    { key: 'reason', header: t('filteredReason'), sortable: true, value: row => reasonLabel(t, row.dropped.reason) },
    { key: 'at', header: t('filteredAt'), sortable: true, align: 'end', value: row => row.dropped.at, render: row => when(row.dropped.at, t('lang')) },
  ]
  return <DataTable dense label={t('sourceDroppedTitle')} rows={rows} rowKey={row => row.id} columns={columns}
    defaultSort={{ key: 'at', dir: 'desc' }} height={360} rowHeight={36} empty={t('none')}
    onRowClick={row => { const route = target(row); if (route) navigate(route) }} />
}

/** The overview's counts open what they count, in a drawer over the overview: filtered messages, or dropped replies. */
export function KeptOutDrawer({ open, kind, onClose }: { open: boolean; kind: 'filtered' | 'dropped'; onClose: () => void }) {
  const { t, call } = usePanel()
  const [shown, setShown] = useState(kind)
  const { data, error } = usePoll(() => open ? call('GET sources') : Promise.resolve(undefined), [open], undefined,
    { live: ['trigger', 'outbox', 'settings', 'health'] })
  if (!open) return null
  const title = (source: SourceStatusRow) => localized(t, source.title) || valueLabel(t, 'source', source.id)
  const filtered = (data ?? []).flatMap(source => source.filtered.map(item => ({ ...item, source: title(source) })))
  const dropped = (data ?? []).flatMap(source => source.dropped.map(item => ({ ...item, source: title(source) })))
  return <Drawer open onClose={onClose} width="lg" closeLabel={t('close')} title={t('keptOutTitle')}>
    <Tabs size="sm" idBase="dt-kept-out" label={t('keptOutTitle')} value={shown} onChange={setShown}
      items={[{ value: 'filtered' as const, label: `${t('sourceFilteredTitle')} · ${filtered.length}` },
        { value: 'dropped' as const, label: `${t('sourceDroppedTitle')} · ${dropped.length}` }]} />
    {!data ? <LoadState error={error} loading /> : shown === 'filtered' ? <FilteredTable rows={filtered} sources />
      : <DroppedTable rows={dropped} sources />}
  </Drawer>
}
