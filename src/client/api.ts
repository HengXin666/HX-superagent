/** Same-origin client and polling hook for the orchestrator management API. */
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LiveContext, type LiveClient, type LiveEvent, type LiveTopic } from './live.ts'
import type { Api, ApiRequest, ApiResponse } from '../app/api.ts'
import { USER_ERRORS, type UserErrorCode } from '../core/errors.ts'
import type { TicketStage } from '../core/stage.ts'
import type { SetupProblem } from '../setup.ts'

/** Host rejection identified by a structured user error code and interpolation values. */
export interface UserFailure { code: UserErrorCode; values: Record<string, string> }
/**
 * Represents a failed management API request with a localized message and structured diagnostic details.
 * Thrown by API callers and inspected by UI views and draft state to distinguish validation issues, missing records,
 * and unreachable hosts (`details.unreachable` is set when `dsh-superagent` did not answer at all, such as during a restart,
 * in which case a 404 does not mean a record is missing).
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number,
    readonly details: { issues?: { path: string; message: string }[]; setup?: SetupProblem; user?: UserFailure; unreachable?: boolean } = {}) {
    super(message)
  }
  get issues() { return this.details.issues ?? [] }
  /** True when the host confirmed the record does not exist, rather than being unreachable. */
  get missing() { return this.status === 404 && !this.details.unreachable }
}
export interface ApiMessages {
  offline: string; notRunning: string; serverError: (status: number) => string; requestFailed: (status: number) => string
  setup: (problem: SetupProblem) => string
  user: (failure: UserFailure) => string
}
const isUserError = (code: unknown): code is UserErrorCode => typeof code === 'string' && Object.hasOwn(USER_ERRORS, code)

/** Calls one management endpoint; the `x-orchestrator-request` header marks the request as originating from this page. */
async function api<T>(messages: ApiMessages, path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  const json = body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  try {
    response = await fetch(`/orchestrator/api/${path}`, { method, ...json, headers: { 'x-orchestrator-request': '1', ...json.headers },
      ...signal ? { signal } : {} })
  } catch (failure) {
    if (signal?.aborted) throw failure
    throw new ApiError(messages.offline, 0, { unreachable: true })
  }
  const text = await response.text()
  let value: unknown
  try { value = text ? JSON.parse(text) : {} } catch { value = undefined }
  if (!response.ok) {
    const failure = (value ?? {}) as { error?: unknown; issues?: unknown; setup?: SetupProblem; code?: unknown
      values?: Record<string, string> }
    const issues = Array.isArray(failure.issues) ? failure.issues as { path: string; message: string }[] : []
    const user = isUserError(failure.code) ? { code: failure.code, values: failure.values ?? {} } : undefined
    // dsh-superagent always responds with a body; an empty 404 comes from the DSH web server when dsh-superagent routes are unmounted during startup or restart.
    const { status } = response
    const message = failure.setup ? messages.setup(failure.setup) : user ? messages.user(user)
      : typeof failure.error === 'string' ? failure.error : !text && status === 404 ? messages.notRunning
      : status >= 500 ? messages.serverError(status) : messages.requestFailed(status)
    throw new ApiError(message, status, { issues, ...failure.setup ? { setup: failure.setup } : {}, ...user ? { user } : {},
      ...text ? {} : { unreachable: true } })
  }
  return value as T
}

const HIDDEN_FACTOR = 6
/** How often a view polls while the live connection is up: only to stay consistent, as the feed says when to reload. */
export const LIVE_INTERVAL = 60_000
/** How long a view waits after a live event before it reloads, so a burst of writes reloads it once. */
const LIVE_SETTLE = 120
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
export interface PollOptions {
  /** The live feed's topics that change this endpoint's answer; an event of one reloads it at once. */
  live?: readonly LiveTopic[] | '*'
  /** The live connection, when the caller is above the panel's own (the panel's state poll). */
  client?: LiveClient | null
  /**
   * Which events of `live` concern this view. An event that carries no data (a Store write names only its topic) and a `reset`
   * always reload it; one with data reloads it only when this says so, so a view of one Ticket ignores every other Ticket's activity.
   */
  filter?: (event: LiveEvent) => boolean
}
/**
 * Poll an endpoint while mounted, backing off when the document is hidden. With `live` topics and the live connection up, it
 * reloads when one of them changes and polls only every `LIVE_INTERVAL`; while the connection is down it polls at `intervalMs`.
 * Preserves the last successful value across dependency changes and errors, skips state updates when the response is unchanged,
 * and drops stale responses when `deps` or `intervalMs` changes start a new subscription.
 */
