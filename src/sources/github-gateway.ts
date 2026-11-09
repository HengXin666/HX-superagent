/**
 * GitHub replies through the HX-Email gateway's `github_user` platform: the gateway posts the comment with its own gh CLI account,
 * keeps its outbox, rate shaping and audit, and dedupes by idempotency key. Inbound GitHub events stay with the GitHub Source, so a
 * Thread keeps one Ticket; the hxrouter Source refuses `github` and `github_user` sessions for the same reason.
 */
import { key } from '../core/index.ts'
import { RouterError, routerClient, type RouterConnection, type RouterFetch } from './hxrouter-api.ts'

/** Where GitHub replies go when the gateway carries them: the gateway connection and its `github_user` instance for the repository. */
export interface GithubGateway { connection: RouterConnection; instance: number; fetch?: RouterFetch }
/** The gateway's cross-platform text limit for `POST /messages`; longer replies go out directly through the agent's gh. */
export const GATEWAY_TEXT_LIMIT = 4000
/** How long the gateway may hold the request for GitHub's answer, its maximum. */
const WAIT_SECONDS = 5
/** Re-keys a terminally failed delivery at most this many times; each failed one posted nothing, so a new key cannot duplicate. */
const MAX_REKEYS = 20
/** Delivery states in which the gateway holds the message and will finish it (or, for `unknown`, never resend it). */
const ACCEPTED = new Set(['sent', 'queued', 'sending', 'held', 'unknown'])
const QUEUED_ERRORS = new Set(['rate_limited', 'outbound_held', 'delivery_unknown'])

/** The gateway session of Issue or PR `number`: `github_user:<instance>:issue:<owner>/<name>#<number>`. */
export const githubSink = (instance: number, repository: string, number: number): string => `github_user:${instance}:issue:${repository}#${number}`
/** The idempotency key of attempt `round` of a message; round 0 is the message's own key. */
export const githubKey = (id: string, round: number): string => key('hxrouter-github', round ? `${id}#${round}` : id)
/**
 * A terminal failure that means the Issue or PR can never take the comment: deleted (410) or locked. A 404 is retried under a new key,
 * as the direct path retries it, because a private repository answers 404 while the account has lost access for a while.
 */
export const gatewayGone = (lastError: string): boolean => (/^permission_denied:/.test(lastError) && /locked/i.test(lastError))
  || /HTTP 410\b/.test(lastError)

/**
 * Posts `text` on Issue or PR `number`, or as a reply in review thread `rootId`, through the gateway.
 * A terminally failed delivery is retried under the next key, since it posted nothing; one that can never land returns `'gone'`.
 * @throws RouterError when the gateway is unreachable or rejects the message; the Outbox retries later.
 */
export async function sendGithubGateway(gateway: GithubGateway, repository: string, number: number, text: string, messageId: string,
  rootId?: number): Promise<'sent' | 'gone'> {
  const client = routerClient(gateway.connection, gateway.fetch)
  const body = { sink: githubSink(gateway.instance, repository, number), text, reply_to: rootId === undefined ? '' : `rc:${rootId}` }
  for (let round = 0; round <= MAX_REKEYS; round++) {
    let delivery
    try {
      delivery = await client.send({ ...body, idempotency_key: githubKey(messageId, round) }, undefined, WAIT_SECONDS)
    } catch (error) {
      if (error instanceof RouterError && QUEUED_ERRORS.has(error.code)) return 'sent'
      if (error instanceof RouterError && error.code === 'session_not_found') return 'gone'
      throw error
    }
    if (ACCEPTED.has(delivery.status)) return 'sent'
    if (gatewayGone(delivery.last_error)) return 'gone'
    // A fresh failure is this attempt's answer; a deduplicated one is an earlier attempt's, so the next key tries again.
    if (!delivery.deduplicated) {
      throw new RouterError(`HX-Email GitHub delivery ${delivery.delivery_id} ${delivery.status}: ${delivery.last_error}`, 200, delivery.status, true)
    }
  }
  throw new RouterError(`HX-Email GitHub delivery failed ${MAX_REKEYS + 1} times`, 200, 'failed', true)
}
