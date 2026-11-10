/**
 * GitHub outbound channel: posts issue/PR comments and review thread replies under the agent account, through the HX-Email gateway's
 * `github_user` platform when one is configured (`github-gateway.ts`), else directly with the agent's gh.
 */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError, scopedTo } from '../infra/commands.ts'
import { sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import { repositoryOf } from '../deployment.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { githubAddress, githubPage } from './github-trigger.ts'
import { GATEWAY_TEXT_LIMIT, sendGithubGateway, type GithubGateway } from './github-gateway.ts'

const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), in_reply_to_id: z.number().nullish(), user: z.looseObject({ login: z.string() }).nullish(),
})
/** True when an issue is permanently deleted (410) or locked (403); 404 is retried because it can indicate temporary permission loss on a private repo. */
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 410 || (error.code === 403 && /locked/i.test(error.message)))
const missing = (error: unknown): boolean => error instanceof CliError && (error.code === 404 || error.code === 410)
/**
 * Posts a comment or review-thread reply with an embedded HTML marker so retries do not create duplicate comments. With `gateway`, the
 * gateway posts it and its idempotency key dedupes retries; a reply over the gateway's text limit still goes out directly.
 */
export async function sendGithub(host: Pick<SourceContext, 'commands'>, message: OutboundMessage, gateway?: GithubGateway): Promise<'sent' | 'gone'> {
  // The reply goes to the repository of the GitHub instance whose Thread it answers.
  const repository = repositoryOf(host.commands.deployment, message.channel.source)
  if (repository === undefined) throw new Error(`GitHub instance ${message.channel.source} has no repository that setup verified`)
  const commands = scopedTo(host.commands, repository)
  const { github } = commands.deployment
  const number = Number(message.channel.address.number)
  if (!number) throw new Error('Missing GitHub reply target')
  try {
    // Retained trigger URLs also route replies queued before thread-aware delivery.
    const address = githubAddress(message.channel.address.url ?? '', repository)
    let rootId: number | undefined
    if (address?.pr && address.discussion && address.number === number) {
      // Fall back to a top-level PR comment if the target inline review comment was deleted.
      const source = await commands.api(CommentSchema, `pulls/comments/${address.discussion}`)
        .catch((error: unknown) => { if (missing(error)) return undefined; throw error })
      rootId = source ? source.in_reply_to_id ?? source.id : undefined
    }
    const marker = `<!-- dsh-superagent:${message.id} -->`
    const text = `${message.text}\n\n${marker}`
    if (gateway && text.length <= GATEWAY_TEXT_LIMIT) return await sendGithubGateway(gateway, repository, number, text, message.id, rootId)
    const path = rootId === undefined ? `issues/${number}/comments` : `pulls/${number}/comments`
    const mine = (comment: z.infer<typeof CommentSchema>) => sameName(comment.user?.login ?? '', github.login)
      && (rootId === undefined || comment.in_reply_to_id === rootId) && (comment.body ?? '').includes(marker)
    if ((await commands.pages(CommentSchema, path)).some(mine)) return 'sent'
    const target = rootId === undefined ? path : `${path}/${rootId}/replies`
    await commands.api(z.unknown(), target, '--method', 'POST', '-f', `body=${text}`)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}
export function githubLink(address: Record<string, string>, links: ChannelLinks): ChannelLink {
  const number = address.number ?? ''
  const review = !!links.repository && !!githubAddress(address.url ?? '', links.repository)?.discussion
  return { url: address.url ?? (links.repository ? githubPage(links.repository, Number(number)) : ''),
    label: review ? { zh: `GitHub #${number} 的 review 讨论`, en: `Review discussion on GitHub #${number}` }
      : { zh: `GitHub #${number}`, en: `GitHub #${number}` } }
}