export function usePoll<T>(load: () => Promise<T>, deps: readonly unknown[], intervalMs = 5000, options: PollOptions = {}) {
  const context = useContext(LiveContext)
  const client = options.client === undefined ? context : options.client
  const topics = options.live === undefined ? undefined : options.live === '*' ? '*' : options.live.join(',')
  const filter = useRef(options.filter)
  filter.current = options.filter
  const [connected, setConnected] = useState(() => !!client && !!topics && client.getStatus() === 'live')
  useEffect(() => {
    if (!client || !topics) return
    const update = () => setConnected(client.getStatus() === 'live')
    update()
    return client.onStatus(update)
  }, [client, topics])
  useEffect(() => {
    if (!client || !topics) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = client.subscribe(topics === '*' ? '*' : topics.split(','), event => {
      if (event.topic !== 'reset' && event.data !== undefined && filter.current && !filter.current(event)) return
      clearTimeout(timer); timer = setTimeout(() => { void refresh.current() }, LIVE_SETTLE)
    })
    return () => { clearTimeout(timer); off() }
  }, [client, topics])
  if (connected) intervalMs = Math.max(intervalMs, LIVE_INTERVAL)
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  // `key` names the dependencies the data was loaded for, so a view can tell its answer from the previous filter's.
  const key = JSON.stringify(deps)
  const [state, setState] = useState<{ data?: T; error?: Error; key?: string; at?: number }>({})
  const current = useRef(state)
  current.current = state
  const loader = useRef(load)
  loader.current = load
  const refresh = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Serialize requests so a manual reload after a mutation runs after the current poll finishes.
    let queue = Promise.resolve()
    const once = async () => {
      clearTimeout(timer)
      try {
        const value = await loader.current()
        // `at` is when the answer was last confirmed, so the page can say how current what it shows is.
        if (active) setState(previous => same(previous.data, value) && previous.key === key ? { data: previous.data as T, key, at: Date.now() }
          : { data: value, key, at: Date.now() })
      } catch (failure) {
        if (active) setState(previous => ({ ...previous, error: failure instanceof Error ? failure : new Error(String(failure)) }))
      } finally {
        // A hidden page off the live feed stops polling (it reloads when shown), so only the views someone looks at load the host.
        if (active && !(document.hidden && !connectedRef.current)) timer = setTimeout(run, document.hidden ? intervalMs * HIDDEN_FACTOR : intervalMs)
      }
    }
    const run = () => (queue = queue.then(once))
    const shown = () => { if (!document.hidden) void run() }
    refresh.current = run
    void run()
    document.addEventListener('visibilitychange', shown)
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', shown) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs])
  const reload = useCallback(() => refresh.current(), [])
  // Coming back on the live feed after a gap: what happened meanwhile may not be in the events it resumes with, so read once now.
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) void refresh.current()
    wasConnected.current = connected
  }, [connected])
  /**
   * Show what an action will do before the host answers: `patch` changes the data on screen at once, `action` runs, and the view
   * reloads to the host's answer. When `action` fails the data on screen goes back to what it was and the failure is rethrown, so the
   * page never shows a success that did not happen.
   */
  const mutate = useCallback(async <R,>(patch: (data: T) => T, action: () => Promise<R>): Promise<R> => {
    // React runs a state updater when it renders, which may be after `action` settles: keep what to go back to from the last render.
    const before = current.current
    if (before.data !== undefined) setState({ ...before, data: patch(before.data) })
    try {
      const result = await action()
      await refresh.current()
      return result
    } catch (failure) {
      setState(now => now.key === before.key ? before : now)
      throw failure
    }
  }, [])
  /** The data is the previous dependencies' answer, shown while the new one loads (a filter just changed). */
  const stale = state.data !== undefined && state.key !== key
  return { data: state.data, error: state.error, reload, stale, mutate, updatedAt: state.at }
}

