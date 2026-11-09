#!/usr/bin/env bash
# Bare-metal cloud install of dsh-superagent plus the HX-Email gateway, as one Linux user, no root after
# the package step. Reproduces the racknerd deployment of 2026-11-10; docs/009-cloud-deployment.md explains each step.
#
#   deploy/cloud-bootstrap.sh all            # machine steps, in order: prereqs install profile gh-agent gateway service configure status
#   deploy/cloud-bootstrap.sh <step> ...     # any of those, or the GitHub steps for after the agent signs in:
#                                            #   collaborator github-user issue  (all need SUPERAGENT_GITHUB_REPOSITORY)
#
# Everything lives under $AI_DEV (default ~/ai-dev), $DSH_HOME (default ~/.dsh), ~/.config/systemd/user,
# ~/.local/bin and ~/.config/gh-agent. Other dsh profiles (for example `web`) and their services are not touched.
set -euo pipefail
umask 077

AI_DEV="${AI_DEV:-$HOME/ai-dev}"
NODE_VERSION="${NODE_VERSION:-22.19.0}"            # >= 22.19 or 24+
PNPM_VERSION="${PNPM_VERSION:-11.7.0}"
DSH_VERSION="${DSH_VERSION:-0.2.1-rc.2}"            # must satisfy engines.dsh in package.json
REPO_URL="${REPO_URL:-https://github.com/HengXin666/HX-superagent.git}"
REPO_REF="${REPO_REF:-main}"
HX_EMAIL_URL="${HX_EMAIL_URL:-https://github.com/HengXin666/HX-Email.git}"
HX_EMAIL_REF="${HX_EMAIL_REF:-main}"
PROFILE="${PROFILE:-superagent}"
TEMPLATE_PROFILE="${TEMPLATE_PROFILE:-web}"         # dsh template the profile is made from
MODEL_FROM_PROFILE="${MODEL_FROM_PROFILE:-}"        # optional: copy llm-pi-ai + agent-default-model entries from this profile
SUPERAGENT_PORT="${SUPERAGENT_PORT:-3082}"
HX_EMAIL_BACKEND_PORT="${HX_EMAIL_BACKEND_PORT:-18090}"
HX_EMAIL_HTTP_PORT="${HX_EMAIL_HTTP_PORT:-18080}"
SUPERAGENT_GITHUB_REPOSITORY="${SUPERAGENT_GITHUB_REPOSITORY:-}"   # owner/name the agent account can push to
GATEWAY_GH_CLI="${GATEWAY_GH_CLI:-/usr/local/bin/gh-agent}"         # gh wrapper inside the gateway image (deploy/gateway.Dockerfile)
ISSUE_WAIT_SECONDS="${ISSUE_WAIT_SECONDS:-600}"

USER="${USER:-$(id -un)}"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
CHECKOUT="$AI_DEV/HX-superagent"
HX_EMAIL_DIR="$AI_DEV/HX-Email"
STATE_DIR="$DSH_HOME/state/$PROFILE"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
GH_AGENT_DIR="$HOME/.config/gh-agent"
UNIT="dsh-$PROFILE.service"
export PATH="$HOME/.local/bin:$AI_DEV/node/bin:$AI_DEV/node_modules/.bin:$PATH"

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)" >&2; exit 1; }; }

step_prereqs() {
  say "prereqs: system packages, node $NODE_VERSION, pnpm $PNPM_VERSION"
  if ! command -v gh >/dev/null || ! command -v docker >/dev/null || ! command -v git >/dev/null; then
    echo "Install as root first (Debian 12/13, Ubuntu 22.04+):"
    echo "  apt-get install -y git curl xz-utils python3 tmux gh docker.io docker-compose-plugin"
    echo "  usermod -aG docker $USER    # then log in again"
    echo "gh must be 2.48+; if the distro's is older, use the cli.github.com apt repository."
    exit 1
  fi
  mkdir -p "$AI_DEV" "$HOME/.local/bin"
  if [ ! -x "$AI_DEV/node/bin/node" ]; then
    local arch; arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) ;; esac
    local tar="node-v$NODE_VERSION-linux-$arch.tar.xz"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$tar" -o "/tmp/$tar"
    mkdir -p "$AI_DEV/node"
    tar -xJf "/tmp/$tar" -C "$AI_DEV/node" --strip-components=1
    rm -f "/tmp/$tar"
  fi
  node -v
  # dsh plugin shells out to pnpm, so pnpm must be on PATH for this user, not only inside the checkout.
  corepack enable --install-directory "$HOME/.local/bin" pnpm
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare "pnpm@$PNPM_VERSION" --activate
  pnpm -v
}

