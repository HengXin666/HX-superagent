#!/usr/bin/env bash
# Bare-metal cloud install of dsh-superagent plus the HX-Email gateway, as one Linux user, no root after
# the package step. Reproduces the racknerd deployment of 2026-11-10; docs/009-cloud-deployment.md explains each step.
#
#   deploy/cloud-bootstrap.sh all            # machine steps, in order: prereqs install profile gh-agent gateway service configure status
#   deploy/cloud-bootstrap.sh <step> ...     # any of those, or the GitHub steps for after the agent signs in:
#                                            #   collaborator configure github-user allow issue  (all need SUPERAGENT_GITHUB_REPOSITORY)
#   deploy/cloud-bootstrap.sh web-panel     # move the plugin into the existing DSH web profile (WEB_PROFILE, WEB_UNIT, WEB_PORT)
#   sudo deploy/cloud-bootstrap.sh gh        # root only: gh $GH_MIN+ from the cli.github.com apt repository (prereqs does it when it can)
#
# Everything lives under $AI_DEV (default ~/ai-dev), $DSH_HOME (default ~/.dsh), ~/.config/systemd/user,
# ~/.local/bin and ~/.config/gh-agent. Other dsh profiles (for example `web`) and their
# services are not touched, except by web-panel.
# shellcheck disable=SC2310  # predicates (gh_new_enough, as_root) are meant to be tested in if and ||
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
WEB_PROFILE="${WEB_PROFILE:-web}"                   # web-panel: the existing DSH web profile that takes the plugin
WEB_UNIT="${WEB_UNIT:-dsh-web.service}"             #   its systemd user unit
WEB_PORT="${WEB_PORT:-38470}"                       #   its loopback port
GH_MIN="${GH_MIN:-2.48.0}"                         # gh api --paginate --slurp

USER="${USER:-$(id -un)}"
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
CHECKOUT="$AI_DEV/HX-superagent"
HX_EMAIL_DIR="$AI_DEV/HX-Email"
STATE_DIR="$DSH_HOME/state/$PROFILE"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
GH_AGENT_DIR="$HOME/.config/gh-agent"
UNIT="dsh-$PROFILE.service"
# Which process serves the plugin: the standalone unit, or, after web-panel, the web profile it moved into (recorded here).
PANEL_HOST_FILE="$STATE_DIR/panel-host"
API_PORT="$SUPERAGENT_PORT"; RUN_UNIT="$UNIT"; RUN_PROFILE="$PROFILE"
if [ -r "$PANEL_HOST_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in port) API_PORT="$value" ;; unit) RUN_UNIT="$value" ;; profile) RUN_PROFILE="$value" ;; *) ;; esac
  done < "$PANEL_HOST_FILE"
fi
export PATH="$HOME/.local/bin:$AI_DEV/node/bin:$AI_DEV/node_modules/.bin:$PATH"

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)" >&2; exit 1; }; }

# gh 2.48+ is required: src/infra/commands.ts and src/sources/github-read.ts call `gh api --paginate --slurp`, which older gh
# rejects (unknown flag), so every GitHub Source poll fails and no Issue gets in. Debian 13 ships 2.46.0.
gh_version() { gh --version 2>/dev/null | sed -n '1s/^gh version \([0-9][0-9.]*\).*/\1/p'; }
gh_new_enough() {
  local have; have="$(gh_version)"
  [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$GH_MIN" "$have" | sort -V | head -n 1)" = "$GH_MIN" ]
}
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then sudo "$@"; else return 1; fi
}
# shellcheck disable=SC2016  # expanded by the root shell that runs them
GH_REPO_LINES='mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod 644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
chmod 644 /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y gh'

