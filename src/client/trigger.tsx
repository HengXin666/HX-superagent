/** Trigger status view listing Threads filtered by subscription and evaluation activity. */
import { useState } from 'react'
import { THREAD_FILTERS, type ThreadFilter } from '../app/api.ts'
import { usePoll } from './api.ts'
import { usePanel } from './provider.tsx'
import { ThreadLine } from './rows.tsx'
import { Hint, ListRegion, LoadMore, LoadState, StatusHead, Empty } from './widgets.tsx'
import { Button, FilterTabs } from './ui/index.ts'

export function TriggerStatus({ filter }: { filter: ThreadFilter }) {
  const { t, call, navigate } = usePanel()
  const [limit, setLimit] = useState(20)
  const { data, error, stale } = usePoll(() => call('GET threads', { query: { filter, limit } }), [filter, limit], undefined,
    { live: ['thread', 'trigger', 'decision', 'ticket'] })
  const go = (next: ThreadFilter) => { setLimit(20); navigate({ page: 'trigger', query: next !== 'subscribed' ? { filter: next } : {} },
    true) }
  return <>
    <StatusHead hint={t('triggerIntro')} />
    <div className="dt-filters">
      <FilterTabs label={t('filtersLabel')} value={filter} onChange={go}
        items={THREAD_FILTERS.map(value => ({ value, label: t(`threadFilter.${value}`) }))} />
    </div>
    <LoadState error={error} loading={!data} have={!!data} />
    {data && <ListRegion stale={stale}>{data.items.length ? <ul className="dt-list">{data.items.map(thread => <ThreadLine key={thread.key}
      thread={thread} />)}</ul> : <Empty icon="message" action={filter !== 'all' ? <Button variant="secondary" size="sm" onClick={() => go('all')}>{t('showAll')}</Button>
      : undefined}>{t('threadsNone')}</Empty>}</ListRegion>}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 20)} />}
  </>
}