step_install() {
  say "install: dsh $DSH_VERSION, checkouts, build"
  need node "run the prereqs step"
  if [ "$(dsh --version 2>/dev/null || true)" != "$DSH_VERSION" ]; then
    npm install --prefix "$AI_DEV" "@deepseek-ai/dsh@$DSH_VERSION"
  fi
  dsh --version
  # A fresh clone checks out REPO_REF / HX_EMAIL_REF. An existing checkout keeps its branch (it may carry
  # work such as an updated HX-Email): it is only fast-forwarded, and a failed pull is reported, not hidden.
  if [ ! -d "$CHECKOUT/.git" ]; then
    git clone -q "$REPO_URL" "$CHECKOUT"
    git -C "$CHECKOUT" checkout -q "$REPO_REF"
  elif ! git -C "$CHECKOUT" pull -q --ff-only; then
    echo "warning: could not fast-forward $CHECKOUT; building what is checked out" >&2
  fi
  (cd "$CHECKOUT" && pnpm install --frozen-lockfile && pnpm build)
  if [ ! -d "$HX_EMAIL_DIR/.git" ]; then
    git clone -q "$HX_EMAIL_URL" "$HX_EMAIL_DIR"
    git -C "$HX_EMAIL_DIR" checkout -q "$HX_EMAIL_REF"
  fi
  local sa_head hx_head
  sa_head="$(git -C "$CHECKOUT" rev-parse --abbrev-ref HEAD)@$(git -C "$CHECKOUT" rev-parse --short HEAD)"
  hx_head="$(git -C "$HX_EMAIL_DIR" rev-parse --abbrev-ref HEAD)@$(git -C "$HX_EMAIL_DIR" rev-parse --short HEAD)"
  echo "superagent $sa_head, HX-Email $hx_head"
}

step_profile() {
  say "profile: $PROFILE from template $TEMPLATE_PROFILE, plugin link, machine config"
  if [ ! -d "$PROFILE_DIR" ]; then
    # Only on a new install: rerunning this replaces the profile and deletes its cordis.patch.yml.
    dsh "$PROFILE" --from-default-profile "$TEMPLATE_PROFILE" --dump-config > /dev/null
  fi
  mkdir -p "$STATE_DIR"
  if [ ! -L "$PROFILE_DIR/node_modules/dsh-superagent" ]; then
    (cd "$CHECKOUT" && dsh plugin --profile "$PROFILE" add "link:$CHECKOUT")
  fi
  test -L "$PROFILE_DIR/node_modules/dsh-superagent"
  local patch="$PROFILE_DIR/cordis.patch.yml"
  if ! grep -q "id: dsh-superagent" "$patch" 2>/dev/null; then
    cat > "$patch" <<EOF
- id: webserver
  config:
    host: 127.0.0.1
    port: $SUPERAGENT_PORT
- id: dsh-superagent
  config:
    stateDir: $STATE_DIR
EOF
    if [ -n "$MODEL_FROM_PROFILE" ]; then
      # Copies only the model entries (they name credential refs, never the keys themselves).
      python3 - "$DSH_HOME/profiles/$MODEL_FROM_PROFILE/cordis.patch.yml" "$patch" <<'PY'
import sys, re
src = open(sys.argv[1]).read()
blocks = re.split(r'(?m)^(?=- id: )', src)
keep = [b for b in blocks if re.match(r'- id: (llm-pi-ai|agent-default-model)\b', b)]
open(sys.argv[2], 'a').write(''.join(b if b.endswith('\n') else b + '\n' for b in keep))
print('copied', len(keep), 'model entries')
PY
    fi
    chmod 600 "$patch"
  fi
  echo "profile ready: $PROFILE_DIR"
}