# Installs or upgrades gh from the official cli.github.com apt repository when it is missing or older than GH_MIN.
# Needs root: runs directly as root, through passwordless sudo, or else prints the root commands and stops.
step_gh() {
  say "gh: GitHub CLI $GH_MIN+ from cli.github.com"
  if gh_new_enough; then echo "gh $(gh_version) (ok, needs $GH_MIN+)"; return 0; fi
  echo "gh $(gh_version || true): missing or older than $GH_MIN"
  if as_root true; then
    as_root sh -c "umask 022; set -e; $GH_REPO_LINES"
  else
    echo "Run as root (adds the official apt repository, then upgrades gh):" >&2
    printf '%s\n' "$GH_REPO_LINES" | sed 's/^/  /' >&2
    echo "or, from the checkout:  sudo $CHECKOUT/deploy/cloud-bootstrap.sh gh" >&2
    exit 1
  fi
  gh_new_enough || { echo "gh is still $(gh_version) after the upgrade; check: apt-cache policy gh" >&2; exit 1; }
  echo "gh $(gh_version) installed"
  # A running service keeps working with the new binary, but restart it so the next poll starts clean.
  if [ "$(id -u)" != 0 ]; then
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if systemctl --user is-active --quiet "$RUN_UNIT" 2>/dev/null; then systemctl --user restart "$RUN_UNIT" && echo "restarted $RUN_UNIT"; fi
  fi
}

step_prereqs() {
  say "prereqs: system packages, gh $GH_MIN+, node $NODE_VERSION, pnpm $PNPM_VERSION"
  if ! command -v docker >/dev/null || ! command -v git >/dev/null; then
    echo "Install as root first (Debian 12/13, Ubuntu 22.04+):"
    echo "  apt-get install -y git curl xz-utils python3 tmux docker.io docker-compose-plugin"
    echo "  usermod -aG docker $USER    # then log in again"
    echo "then gh $GH_MIN+ from cli.github.com (the distro's gh may be older):  sudo $CHECKOUT/deploy/cloud-bootstrap.sh gh"
    exit 1
  fi
  step_gh
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
    echo "  ~/.local/bin/gh-agent auth login --hostname github.com --git-protocol https --web"
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
  # The gateway runs as APP_UID and must read the agent's gh dir (mode 700, owned by this user), so build it
  # with this user's uid. A changed value is picked up by the --build below.
  local uid; uid="$(id -u)"
  if grep -q '^APP_UID=' "$env"; then sed -i "s/^APP_UID=.*/APP_UID=$uid/" "$env"; else echo "APP_UID=$uid" >> "$env"; fi
  # superagent runs on the host under systemd, so only the gateway services come up here.
  # --build rebuilds the gateway image from the current HX-Email checkout (picks up github_user once it is there).
  (cd "$CHECKOUT" && docker compose build gateway gateway-web)
  # Volumes made by an image built for another uid keep that owner; hand them to APP_UID before starting.
  local project vol
  project="$(cd "$CHECKOUT" && docker compose config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')"
  for vol in "${project}_gateway-data" "${project}_shared"; do
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      docker run --rm --user 0 --entrypoint chown -v "$vol:/v" dsh-superagent/hx-email-gateway:local -R "$uid:$uid" /v
    fi
  done
  (cd "$CHECKOUT" && docker compose up -d gateway gateway-web gateway-init)
  if ! (cd "$CHECKOUT" && docker compose wait gateway-init >/dev/null); then
    echo "gateway-init failed:" >&2; (cd "$CHECKOUT" && docker compose logs --no-color --tail 20 gateway-init) >&2 || true
    exit 1
  fi
  vol="${project}_shared"
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
  if [ -r "$PANEL_HOST_FILE" ]; then
    echo "skipped: the plugin runs inside $RUN_UNIT ($PANEL_HOST_FILE); two processes on one stateDir fight over its lock"
    return 0
  fi
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
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$API_PORT" HX_ROUTER_BASE_URL="http://127.0.0.1:$HX_EMAIL_BACKEND_PORT" \
    SUPERAGENT_GITHUB_REPOSITORY="$SUPERAGENT_GITHUB_REPOSITORY" SUPERAGENT_GITHUB_CLI="$HOME/.local/bin/gh-agent" \
    node deploy/configure.mjs)
}

