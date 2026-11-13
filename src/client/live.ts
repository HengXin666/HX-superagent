/**
 * The panel's live connection: it streams the host's live feed (`GET events`, server-sent events read through `fetch`, as the
 * management API wants its request header) and tells the views subscribed to a topic when it changes, so they reload at once
 * instead of at their next poll. While it is down the views poll as before; it reconnects with a growing delay and resumes
 * after the last event it read, or tells every view to reload when the host no longer holds that event.
 */
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Activity, LiveEvent, LiveTopic } from '../app/live.ts'

export type LiveStatus = 'live' | 'connecting' | 'polling'
export type { Activity, LiveEvent, LiveTopic }
type Listener = (event: LiveEvent | { topic: 'reset'; seq: number }) => void

/** The panel's connection to the live feed, which reconnects on its own and tells subscribed views what changed. */
export class LiveClient {
  private status: LiveStatus = 'connecting'
  private readonly statusListeners = new Set<() => void>()
  private readonly listeners = new Set<{ topics: readonly string[] | '*'; listener: Listener }>()
  private last: number | undefined
  private abort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private delay = 1000
  private stopped = false
  constructor(private readonly url = '/orchestrator/api/events') {}
  getStatus = (): LiveStatus => this.status
  onStatus = (listener: () => void): (() => void) => { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener) } }
  private set(status: LiveStatus) { if (status !== this.status) { this.status = status; for (const listener of this.statusListeners) listener() } }
  /** Calls `listener` for each event of `topics` (`'*'`: every event), and for a `reset`. */
  subscribe(topics: readonly string[] | '*', listener: Listener): () => void {
    const entry = { topics, listener }
    this.listeners.add(entry)
    return () => { this.listeners.delete(entry) }
  }
  private dispatch(event: LiveEvent | { topic: 'reset'; seq: number }) {
    for (const { topics, listener } of this.listeners) {
      if (event.topic === 'reset' || topics === '*' || topics.includes(event.topic)) { try { listener(event) } catch { /* a view's own */ } }
    }
  }
  start(): void {
    this.stopped = false
    if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') { this.set('polling'); return }
    void this.connect()
  }
  stop(): void { this.stopped = true; clearTimeout(this.timer); this.abort?.abort(); this.abort = undefined }
  private retry() {
    if (this.stopped) return
    this.set('polling')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.connect() }, this.delay)
    this.delay = Math.min(this.delay * 2, 30_000)
  }
  private async connect(): Promise<void> {
    if (this.stopped) return
    const abort = this.abort = new AbortController()
    if (this.status !== 'live') this.set('connecting')
    try {
      const response = await fetch(`${this.url}${this.last === undefined ? '' : `?since=${this.last}`}`,
        { headers: { 'x-orchestrator-request': '1', accept: 'text/event-stream' }, signal: abort.signal })
      const body = response.body
      if (!response.ok || !body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        // Read the body so a test double or a proxy counts the response as consumed.
        await response.text().catch(() => '')
        this.delay = 30_000; this.retry(); return
      }
      this.set('live'); this.delay = 1000
      const reader = body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!data) continue
          try {
            const event = JSON.parse(data) as LiveEvent | { topic: 'reset'; seq: number }
            this.last = event.seq
            this.dispatch(event)
          } catch { /* a frame that is not JSON is not an event */ }
        }
      }
    } catch (failure) {
      if (abort.signal.aborted) return
      void failure
    }
    if (this.abort === abort) this.retry()
  }
}

export const LiveContext = createContext<LiveClient | null>(null)
export const useLiveClient = (): LiveClient | null => useContext(LiveContext)
/** The live connection's state, for the header's indicator. */
export function useLiveStatus(): LiveStatus {
  const client = useLiveClient()
  return useSyncExternalStore(client?.onStatus ?? noSubscribe, client?.getStatus ?? polling, client?.getStatus ?? polling)
}
const noSubscribe = () => () => {}
const polling = (): LiveStatus => 'polling'
/** Calls `onEvent` for each live event of `topics` while mounted; the latest `onEvent` is called. */
export function useLive(topics: readonly LiveTopic[] | '*', onEvent: Listener): void {
  const client = useLiveClient()
  const handler = useRef(onEvent)
  handler.current = onEvent
  const key = topics === '*' ? '*' : topics.join(',')
  useEffect(() => client?.subscribe(key === '*' ? '*' : key.split(','), event => handler.current(event)), [client, key])
}