step_gh_agent() {
  say "gh-agent: wrapper for the agent's own gh config"
  mkdir -p "$GH_AGENT_DIR"
  chmod 700 "$GH_AGENT_DIR"
  cat > "$HOME/.local/bin/gh-agent" <<EOF
#!/bin/sh
GH_CONFIG_DIR="$GH_AGENT_DIR" exec gh "\$@"
EOF
  chmod 755 "$HOME/.local/bin/gh-agent"
  if gh-agent api user --jq .login >/dev/null 2>&1; then
    echo "agent signed in as: $(gh-agent api user --jq .login)"
  else
    echo "agent not signed in. Run, then have the AGENT account (never the owner) enter the code at github.com/login/device:"
    echo "  gh-agent auth login --hostname github.com --git-protocol https --web"
    echo "Then: SUPERAGENT_GITHUB_REPOSITORY=<owner>/<repo> deploy/cloud-bootstrap.sh collaborator configure github-user status issue"
  fi
}

step_gateway() {
  say "gateway: HX-Email backend, web UI and router key via docker compose"
  need docker "run the prereqs step"
  local env="$CHECKOUT/.env"
  if [ ! -f "$env" ]; then
    local pw key
    pw="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
    key="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
    cat > "$env" <<EOF
HX_EMAIL_DIR=$HX_EMAIL_DIR
HX_EMAIL_ADMIN_USERNAME=admin
HX_EMAIL_ADMIN_PASSWORD=$pw
HX_EMAIL_SECRET_KEY=$key
HX_EMAIL_BACKEND_PORT=$HX_EMAIL_BACKEND_PORT
HX_EMAIL_HTTP_PORT=$HX_EMAIL_HTTP_PORT
SUPERAGENT_PORT=$SUPERAGENT_PORT
GH_AGENT_CONFIG_DIR=$GH_AGENT_DIR
HX_ROUTER_GITHUB_INSTANCE=0
EOF
    chmod 600 "$env"
    echo "wrote $env (admin password and secret key are random; keep the file)"
  fi
  # An .env from an earlier install may predate the github_user mount; point it at the agent's gh dir.
  grep -q '^GH_AGENT_CONFIG_DIR=' "$env" || echo "GH_AGENT_CONFIG_DIR=$GH_AGENT_DIR" >> "$env"
  # superagent runs on the host under systemd, so only the gateway services come up here.
  # --build rebuilds the gateway image from the current HX-Email checkout (picks up github_user once it is there).
  (cd "$CHECKOUT" && docker compose up -d --build gateway gateway-web gateway-init)
  if ! (cd "$CHECKOUT" && docker compose wait gateway-init >/dev/null); then
    echo "gateway-init failed:" >&2; (cd "$CHECKOUT" && docker compose logs --no-color --tail 20 gateway-init) >&2 || true
    exit 1
  fi
  local vol; vol="$(cd "$CHECKOUT" && docker compose config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')_shared"
  mkdir -p "$STATE_DIR"
  local tmp="$STATE_DIR/hx_router_token.new"
  if ! docker run --rm --entrypoint cat -v "$vol:/shared:ro" dsh-superagent/hx-email-gateway:local /shared/hx_router_token > "$tmp" || [ ! -s "$tmp" ]; then
    rm -f "$tmp"; echo "no router key in volume $vol" >&2; exit 1
  fi
  mv "$tmp" "$STATE_DIR/hx_router_token"
  chmod 600 "$STATE_DIR/hx_router_token"
  curl -fsS "http://127.0.0.1:$HX_EMAIL_BACKEND_PORT/healthz" >/dev/null || { echo "gateway not healthy on 127.0.0.1:$HX_EMAIL_BACKEND_PORT" >&2; exit 1; }
  echo "gateway healthy on 127.0.0.1:$HX_EMAIL_BACKEND_PORT"
  curl -fsS -o /dev/null "http://127.0.0.1:$HX_EMAIL_HTTP_PORT/" || { echo "gateway UI not answering on 127.0.0.1:$HX_EMAIL_HTTP_PORT" >&2; exit 1; }
  echo "gateway UI on 127.0.0.1:$HX_EMAIL_HTTP_PORT"
}