step_status() {
  say "status"
  if gh_new_enough; then echo "gh $(gh_version)"; else echo "gh $(gh_version): older than $GH_MIN, GitHub Source polls fail; run: deploy/cloud-bootstrap.sh gh"; fi
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  echo "$RUN_UNIT: $(systemctl --user is-active "$RUN_UNIT" || true)"
  if [ "$RUN_UNIT" != "$UNIT" ]; then echo "$UNIT: $(systemctl --user is-active "$UNIT" || true) (should be inactive)"; fi
  (cd "$CHECKOUT" && docker compose ps --format '{{.Service}} {{.State}} {{.Health}}') || true
  (cd "$CHECKOUT" && scripts/dsh-superagent --profile "$RUN_PROFILE" --url "http://127.0.0.1:$API_PORT" status) || echo "status exit $? (0 ok, 2 part error, 3 waits for setup)"
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$API_PORT" node deploy/configure.mjs --show) || true
  [ -f "$STATE_DIR/github_user_instance" ] && echo "github_user instance on file: $(cat "$STATE_DIR/github_user_instance")"
  if [ "$RUN_UNIT" != "$UNIT" ]; then
    echo "panel: the Superagent entry in $RUN_UNIT's web app (its --public-url), signed in to DSH as usual"
  else
    echo "panel: ssh -L $API_PORT:127.0.0.1:$API_PORT $USER@<server>, then the token URL from:"
    echo "  journalctl --user -u $RUN_UNIT | grep -o 'http://127.0.0.1:$API_PORT/?token=[^ ]*' | tail -1"
  fi
}

