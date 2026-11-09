#!/usr/bin/env bash
# Give the agent account push access to the owner's recently pushed repositories, accept the invites as the agent,
# and print each repository with the permission the agent ends up holding.
#
#   deploy/grant-agent-repos.sh                 # dry run: list what would be granted
#   GRANT=1 deploy/grant-agent-repos.sh         # invite, accept, report
#
# Run where both CLIs are signed in: `gh` as the owner, `gh-agent` as the agent (the VPS after § Agent account).
# Picks repositories the owner owns, not archived, not forks, pushed within DAYS (30), newest first, at most MAX (15).
# On a personal account GitHub grants collaborators write (push) and never admin; the permission field is org-only.
set -euo pipefail

DAYS="${DAYS:-30}"
MAX="${MAX:-15}"
GRANT="${GRANT:-0}"
GH_AGENT="${GH_AGENT:-$HOME/.local/bin/gh-agent}"

owner="$(gh api user --jq .login)"
agent="${AGENT:-$("$GH_AGENT" api user --jq .login)}"
if [ "$owner" = "$agent" ]; then
  echo "gh and gh-agent are both signed in as $owner; the agent must be its own account" >&2
  exit 1
fi
since="$(date -u -d "-$DAYS days" +%Y-%m-%dT%H:%M:%SZ)"

repos=()
while IFS= read -r repo; do
  [ -n "$repo" ] && repos+=("$repo")
done < <(gh api --paginate "user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100" \
  --jq ".[] | select(.archived | not) | select(.fork | not) | select(.pushed_at >= \"$since\") | \"\(.full_name) \(.pushed_at)\"" \
  | head -n "$MAX" | cut -d' ' -f1)

if [ "${#repos[@]}" -eq 0 ]; then
  echo "no repository of $owner pushed since $since"
  exit 0
fi
echo "owner $owner, agent $agent, pushed since $since: ${#repos[@]} repositories"

if [ "$GRANT" != 1 ]; then
  printf '  %s\n' "${repos[@]}"
  echo "dry run; GRANT=1 $0 invites $agent to these"
  exit 0
fi

for repo in "${repos[@]}"; do
  if ! gh api -X PUT "repos/$repo/collaborators/$agent" --silent; then
    echo "invite failed: $repo" >&2
  fi
done

# Accept every pending invite from the owner, as the agent.
invites="$("$GH_AGENT" api user/repository_invitations --jq ".[] | select(.inviter.login == \"$owner\") | .id" || true)"
for id in $invites; do
  "$GH_AGENT" api -X PATCH "user/repository_invitations/$id" --silent || echo "accept failed: invitation $id" >&2
done

printf '%-50s %s\n' REPOSITORY PERMISSION
for repo in "${repos[@]}"; do
  role="$(gh api "repos/$repo/collaborators/$agent/permission" --jq '.role_name' 2>/dev/null || echo "none")"
  printf '%-50s %s\n' "$repo" "$role"
done