step_service() {
  say "service: systemd user unit $UNIT, started at boot (linger)"
  # Replaces the tmux session from scripts/dsh-superagent; stop that first if it runs.
  if tmux has-session -t "dsh-$PROFILE" 2>/dev/null; then (cd "$CHECKOUT" && scripts/dsh-superagent --profile "$PROFILE" stop) || true; fi
  cat > "$HOME/.local/bin/dsh-$PROFILE-run" <<EOF
#!/bin/sh
# Router key goes into the environment only, never into settings.
export DSH_HOME="$DSH_HOME"
export PATH="$HOME/.local/bin:$AI_DEV/node/bin:$AI_DEV/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"
[ -r "$STATE_DIR/hx_router_token" ] && HX_ROUTER_TOKEN="\$(cat "$STATE_DIR/hx_router_token")" && export HX_ROUTER_TOKEN
cd "$CHECKOUT"
exec dsh --profile "$PROFILE" --no-open
EOF
  chmod 755 "$HOME/.local/bin/dsh-$PROFILE-run"
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/$UNIT" <<EOF
[Unit]
Description=dsh-superagent ($PROFILE profile)
After=network-online.target

[Service]
ExecStart=$HOME/.local/bin/dsh-$PROFILE-run
Restart=on-failure
RestartSec=10
# Executors get up to five minutes to finish, like scripts/dsh-superagent stop.
TimeoutStopSec=330

[Install]
WantedBy=default.target
EOF
  rm -f "$CHECKOUT/.artifacts/control/profiles/$PROFILE/manually-stopped"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  loginctl show-user "$USER" -p Linger | grep -q yes || { echo "enable boot start as root:  loginctl enable-linger $USER"; }
  systemctl --user is-active "$UNIT"
}

step_configure() {
  say "configure: hxrouter Source (and GitHub Source when SUPERAGENT_GITHUB_REPOSITORY is set)"
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$SUPERAGENT_PORT" HX_ROUTER_BASE_URL="http://127.0.0.1:$HX_EMAIL_BACKEND_PORT" \
    SUPERAGENT_GITHUB_REPOSITORY="$SUPERAGENT_GITHUB_REPOSITORY" SUPERAGENT_GITHUB_CLI="$HOME/.local/bin/gh-agent" \
    node deploy/configure.mjs)
}

step_status() {
  say "status"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  systemctl --user is-active "$UNIT" || true
  (cd "$CHECKOUT" && docker compose ps --format '{{.Service}} {{.State}} {{.Health}}') || true
  (cd "$CHECKOUT" && scripts/dsh-superagent --profile "$PROFILE" --url "http://127.0.0.1:$SUPERAGENT_PORT" status) || echo "status exit $? (0 ok, 2 part error, 3 waits for setup)"
  echo "panel: ssh -L $SUPERAGENT_PORT:127.0.0.1:$SUPERAGENT_PORT $USER@<server>, then the token URL from:"
  echo "  journalctl --user -u $UNIT | grep -o 'http://127.0.0.1:$SUPERAGENT_PORT/?token=[^ ]*' | tail -1"
}

need_repo() { [ -n "$SUPERAGENT_GITHUB_REPOSITORY" ] || { echo "set SUPERAGENT_GITHUB_REPOSITORY=owner/name" >&2; exit 1; }; }

# Login of the agent (gh-agent). Refuses to go on when it is the owner's account (plain gh).
agent_login() {
  local agent owner
  agent="$(gh-agent api user --jq .login 2>/dev/null)" || { echo "gh-agent is not signed in; run the gh-agent step and sign in the AGENT account" >&2; exit 1; }
  owner="$(gh api user --jq .login 2>/dev/null || true)"
  if [ -n "$owner" ] && [ "$agent" = "$owner" ]; then
    echo "gh-agent is signed in as the owner ($owner); refusing. Run gh-agent auth logout, then sign in the agent account" >&2; exit 1
  fi
  printf '%s' "$agent"
}

step_collaborator() {
  say "collaborator: agent gets push on $SUPERAGENT_GITHUB_REPOSITORY only, and accepts the invite"
  need_repo
  local repo="$SUPERAGENT_GITHUB_REPOSITORY" agent inv="" perm
  agent="$(agent_login)"
  echo "agent: $agent, owner: $(gh api user --jq .login)"
  if [ "$(gh-agent api "repos/$repo" --jq .permissions.push 2>/dev/null || true)" != "true" ]; then
    # Owner side, with the owner's own gh. permission=push is GitHub's "Write" role, nothing more.
    gh api -X PUT "repos/$repo/collaborators/$agent" -f permission=push --silent
    for _ in 1 2 3 4 5; do
      inv="$(gh-agent api user/repository_invitations --jq ".[] | select(.repository.full_name==\"$repo\") | .id" 2>/dev/null || true)"
      inv="${inv%%$'\n'*}"
      [ -n "$inv" ] && break; sleep 3
    done
    [ -n "$inv" ] || { echo "the agent sees no invitation for $repo" >&2; exit 1; }
    gh-agent api -X PATCH "user/repository_invitations/$inv" --silent
  fi
  perm="$(gh-agent api "repos/$repo" --jq '.permissions | "pull=\(.pull) push=\(.push) admin=\(.admin)"')"
  echo "$agent on $repo: $perm"
  case "$perm" in *push=true*) ;; *) echo "push did not take effect" >&2; exit 1 ;; esac
}