# Moves the plugin into the existing DSH web profile (WEB_PROFILE / WEB_UNIT on 127.0.0.1:WEB_PORT, fronted by a reverse
# proxy with --public-url / --trusted-host), keeping this deployment's stateDir, and stops the standalone unit. The panel
# then opens from that web app; its management API accepts the authorities DSH trusts, with DSH's own sign-in (src/app/http.ts).
step_web_panel() {
  say "web-panel: plugin into profile $WEB_PROFILE ($WEB_UNIT, 127.0.0.1:$WEB_PORT), stateDir $STATE_DIR"
  local web_dir="$DSH_HOME/profiles/$WEB_PROFILE" patch dropin="$HOME/.config/systemd/user/$WEB_UNIT.d" waited=0
  patch="$web_dir/cordis.patch.yml"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  [ -d "$web_dir" ] || { echo "no DSH profile at $web_dir" >&2; exit 1; }
  systemctl --user cat "$WEB_UNIT" > /dev/null || { echo "no systemd user unit $WEB_UNIT" >&2; exit 1; }
  [ -f "$CHECKOUT/lib/index.js" ] || { echo "the plugin is not built; run: deploy/cloud-bootstrap.sh install" >&2; exit 1; }
  if [ ! -L "$web_dir/node_modules/dsh-superagent" ]; then
    (cd "$CHECKOUT" && dsh plugin --profile "$WEB_PROFILE" add "link:$CHECKOUT")
  fi
  test -L "$web_dir/node_modules/dsh-superagent"
  if ! grep -q '^- id: dsh-superagent' "$patch" 2>/dev/null; then
    [ -f "$patch" ] && cp -p "$patch" "$patch.before-superagent"
    printf -- '- id: dsh-superagent\n  config:\n    stateDir: %s\n' "$STATE_DIR" >> "$patch"
    echo "added dsh-superagent (stateDir $STATE_DIR) to $patch; the previous file is $patch.before-superagent"
  fi
  # The standalone run script put the router key into the environment; the web unit gets it from an EnvironmentFile.
  if [ -r "$STATE_DIR/hx_router_token" ]; then
    printf 'HX_ROUTER_TOKEN=%s\n' "$(cat "$STATE_DIR/hx_router_token")" > "$STATE_DIR/hx_router.env"
    chmod 600 "$STATE_DIR/hx_router.env"
  fi
  mkdir -p "$dropin"
  printf '[Service]\nEnvironmentFile=-%s\n' "$STATE_DIR/hx_router.env" > "$dropin/superagent.conf"
  # One process per stateDir: stop and disable the standalone unit before the web profile opens it.
  if systemctl --user is-enabled --quiet "$UNIT" 2>/dev/null || systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
    systemctl --user disable --now "$UNIT"
    echo "stopped and disabled $UNIT"
  fi
  printf 'port=%s\nunit=%s\nprofile=%s\n' "$WEB_PORT" "$WEB_UNIT" "$WEB_PROFILE" > "$PANEL_HOST_FILE"
  systemctl --user daemon-reload
  systemctl --user restart "$WEB_UNIT"
  until curl -fsS -o /dev/null -H 'x-orchestrator-request: 1' "http://127.0.0.1:$WEB_PORT/orchestrator/api/settings"; do
    if [ "$waited" -ge 180 ]; then
      echo "the management API on 127.0.0.1:$WEB_PORT did not answer within 180s; last log lines:" >&2
      journalctl --user -u "$WEB_UNIT" -n 40 --no-pager >&2 || true
      exit 1
    fi
    sleep 3; waited=$((waited + 3))
  done
  echo "management API answers on 127.0.0.1:$WEB_PORT inside $WEB_UNIT"
  echo "later steps (configure, github-user, allow, status, issue) now talk to it; service is skipped"
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
  local host_uid gw_uid
  host_uid="$(id -u)"
  gw_uid="$(cd "$CHECKOUT" && docker compose exec -T gateway id -u)"
  [ "$gw_uid" = "$host_uid" ] || { echo "the gateway runs as uid $gw_uid but $GH_AGENT_DIR belongs to uid $host_uid; rerun: deploy/cloud-bootstrap.sh gateway" >&2; exit 1; }
  [ -f "$HX_EMAIL_DIR/server/src/hx_email/api/impl/router/github_user_routes.py" ] \
    || { echo "HX-Email at $HX_EMAIL_DIR has no github_user platform; update it, then rerun the gateway step" >&2; exit 1; }
  (cd "$CHECKOUT" && docker compose exec -T gateway python -c 'import hx_email.api.impl.router.github_user_routes') \
    || { echo "the running gateway image predates github_user; rerun: deploy/cloud-bootstrap.sh gateway" >&2; exit 1; }
  (cd "$CHECKOUT" && docker compose exec -T gateway "$GATEWAY_GH_CLI" api user --jq '"gh-agent inside the gateway: " + .login') \
    || { echo "gh-agent inside the gateway cannot read the account; check GH_AGENT_CONFIG_DIR in .env and that it belongs to uid APP_UID" >&2; exit 1; }
  # Admin login with the .env credentials, save + check the instance, keep its id. Nothing secret is printed.
  local id
  id="$(cd "$CHECKOUT" && python3 "$CHECKOUT/deploy/github-user-instance.py" "$SUPERAGENT_GITHUB_REPOSITORY" "$GATEWAY_GH_CLI" "$STATE_DIR/github_user_instance" "$HX_EMAIL_BACKEND_PORT")"
  echo "github_user instance: $id"
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$API_PORT" HX_ROUTER_GITHUB_INSTANCE="$id" node deploy/configure.mjs --github-instance)
}

# The owner opens the test Issue, so the owner must be on the GitHub Source's allowed list or the Issue is ignored.
step_allow() {
  say "allow: put the owner on the GitHub Source's list of accounts that may originate work"
  local owner
  owner="$(gh api user --jq .login)"
  (cd "$CHECKOUT" && SUPERAGENT_PORT="$API_PORT" node deploy/configure.mjs --allow-github "$owner")
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
  else echo "no reply from $agent within ${ISSUE_WAIT_SECONDS}s: check the panel's Tickets and journalctl --user -u $RUN_UNIT (a missing model key is the usual cause)"; fi
}

[ $# -gt 0 ] || { sed -n '2,13p' "$0"; exit 1; }
for step in "$@"; do
  case "$step" in
    all) step_prereqs; step_install; step_profile; step_gh_agent; step_gateway; step_service; step_configure; step_status ;;
    prereqs|install|profile|gateway|service|configure|status) "step_$step" ;;
    gh-agent) step_gh_agent ;;
    gh) step_gh ;;
    collaborator) step_collaborator ;;
    github-user) step_github_user ;;
    allow) step_allow ;;
    web-panel) step_web_panel ;;
    issue) step_issue ;;
    *) echo "unknown step: $step" >&2; exit 1 ;;
  esac
done
