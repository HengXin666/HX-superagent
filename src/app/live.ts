/**
 * The panel's live feed: what changed in the Store, by topic, and what the agents are doing, as numbered events the panel
 * streams (`GET events`) and the monitoring console reads (`GET console/snapshot`). It keeps the last `CAPACITY` events, so a
 * panel that reconnects resumes after the last one it read, or reloads when that one is gone.
 */

/** A Store topic a write touches, a settings or prompts save, an agent's activity, or the host's health. */
export type LiveTopic = 'trigger' | 'thread' | 'ticket' | 'decision' | 'outbox' | 'settings' | 'prompts' | 'activity' | 'health'
export interface Activity {
  sessionId: string; role: 'orchestrator' | 'worker' | 'subagent'; ticketId?: string
  /** `tool`: a tool call the model made; `turn`: a turn started or ended; `message`: the model answered in text. */
  kind: 'tool' | 'turn' | 'message'
  tool?: string; summary: string; at: string; state?: 'running' | 'idle'
}
export interface LiveEvent { seq: number; at: string; topic: LiveTopic; data?: Activity | Record<string, unknown> }

const CAPACITY = 1000
/** Text that looks like a secret: a token, key or password value, a bearer credential, or a long opaque string. */
const SECRET = /((?:token|secret|password|passwd|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|token)\s+)?[^\s"',}]+|\bBearer\s+[\w.~+/=-]+|\b(?:gh[pousr]_|sk-|xox[abp]-)[\w-]{8,}|\b[A-Za-z0-9+/_-]{40,}\b/gi
/** One line of at most `max` characters with what looks like a secret replaced by `***`. */
export function summarize(text: string, max = 120): string {
  const line = text.replace(SECRET, (match, lead: string | undefined) => lead ? `${lead}***` : '***').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
/** A tool call's arguments as one summary line: its command, path, query or URL when it has one, else its JSON. */
export function toolSummary(name: string, input: string): string {
  let value: unknown
  try { value = JSON.parse(input) } catch { return summarize(input) }
  const args = (value ?? {}) as Record<string, unknown>
  const lead = ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'name', 'kind', 'description'].find(key => typeof args[key] === 'string')
  return summarize(lead ? String(args[lead]) : JSON.stringify(args))
}

/**
 * Numbers and keeps the live feed's events, calls the panel connections subscribed, and keeps each Session's latest activity
 * and per-minute counts for the console.
 */
export class LiveHub {
  private seq = 0
  private readonly events: LiveEvent[] = []
  private readonly listeners = new Set<(event: LiveEvent) => void>()
  /** The latest activity of each Session, which the console shows as what it does now. */
  private readonly current = new Map<string, Activity>()
  /** Events a minute bucket counted, for the console's rates: the last 60 minutes by topic. */
  private readonly buckets = new Map<number, Partial<Record<LiveTopic, number>>>()
  constructor(private readonly now: () => number = Date.now) {}
  emit(topic: LiveTopic, data?: LiveEvent['data']): LiveEvent {
    const at = this.now()
    const event: LiveEvent = { seq: ++this.seq, at: new Date(at).toISOString(), topic, ...data === undefined ? {} : { data } }
    this.events.push(event)
    if (this.events.length > CAPACITY) this.events.splice(0, this.events.length - CAPACITY)
    const minute = Math.floor(at / 60_000), bucket = this.buckets.get(minute) ?? {}
    bucket[topic] = (bucket[topic] ?? 0) + 1; this.buckets.set(minute, bucket)
    for (const key of this.buckets.keys()) if (key <= minute - 60) this.buckets.delete(key)
    for (const listener of this.listeners) { try { listener(event) } catch { /* a listener's failure is its own */ } }
    return event
  }
  activity(activity: Activity): void {
    this.current.set(activity.sessionId, activity)
    this.emit('activity', activity)
  }
  /** The latest activity of each Session that has one. */
  sessions(): Activity[] { return [...this.current.values()] }
  forget(sessionId: string): void { this.current.delete(sessionId) }
  last(): number { return this.seq }
  /** The events after `seq`, or `undefined` when some of them are gone and the reader must reload instead. */
  since(seq: number): LiveEvent[] | undefined {
    if (seq >= this.seq) return []
    const first = this.events[0]?.seq ?? this.seq + 1
    if (seq < first - 1) return undefined
    return this.events.filter(event => event.seq > seq)
  }
  recent(limit = 200): LiveEvent[] { return this.events.slice(-limit) }
  /** Counts by topic for each of the last `minutes` minutes, oldest first. */
  rates(minutes = 60): { minute: string; counts: Partial<Record<LiveTopic, number>> }[] {
    const end = Math.floor(this.now() / 60_000)
    return Array.from({ length: minutes }, (_, index) => {
      const minute = end - minutes + 1 + index
      return { minute: new Date(minute * 60_000).toISOString(), counts: this.buckets.get(minute) ?? {} }
    })
  }
  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
