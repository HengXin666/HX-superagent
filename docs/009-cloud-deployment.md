# 009 Cloud deployment (bare metal, one user)

This page reproduces the first cloud deployment of 2026-11-10 (Debian 13, user `loli`) from an empty account to a running panel. dsh-superagent runs on the host as a systemd user service. The HX-Email messaging gateway runs beside it in Docker. [deploy/cloud-bootstrap.sh](../deploy/cloud-bootstrap.sh) performs every step below. Each step is idempotent, so the script is safe to rerun. For the all-in-Docker variant, see [006 Docker Compose](006-deployment.md#docker-compose-superagent-and-gateway-together).

## Run order

Run as the deployment user (here `loli`), from the checkout, in bash. `REPO` is the one repository the agent works in.

Paste the block **one line at a time**, or as a block that keeps its line breaks. Joined onto one line, the words run into the previous command: `git pull deploy/cloud-bootstrap.sh …` makes git treat the script path as a remote (`fatal: 'deploy/cloud-bootstrap.sh' does not appear to be a git repository`). Switch user with `su - loli` (or `sudo -iu loli`), not plain `su loli`, so that the login environment (HOME, PATH, the user's systemd session) is loli's own. `gh-agent` lives in `~/.local/bin`, which a fresh shell may not have on PATH, so the blocks call it by its full path. The person's sign-in (step 2) cannot be scripted, so there are always at least two runs of the script.

```sh
# 0. root, once (step 1 prints these lines if anything is missing). gh comes from cli.github.com, not the distro (§ gh 2.48+)
apt-get install -y git curl xz-utils python3 tmux docker.io docker-compose-plugin
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod 644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
chmod 644 /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y gh
gh --version
usermod -aG docker loli && loginctl enable-linger loli

# 1. machine: Node, dsh, build, profile, gh-agent wrapper, gateway, systemd service, hxrouter Source
git clone https://github.com/HengXin666/HX-superagent.git ~/ai-dev/HX-superagent && cd ~/ai-dev/HX-superagent
MODEL_FROM_PROFILE=web deploy/cloud-bootstrap.sh all     # omit MODEL_FROM_PROFILE on a machine with no other profile

# 2. person: sign in the AGENT account (never the owner), see § Agent account, steps 1 to 3
~/.local/bin/gh-agent auth login --hostname github.com --git-protocol https --web

# 3. GitHub, one command; each step stops with a reason when something is off
export SUPERAGENT_GITHUB_REPOSITORY=HengXin666/dsh-superagent-sandbox
deploy/cloud-bootstrap.sh collaborator configure github-user allow status issue
```

| Step | What it does | Stops when |
| --- | --- | --- |
| `collaborator` | owner's `gh` adds the agent with `permission=push` on `REPO` only; `gh-agent` accepts the invite | `gh-agent` is the owner's account, no invite arrives, push is not granted |
| `configure` | fills the GitHub Source (`repository`, `cli=~/.local/bin/gh-agent`) | the panel refuses the save (`agentCli*`, `repositoryReadOnly`) |
| `github-user` | creates/checks the gateway's `github_user` instance and sets hxrouter `githubInstance` to it | HX-Email or the running gateway image has no `github_user`, `gh-agent` inside the gateway cannot read the account, the gateway's check fails |
| `allow` | puts the owner (plain `gh`'s login) on the GitHub Source's list of accounts that may originate work; off that list, an Issue that mentions the agent is ignored | the policy save fails |
| `status` | gh version (warns below 2.48), unit, containers, hxrouter `githubInstance`, GitHub repository and allowed list, `dsh-superagent status` (0 ok, 2 part error, 3 waits for setup) | never; prints |
| `issue` | opens a real Issue mentioning the agent and waits up to `ISSUE_WAIT_SECONDS` (600) for its reply | never; prints the comments, or where to look |

On a machine already installed, use this order instead of step 1. `git pull` comes first and on its own line, because the script that runs next is the one it fetches. `install` then fast-forwards the HX-Email checkout, and `gateway` rebuilds the gateway image from it, adds `GH_AGENT_CONFIG_DIR` to an older `.env` and sets `APP_UID`. `gh-agent` goes last, so the run ends by printing which account the agent is signed in as.

```sh
# as root first, only if `gh --version` is below 2.48 (the script path works once the checkout is pulled)
/home/loli/ai-dev/HX-superagent/deploy/cloud-bootstrap.sh gh

# then as loli
cd ~/ai-dev/HX-superagent
git pull --ff-only
deploy/cloud-bootstrap.sh prereqs install gateway service gh-agent
~/.local/bin/gh-agent auth login --hostname github.com --git-protocol https --web    # only if the line above says "not signed in"
export SUPERAGENT_GITHUB_REPOSITORY=HengXin666/dsh-superagent-sandbox
deploy/cloud-bootstrap.sh collaborator configure github-user allow status issue
```

If `git pull --ff-only` refuses, `git status` shows local edits on the server; stash or drop them first. The agent replies only once a model key is in place (§ Model).

## What runs

| Part | How | Address (all loopback) |
| --- | --- | --- |
| dsh-superagent, profile `superagent` | `dsh-superagent.service` (systemd **user** unit, linger on) → `~/.local/bin/dsh-superagent-run` → `dsh --profile superagent` | panel `127.0.0.1:3082/orchestrator` |
| HX-Email backend (`gateway`) | `docker compose` in the checkout, `restart: unless-stopped` | `127.0.0.1:18090` |
| HX-Email web UI (`gateway-web`) | same | `127.0.0.1:18080` |
| `gateway-init` | one-shot; issues the `hxr_` router key into volume `dsh-superagent_shared` | — |

Port 8080 is avoided on purpose, because another app used it on the first server. The management API accepts only a `127.0.0.1:<port>` Host header, so the panel is reached through an SSH tunnel (§ Panel). It is never published on a public interface.

Paths the deployment owns: `~/ai-dev/{node,node_modules,HX-superagent,HX-Email}`, `~/.dsh/profiles/superagent`, `~/.dsh/state/superagent`, `~/.config/gh-agent`, `~/.local/bin/{pnpm,gh-agent,dsh-superagent-run}` and `~/.config/systemd/user/dsh-superagent.service`. It touches no other dsh profile or service. On the first server, the `web` profile and `dsh-web.service` ran untouched beside it, as did an older production HX-Email container.

## Versions

| Component | Version used | Rule |
| --- | --- | --- |
| OS | Debian 13 | Debian 12+/Ubuntu 22.04+; systemd with user instances |
| Node.js | 22.x tarball in `~/ai-dev/node` (`NODE_VERSION`) | 22.19+ or 24+ |
| pnpm | 11.7.0 for the build; corepack shim in `~/.local/bin` | `dsh plugin` calls `pnpm` from PATH, so it must be on the **user's** PATH |
| dsh | `@deepseek-ai/dsh@0.2.1-rc.2` in `~/ai-dev/node_modules` (`DSH_VERSION`) | must satisfy `engines.dsh` |
| gh | cli.github.com apt package (Debian 13's own is 2.46.0, too old) | 2.48+: `gh api --paginate --slurp` (§ gh 2.48+) |
| Docker | Engine + compose plugin | `docker compose wait` needs compose 2.23+ |

## Steps

### 1. prereqs

As root, once: the step 0 lines of § Run order (packages, the cli.github.com repository and `gh`, `usermod -aG docker <user>`, `loginctl enable-linger <user>`). The script stops and prints the package line if `git` or `docker` is missing. It then checks `gh --version` against `GH_MIN` (2.48.0). When gh is missing or older, it adds the official repository and upgrades gh itself if it runs as root or has passwordless sudo, and restarts the service if it is running. Otherwise it prints the root commands and stops. `sudo deploy/cloud-bootstrap.sh gh` (or the same path run as root) does only this part. Then, as the user, it unpacks Node into `~/ai-dev/node` and activates pnpm through corepack in `~/.local/bin`.

### 2. install

This step runs `npm install --prefix ~/ai-dev @deepseek-ai/dsh@$DSH_VERSION`. It clones this repository to `~/ai-dev/HX-superagent` and runs `pnpm install --frozen-lockfile && pnpm build`. It also clones HX-Email to `~/ai-dev/HX-Email`; the gateway image is built from that checkout. A fresh clone checks out `REPO_REF` / `HX_EMAIL_REF` (default `main`). An existing checkout keeps its branch and is only fast-forwarded, so an HX-Email updated by hand (for example to a branch with `github_user`) is built as it is.

### 3. profile

```sh
dsh superagent --from-default-profile web --dump-config > /dev/null    # only when ~/.dsh/profiles/superagent is absent
dsh plugin --profile superagent add "link:$HOME/ai-dev/HX-superagent"
```

Then it writes `~/.dsh/profiles/superagent/cordis.patch.yml` (mode 600):

```yaml
- id: webserver
  config: { host: 127.0.0.1, port: 3082 }
- id: dsh-superagent
  config: { stateDir: /home/<user>/.dsh/state/superagent }
```

With `MODEL_FROM_PROFILE=web`, it appends that profile's `llm-pi-ai` and `agent-default-model` entries. Those entries name credential refs, never keys. Never rerun the profile-creation command on an existing profile: it replaces the profile and deletes `cordis.patch.yml`.

### 4. gh-agent

This step writes `~/.local/bin/gh-agent` (`GH_CONFIG_DIR=~/.config/gh-agent exec gh "$@"`) and creates that directory with mode 700. The owner's own `~/.config/gh` stays as it is, and **nothing in this deployment uses it as the agent**.

### 5. gateway

On the first run, this step writes `.env` in the checkout (mode 600) with a random admin password and `HX_EMAIL_SECRET_KEY`. Keep the file: the secret key encrypts stored credentials. The other values are `HX_EMAIL_DIR=~/ai-dev/HX-Email`, ports 18090/18080/3082, `GH_AGENT_CONFIG_DIR=~/.config/gh-agent` and `HX_ROUTER_GITHUB_INSTANCE=0`. On every run it also sets `APP_UID` to the user's own uid (`id -u`), the uid the gateway image is built to run as, so the container can read `~/.config/gh-agent` (mode 700). The compose default stays 1000, the superagent image's `node` user, for the all-in-Docker variant. Then:

```sh
docker compose up -d --build gateway gateway-web gateway-init    # not `superagent`: it runs on the host
```

It copies the router key from the `shared` volume to `~/.dsh/state/superagent/hx_router_token` (mode 600) and checks `/healthz` and the UI.

### 6. service

`~/.local/bin/dsh-superagent-run` sets `DSH_HOME` and PATH, reads the key file into `HX_ROUTER_TOKEN` (environment only, never settings), and `exec`s `dsh --profile superagent --no-open`. The unit:

```ini
[Service]
ExecStart=%h/.local/bin/dsh-superagent-run
Restart=on-failure
RestartSec=10
TimeoutStopSec=330          # Executors get five minutes, like scripts/dsh-superagent stop
[Install]
WantedBy=default.target
```

Before enabling the unit, the script stops any tmux session left by `scripts/dsh-superagent start`, so the service is the only instance. It also removes a stale `.artifacts/control/profiles/superagent/manually-stopped` marker; otherwise `status` keeps reporting `manually_stopped: true`. Then it runs `systemctl --user enable --now dsh-superagent.service`. Boot start needs linger (step 1). Logs: `journalctl --user -u dsh-superagent`.

### 7. configure

This step runs `deploy/configure.mjs` against the management API. It fills only empty fields:

- **hxrouter**: `baseUrl` is set to `http://127.0.0.1:18090` and `tokenEnv` to `HX_ROUTER_TOKEN`, and the Source is enabled.
- **github**: with `SUPERAGENT_GITHUB_REPOSITORY` set, `repository` is filled and `cli` is set to `SUPERAGENT_GITHUB_CLI`, here `~/.local/bin/gh-agent`.

The panel refuses the GitHub save until the agent is signed in (`agentCliSignedOut`) and can push (`repositoryReadOnly`). Rerun `deploy/cloud-bootstrap.sh configure` after § Agent account.

### 8. status

This step prints the unit state, `docker compose ps` and `scripts/dsh-superagent --profile superagent status`, whose exit codes are 0 for ok, 2 for a part error and 3 for waiting on setup. It also prints the panel tunnel line.

## Agent account (least privilege)

The agent is a **separate GitHub user** (a GitHub App cannot read notifications). Its only access is write on the one repository it works in. The owner's account never signs in to `gh-agent`.

1. A person creates the account, which needs email verification.
2. Device login on the server. The code is valid for about 15 minutes, and the command keeps polling until then:

   ```sh
   nohup ~/.local/bin/gh-agent auth login --hostname github.com --git-protocol https --web > /tmp/gh-agent-login.log 2>&1 < /dev/null &
   cat /tmp/gh-agent-login.log     # "First copy your one-time code: XXXX-XXXX"
   ```

   The **agent account** enters the code at github.com/login/device. If the code expires, kill the process and run it again.
3. Check who signed in. This must not be the owner:

   ```sh
   gh-agent api user --jq .login
   ```

4. The owner, with their own gh, invites the agent with push only:

   ```sh
   gh api -X PUT repos/<owner>/<repo>/collaborators/<agent> -f permission=push
   ```

5. The agent accepts the invite:

   ```sh
   id=$(gh-agent api user/repository_invitations --jq '.[] | select(.repository.full_name=="<owner>/<repo>") | .id')
   gh-agent api -X PATCH user/repository_invitations/$id
   gh-agent api repos/<owner>/<repo> --jq .permissions.push    # true
   ```

6. Run `SUPERAGENT_GITHUB_REPOSITORY=<owner>/<repo> deploy/cloud-bootstrap.sh configure status`. Setup passes when `status` no longer lists `repositoryUnset` or `agentCli*`.

Steps 3 to 6 are what `deploy/cloud-bootstrap.sh collaborator configure` runs (§ Run order); they are written out here so each one can be checked by hand.

`gh auth login` asks GitHub for its minimum scopes (`repo`, `read:org`, `gist`). The `repo` scope is account-wide, which is why the account itself must hold access to nothing but this repository. A fine-grained PAT limited to the repository (`gh-agent auth login --with-token`) narrows this further. Check that the PAT can read notifications before relying on it.

**More repositories.** `deploy/grant-agent-repos.sh` invites the agent to the owner's recently pushed repositories (owned, not archived, not forks, pushed within `DAYS`=30, at most `MAX`=15). It is a dry run unless `GRANT=1`; with it, the script invites, accepts as `gh-agent`, and prints each repository with the agent's role. A personal account's collaborators always get write and never admin. This widens what the agent can push to. The GitHub Source still listens to one repository only, but the agent's `gh` can act on every repository it is invited to.

For the first trial, a private repository with only a README was used (`HengXin666/dsh-superagent-sandbox`). `deploy/cloud-bootstrap.sh issue` opens a real Issue there that mentions the agent; watch the panel's Tickets view while it waits.

## Gateway instances and hxrouter sessions

- **Chat sessions** (QQ and others): hxrouter `sessions` take chat addresses such as `qq:16/group/555`. The address needs an online chat instance on the gateway, for example QQ backed by NapCat, created in the UI at `127.0.0.1:18080`. Until one exists, sessions stay empty and the Source reports itself paused. This is expected. The Source refuses `github` and `github_user` addresses, because GitHub inbound belongs to the GitHub Source.
- **GitHub replies through the gateway** (`githubInstance`): an HX-Email gateway with the `github_user` platform (`server/src/hx_email/api/impl/router/github_user_routes.py`) holds an instance created only through the admin endpoint `POST /api/v1/router/github_user/save` with `{"cli", "repository"}`. The gateway runs that CLI **inside its container**, so `cli` is `/usr/local/bin/gh-agent` from `deploy/gateway.Dockerfile` (`GH_CONFIG_DIR=/gh-agent`, bind-mounted from `GH_AGENT_CONFIG_DIR`, the same dir the host's `gh-agent` uses). The save runs the gateway's own check (CLI runs, account readable, pull and push on the repository) and marks the instance online only when it passes. `deploy/cloud-bootstrap.sh github-user` does all of this with [deploy/github-user-instance.py](../deploy/github-user-instance.py), keeps the id in `~/.dsh/state/superagent/github_user_instance`, and sets `githubInstance` on the hxrouter Source. It is not an hxrouter session: GitHub comments and review replies then go out through the gateway, replies over 4,000 characters still go through `gh-agent`, and receiving stays with the GitHub Source. The instance must sign in the same agent account and serve the same repository as the GitHub Source. With an HX-Email that lacks the platform, the step stops and `githubInstance` stays 0, so everything goes out through `gh-agent`.

## Model

The profile's model entries name a credential (for example `TOKENJUICE_API_KEY` or `DEEPSEEK_API_KEY`). Put the key in `~/.dsh/.credentials.yaml` (mode 600) or in the unit's environment. Without it, the runtime starts but cannot assess or run work.

## Panel

```sh
ssh -L 3082:127.0.0.1:3082 <user>@<server>
journalctl --user -u dsh-superagent | grep -o 'http://127.0.0.1:3082/?token=[^ ]*' | tail -1
```

Open that URL locally, then choose **Superagent** (`/orchestrator`). The token is a login credential; do not share it.

### Panel inside an existing DSH web app (`web-panel`)

When the server already runs a DSH web profile behind a reverse proxy (on the first server: profile `web`, `dsh-web.service` on `127.0.0.1:38470`, started with `--public-url https://dsh.woa.qzz.io --trusted-host dsh.woa.qzz.io`, fronted by Safeline), the plugin can run in that process instead of its own. The panel then opens from the public URL with DSH's normal sign-in, and no SSH tunnel is needed.

```sh
cd ~/ai-dev/HX-superagent
git pull --ff-only
deploy/cloud-bootstrap.sh install
deploy/cloud-bootstrap.sh web-panel
deploy/cloud-bootstrap.sh status
```

`web-panel` (variables `WEB_PROFILE`, `WEB_UNIT`, `WEB_PORT`) does the following:
1. Links the plugin into the web profile (`dsh plugin --profile web add link:<checkout>`).
2. Appends `- id: dsh-superagent` with `stateDir: ~/.dsh/state/superagent` to that profile's `cordis.patch.yml`. The previous file is kept as `cordis.patch.yml.before-superagent`, and the profile's `webserver` and `connection` entries are left as they are.
3. Writes the router key to `~/.dsh/state/superagent/hx_router.env` (600) and adds the drop-in `~/.config/systemd/user/dsh-web.service.d/superagent.conf` with `EnvironmentFile=` pointing at it. The standalone run script used to export it.
4. Stops and disables `dsh-superagent.service`, because only one process may hold the stateDir's lock.
5. Records `~/.dsh/state/superagent/panel-host` (port, unit, profile) and restarts `dsh-web.service`.
6. Waits for the management API on `127.0.0.1:38470`.

From then on, `configure`, `github-user`, `allow`, `status` and `issue` talk to port 38470, and `service` is skipped. Tickets, sources and settings carry over, because the stateDir is the same. Restarting `dsh-web.service` ends the sessions open in that web app. Its unit has `TimeoutStopSec=20`, so a running executor gets 20 seconds instead of the standalone unit's 330.

**Who the management API accepts** (`managementAdmission` in `src/app/http.ts`). Every request needs `x-orchestrator-request: 1`, and an Origin header, when present, must be the request's own authority.
- A direct loopback request (Host `127.0.0.1:<port>` or `localhost:<port>`, no `Forwarded`/`X-Forwarded-*`/`X-Real-IP` header) passes with an `http://<host>` Origin or none, as before. `configure.mjs`, `status` and the SSH tunnel rely on this.
- Any other Host, and a loopback Host that carries a proxy header, goes through DSH's own Connection fence (`ctx.connection.requestRejection`). That fence accepts loopback, the bind address and the `trustedHosts` the profile's `connection` entry holds (here from `--trusted-host`), rejects `Sec-Fetch-Site: cross-site`, and requires the browser's signed DSH cookie. An unknown Host gets 403, and a missing or expired DSH sign-in gets 401. A profile without that service refuses every such request.

The loopback rule assumes the proxy passes the public Host through and adds `X-Forwarded-For`. On the first server, Safeline's site config (`resources/nginx/sites-enabled/IF_backend_<n>`) sets `proxy_set_header Host $http_host` and `X-Forwarded-For`, so the rule holds. That site's `custom_params` also appends a long-lived signed `dsh-auth-*` cookie to every request it forwards, which makes Safeline's auth center the real gate. A request that passes Safeline therefore also passes DSH's sign-in, for the panel as for the rest of DSH. A request that has not signed in to Safeline gets Safeline's challenge (HTTP 467) and never reaches DSH.

The profile has HMR on: the base bundle enables it whenever a profile context exists. `dsh plugin add` and an edit to `cordis.patch.yml` therefore apply to the running process at once. Make those two changes only after the standalone unit has stopped, or the web process opens the stateDir while it is still locked. `web-panel` does them in that order.

Verify:

```sh
# on the server, as loli
deploy/cloud-bootstrap.sh status                     # dsh-web.service active, dsh-superagent.service inactive, settings readable
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-orchestrator-request: 1' http://127.0.0.1:38470/orchestrator/api/settings        # 200: loopback still direct
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-orchestrator-request: 1' -H 'Host: dsh.woa.qzz.io' http://127.0.0.1:38470/orchestrator/api/settings   # 401: trusted authority, no DSH sign-in
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-orchestrator-request: 1' -H 'Host: evil.example' http://127.0.0.1:38470/orchestrator/api/settings     # 403: unknown authority

# from a machine not signed in to Safeline
curl -s -o /dev/null -w '%{http_code}\n' -A 'Mozilla/5.0' -H 'x-orchestrator-request: 1' https://dsh.woa.qzz.io/orchestrator/api/settings   # 467: Safeline challenge, DSH not reached
```

Then, in a browser signed in to `https://dsh.woa.qzz.io`, open the **Superagent** entry (`/orchestrator`). Pages load, and a save (for example toggling and restoring a Source switch, or pausing and resuming) succeeds instead of answering 403. In the browser's network panel, the `orchestrator/api` calls show 200.

Rollback to the standalone unit:

```sh
cp -p ~/.dsh/profiles/web/cordis.patch.yml.before-superagent ~/.dsh/profiles/web/cordis.patch.yml
(cd ~/ai-dev/HX-superagent && dsh plugin --profile web remove dsh-superagent)
rm -f ~/.config/systemd/user/dsh-web.service.d/superagent.conf ~/.dsh/state/superagent/panel-host
systemctl --user daemon-reload
systemctl --user restart dsh-web.service
deploy/cloud-bootstrap.sh service
```

## gh 2.48+

`src/infra/commands.ts` and `src/sources/github-read.ts` call `gh api … --paginate --slurp`. `--slurp` arrived in gh 2.48, and older gh rejects it as an unknown flag. Debian 13 ships gh 2.46.0. On the first server that gh made every GitHub Source poll fail, four in a row, so no Issue ever became a Trigger. After upgrading to 2.103.3 from cli.github.com and restarting the service, the next poll picked up Issue #4, and the agent replied through the gateway's `github_user` instance. GitHub's own install page also warns that the distro-packaged 2.45.x and 2.46.x are broken against current GitHub APIs.

The gateway image is not affected: `deploy/gateway.Dockerfile` already installs gh from cli.github.com. The host's gh is the one that matters, because `gh-agent` wraps it.

Verify, as the deployment user:

```sh
gh --version                           # 2.48.0 or newer
apt-cache policy gh                    # the installed version comes from https://cli.github.com/packages
~/.local/bin/gh-agent api "repos/$SUPERAGENT_GITHUB_REPOSITORY/issues?per_page=1" --paginate --slurp > /dev/null && echo slurp ok
deploy/cloud-bootstrap.sh status       # first line: gh <version>, or a warning when it is too old
journalctl --user -u dsh-superagent --since -10min | grep -i slurp   # empty once fixed
```

After upgrading gh by hand, run `systemctl --user restart dsh-superagent`.

## Pitfalls seen on the first server

- `dsh plugin add` failed until pnpm was on the user's PATH; the step 1 corepack shim fixes this.
- A login shell of zsh errors on unmatched globs (`no matches found`), so quote globs or use bash.
- If `status` says `manually_stopped: true` under systemd, a marker is left over from a tmux `stop`. Delete it, as step 6 does.
- A bind-mounted `~/.config/gh-agent` must exist before `compose up` and be owned by the gateway's uid (`APP_UID`). Otherwise Docker creates it root-owned, or the container cannot open it, and gh fails. `github-user` compares the container's `id -u` with yours and stops on a mismatch.
- The browser terminal of the server's HX-Pxy (v0.15.2) needs a login session unlocked with a TOTP code; API keys get 401 there, so remote runs need a person or plain SSH.
- The gateway accepts at most 4,000 characters per `POST /messages`, and GitHub rate shaping can queue a send for about a minute.