step_github_user() {
  say "github-user: gateway github_user instance for $SUPERAGENT_GITHUB_REPOSITORY, wired as hxrouter githubInstance"
  need_repo
  agent_login > /dev/null
  [ "$(id -u)" = 1000 ] || echo "warning: uid $(id -u) is not 1000; the gateway container (uid 1000) may not read $GH_AGENT_DIR" >&2
  [ -f "$HX_EMAIL_DIR/server/src/hx_email/api/impl/router/github_user_routes.py" ] \
    || { echo "HX-Email at $HX_EMAIL_DIR has no github_user platform; update it, then rerun the gateway step" >&2; exit 1; }
  (cd "$CHECKOUT" && docker compose exec -T gateway python -c 'import hx_email.api.impl.router.github_user_routes') \
    || { echo "the running gateway image predates github_user; rerun: deploy/cloud-bootstrap.sh gateway" >&2; exit 1; }
  (cd "$CHECKOUT" && docker compose exec -T gateway "$GATEWAY_GH_CLI" api user --jq '"gh-agent inside the gateway: " + .login') \
    || { echo "gh-agent inside the gateway cannot read the account; check GH_AGENT_CONFIG_DIR in .env and its owner (uid 1000)" >&2; exit 1; }
  # Admin login with the .env credentials, save + check the instance, keep its id. Nothing secret is printed.
  local id
  id="$(cd "$CHECKOUT" && python3 "$CHECKOUT/deploy/github-user-instance.py" "$SUPERAGENT_GITHUB_REPOSITORY" "$GATEWAY_GH_CLI" "$STATE_DIR/github_user_instance" "$HX_EMAIL_BACKEND_PORT")"
  echo "github_user instance: $id"
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$SUPERAGENT_PORT" HX_ROUTER_GITHUB_INSTANCE="$id" node deploy/configure.mjs --github-instance)
}

step_issue() {
  say "issue: a real Issue on $SUPERAGENT_GITHUB_REPOSITORY that mentions the agent, then wait for its reply"
  need_repo
  local repo="$SUPERAGENT_GITHUB_REPOSITORY" agent url num count=0 waited=0
  agent="$(agent_login)"
  url="$(gh issue create -R "$repo" -t "deployment check $(date '+%F %T')" \
    -b "@$agent end-to-end check of the cloud deployment: please reply on this Issue with one sentence confirming you received it.")"
  num="${url##*/}"
  case "$num" in ''|*[!0-9]*) echo "gh issue create returned no issue URL: $url" >&2; exit 1 ;; *) ;; esac
  echo "opened $url"
  while [ "$waited" -lt "$ISSUE_WAIT_SECONDS" ]; do
    count="$(gh api "repos/$repo/issues/$num/comments" --jq "[.[] | select(.user.login==\"$agent\")] | length" 2>/dev/null || true)"
    count="${count:-0}"
    [ "$count" -gt 0 ] && break
    sleep 20; waited=$((waited + 20))
  done
  gh api "repos/$repo/issues/$num/comments" --jq '.[] | "[\(.user.login)] \(.body[0:300])"'
  if [ "$count" -gt 0 ]; then echo "agent replied on #$num"
  else echo "no reply from $agent within ${ISSUE_WAIT_SECONDS}s: check the panel's Tickets and journalctl --user -u $UNIT (a missing model key is the usual cause)"; fi
}

[ $# -gt 0 ] || { sed -n '2,11p' "$0"; exit 1; }
for step in "$@"; do
  case "$step" in
    all) step_prereqs; step_install; step_profile; step_gh_agent; step_gateway; step_service; step_configure; step_status ;;
    prereqs|install|profile|gateway|service|configure|status) "step_$step" ;;
    gh-agent) step_gh_agent ;;
    collaborator) step_collaborator ;;
    github-user) step_github_user ;;
    issue) step_issue ;;
    *) echo "unknown step: $step" >&2; exit 1 ;;
  esac
done
