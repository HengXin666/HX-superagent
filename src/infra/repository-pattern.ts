/**
 * GitHub repository patterns such as `owner/**`, and the instances a pattern row materializes at runtime: one per repository it
 * covers, with an ID derived from the row's ID and the repository, so its state, Threads and tickets keep their keys across restarts.
 */
import { key } from '../core/ids.ts'

/** A repository pattern such as `owner/**`, `owner/*` or `owner/hx-*`: an owner and a name glob in which `*` matches any characters. */
export const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.*-]*\*[A-Za-z0-9_.*-]*$/
export const isRepositoryPattern = (text: string): boolean => REPOSITORY_PATTERN.test(text.trim())
/** The owner a pattern covers. */
export const patternOwner = (pattern: string): string => pattern.trim().split('/')[0] ?? ''
/** Whether `repository` (owner/name) matches `pattern`, case-insensitively; `**` and `*` both match any part of the name. */
export function matchesPattern(pattern: string, repository: string): boolean {
  const [owner, glob = ''] = pattern.trim().split('/')
  const [name, repo = ''] = repository.split('/')
  if (!owner || owner.toLowerCase() !== name?.toLowerCase()) return false
  const source = glob.split(/\*+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${source}$`, 'i').test(repo)
}
/** Hex digits of a pattern instance's ID that name its repository. */
const DIGITS = 10
const MEMBER_ID = new RegExp(`^(.+)-v[0-9a-f]{${DIGITS}}$`)
/**
 * The ID of the instance pattern row `row` (such as `github-4`) materializes for `repository`: `github-4-v<digits>`, within the
 * Source ID format, the same for every spelling of the repository's name.
 */
export const memberId = (row: string, repository: string): string => `${row}-v${key(row, repository.toLowerCase()).slice(0, DIGITS)}`
/** The pattern row a materialized instance ID belongs to, or undefined for any other ID. */
export const patternRowOf = (id: string): string | undefined => MEMBER_ID.exec(id)?.[1]