export const DECISION_FILTERS = ['work', 'stop', 'ignore', 'unavailable', 'all'] as const
export type DecisionFilter = typeof DECISION_FILTERS[number]
export const DECISION_KINDS: Readonly<Record<DecisionFilter, string>> = { work: 'accept,reopen', stop: 'stop', ignore: 'ignore',
  unavailable: 'unavailable', all: '' }

/** A request may carry `signal`, which aborts it, as a newer request makes an older one moot. */
type Signalled<R> = R & { signal?: AbortSignal }
export type Call = <K extends keyof Api>(route: K, ...request: {} extends ApiRequest<K> ? [request?: Signalled<ApiRequest<K>>]
  : [request: Signalled<ApiRequest<K>>]) => Promise<ApiResponse<K>>
/** Build a typed route caller that resolves localized error messages on each request. */
export function caller(messages: () => ApiMessages): Call {
  return (route, ...[request]) => {
    const [method, pattern] = route.split(' ') as [string, string]
    const values = (request ?? {}) as Record<string, unknown> & { query?: Record<string, unknown>; body?: unknown; signal?: AbortSignal }
    const path = pattern.replace(/:(\w+)/g, (_match, name: string) => encodeURIComponent(String(values[name])))
    const query = Object.entries(values.query ?? {}).filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&')
    const target = query ? `${path}?${query}` : path
    // Reads of one address in flight at once (the state poll, a page and its drawer, two views on `GET sources`) share one request.
    // A read that carries its own `signal` may be aborted on its own, so it does not share.
    if (method !== 'GET' || values.signal) return api(messages(), target, method, values.body, values.signal)
    return shareRead(target, () => api(messages(), target, method))
  }
}
const inFlight = new Map<string, Promise<unknown>>()
/** The read of `target` already in flight, or a new one that later readers of `target` share until it settles. */
export function shareRead<T>(target: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(target)
  if (running) return running as Promise<T>
  const request = load().finally(() => { if (inFlight.get(target) === request) inFlight.delete(target) })
  inFlight.set(target, request)
  return request
}
/** How many reads are in flight, for tests. */
export const readsInFlight = (): number => inFlight.size

export type StateView = ApiResponse<'GET state'>
export type SetupView = StateView['setup']
export type SettingsView = ApiResponse<'GET settings'>
export type Settings = { [B in keyof SettingsView['blocks']]: SettingsView['blocks'][B]['value'] }
export type SourceView = SettingsView['sources'][number]
export type SourceStatusRow = ApiResponse<'GET sources'>[number]
export type TicketRow = ApiResponse<'GET tickets'>['items'][number]
export type TicketPageView = ApiResponse<'GET tickets/:id'>
export type ThreadRow = ApiResponse<'GET threads'>['items'][number]
export type ThreadPageView = ApiResponse<'GET threads/:key'>
export type TriggerRow = ThreadPageView['timeline'][number]
export type DecisionRow = ApiResponse<'GET decisions'>['items'][number]
export type Problem = ApiResponse<'GET overview'>['problems'][number]
export type DroppedReply = SourceStatusRow['dropped'][number]
export type SearchView = ApiResponse<'GET search'>
export type TicketSummary = SearchView['tickets'][number]
export type { TicketStage }
export type HistoryView = ApiResponse<'GET policy/history'>
export type PromptsView = ApiResponse<'GET prompts'>
export type PromptConfig = PromptsView['defaults']
export type ThreadFacts = TicketRow['threads'][number]
export type Actor = TriggerRow['actor']
