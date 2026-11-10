# 006 Deployment

Use this guide to install, configure and operate dsh-superagent. It covers accounts, startup checks, a Docker Compose deployment together with the HX-Email gateway, upgrades and troubleshooting, building on [001 Domain model](001-domain.md) through [005 Panel](005-panel.md).

## What runs

- **A dedicated DeepSeek Harness profile**, called `superagent` in this guide. Create it from the Web profile template. It loads the bundle and serves its panel on `127.0.0.1`. Keep it separate from the profile you work in: the plugin changes process-wide `PATH` and git settings, and its process needs independent restarts and upgrades.
- **An agent GitHub account.** The agent comments, pushes branches and opens pull requests as this account, through a GitHub CLI signed in only as that account.
- **Optional:** a Feishu bot for chat requests.
- **Optional:** an HX-Email messaging router key for QQ and other chat platforms.

Plugin configuration holds the state directory and machine limits. Use the panel for everything else: Sources for the repository and accounts, Policy for allowed lists, and Execution for worker directories and commands.

### Permissions and isolation

The bundle defines `dsh-superagent-worker` for Executors and `dsh-superagent-router` for the main Session. They appear in the DeepSeek Harness preset list but are intended only for dsh-superagent. Do not select them for personal Sessions or disable their configuration rows. The application needs them to create and resume its Sessions.

Opening a blank managed Session in the Web UI can select the profile's default preset. dsh-superagent restores its role-specific preset before the first turn.

Both presets run with `danger-full-access` as the operator's OS user and read messages from subscribed Threads. Account wrappers choose the agent's credentials by default; they do not isolate the process. A worker can execute programs by path and read the operator's home directory. For isolation, use a dedicated OS account containing only the agent's credentials.

## Prerequisites

- Node.js 22.19+ or 24+, pnpm, git 2.32+, Python 3.8+ and tmux
- GitHub CLI (`gh`) 2.48 or later. Source CLI fields must point to `gh` or `lark-cli` wrappers; the host relies on their subcommands and output formats.
- A repository on github.com; GitHub Enterprise Server is not supported. To create a checkout per Ticket, keep a local clone from which the prepare command can add worktrees. Install `git-lfs` if that repository uses Git LFS.
- A model provider configured for DeepSeek Harness. dsh-superagent uses the profile's default model unless the Eval or Execution settings name another.
- For Feishu: `lark-cli` (tested with 1.0.90) and a Feishu or Lark app with a bot

## Accounts

### Agent GitHub account

1. Create a GitHub user account for the agent and give it write access to the repository. A GitHub App cannot be the agent, because dsh-superagent reads the account's notifications.
2. Give it a GitHub CLI that uses only its own credentials:

   ```sh
   mkdir -p ~/.local/bin
   cat > ~/.local/bin/gh-agent <<'EOF'
   #!/bin/sh
   GH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"
   EOF
   chmod +x ~/.local/bin/gh-agent
   gh-agent auth login
   gh-agent api user --jq .login
   ```

   Sign in as the agent account; the last command prints its login. dsh-superagent reads the login the same way.

### Feishu bot (optional)

1. Create a self-built app with the bot capability. Grant it the permissions to receive message events, read and send chat messages, and read chat members, then publish the app version.
2. Give the bot its own `lark-cli` configuration, restricted to the bot identity, and a wrapper:

   ```sh
   LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent" lark-cli config init --app-id <cli_…> --app-secret-stdin
   LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent" lark-cli config strict-mode bot --global
   cat > ~/.local/bin/lark-bot <<'EOF'
   #!/bin/sh
   export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent"
   exec lark-cli "$@"
   EOF
   chmod +x ~/.local/bin/lark-bot
   ```

   The first command reads the app secret from standard input. Use a separate configuration directory: `lark-cli` allows one profile per app id, and your personal configuration may already contain a user login for that app.

   The host refuses a CLI that can act as a user. It reads the app id, Feishu/Lark brand and bot `open_id` from the bot configuration.

   Both configurations share the keychain entry for the app secret. To remove only the bot configuration, delete its directory; do not run `lark-cli config remove`, which would affect the shared secret.

### HX-Email message router (optional)

The `hxrouter` Source receives chat messages (QQ, QQ channels and the other chat platforms the gateway carries) through the HX-Email messaging router (`/api/v1/router`), reads their context and replies through it. GitHub stays with the GitHub Source and Feishu with the Feishu Source; this Source does not touch either.

1. In HX-Email, set `router_enabled=true` and connect the chat instance, for example a QQ instance backed by NapCat, until it is online.
2. Issue a router key on HX-Email's subscriptions page, or with `POST /api/v1/router/api-keys` `{"name": "dsh-superagent"}` from a console session. The `hxr_…` key is shown once.
3. Put the key in the dsh-superagent process environment, for example `HX_ROUTER_TOKEN=hxr_…` in the service unit or the shell that starts it. Settings hold only the variable's name (`tokenEnv`), never the key. While the variable is missing, the Source reports itself paused.
4. Revoke a key with `DELETE /api/v1/router/api-keys/<id>` from a console session. Revocation takes effect at once; the next request answers 401.

The plugin entry `dsh-superagent-hxrouter` is enabled by default. Without a gateway address or sessions it stays idle and reports itself paused.

Configuration, in **Settings → Sources → HX-Email messaging gateway** or the `source:hxrouter` block:

| Key | Meaning |
| --- | --- |
| `baseUrl` | The HX-Email address, such as `http://127.0.0.1:8000`; `/api/v1/router` is added |
| `tokenEnv` | The environment variable holding the key, `HX_ROUTER_TOKEN` by default |
| `sessions` | `[{"address": "qq:16/group/555", "listen": "mentions"}]`. An address is a gateway v2 address or a prefix of whole segments, such as `qq:16/private` for every direct chat of that account. `mentions` takes only mentions, replies to the bot and direct messages as requests; `all` lets Eval infer work from the rest |
| `accounts` | `[{"instance": "qq:16", "account": "3000"}]`: the bot's own account on each gateway instance. Only needed with an HX-Email gateway older than 2026-11-09, below |
| `githubInstance` | The gateway's `github_user` instance that posts the GitHub Source's replies, below; `0` (the default) keeps them on the agent's own gh |
| `pollSeconds`, `readPageSize` | Long-poll wait and messages per context page |

In the Policy's HX-Email part, write senders as `platform:id`: `allowed` lists who may ask for work (`qq:10001`), `bots` lists bot accounts. The gateway cannot tell bots from people, so `bots` is the only signal: messages from a listed sender become inferred candidates at most and never make an explicit request.

How the Source handles the gateway:

- **GitHub inbound stays out.** A session address on the gateway's `github` or `github_user` platforms is refused: issues, pull requests, CI and the binding of PRs to Tickets stay with the GitHub Source, and a second Source on the same thread would open a second Ticket for it. GitHub replies can still go out through the gateway, below.
- **Subscription.** One subscription per configured session, created with `from: now` and pull delivery, so messages from before the subscription are not replayed. Each batch is acknowledged after it is taken in; a message for a session the Source no longer receives is acknowledged and dropped.
- **Mentions on QQ.** Since 2026-11-09 the HX-Email QQ provider reports `mentions` and `flags` itself: an `at` segment naming the logged-in account (`self_id`) sets `mention_self`, and a reply to a message the account sent sets `reply_to_self`. The Source believes an explicit `true` or `false` from the gateway. Older gateways report both as `null`; then the Source treats `@<account>` in the text as a mention of the bot, taking the account from `accounts` and falling back to the gateway's `account_id`, and looks back through the session's last 100 messages for an outbound message with the replied-to ID. Rows stored before the gateway upgrade stay `null` and take the same fallback.
- **Sending.** Every reply carries an idempotency key derived from the outgoing message, so a retried send is deduplicated by the gateway. A group reply carries `reply_to`. A delivery the gateway reports as `unknown`, such as a NapCat request that timed out, counts as sent and is never retried, since the message may already be in the chat. The gateway queues a send to a group that no longer exists (202) and fails it later, so the Source does not learn of that failure at send time.
- **To verify with a real NapCat.** Integration ran against the live HX-Email gateway with a simulated NapCat. The gateway flattens an `at` segment to `@<QQ number>` in the text and computes `mention_self` from the event's `self_id`, so the remaining check is that a real NapCat puts `self_id` and `at` segments where OneBot 11 says; send one mention and one reply after deployment and look for `mention_self` and `reply_to_self` set to `true` in `GET /api/v1/router/messages`.

#### GitHub replies through the gateway

With `githubInstance` set, the GitHub Source's comments and review replies (acknowledgements, results, questions and notices) are posted by the gateway's `github_user` instance instead of the agent's own gh. The gateway keeps them in its outbox, shapes their rate, records each delivery and dedupes by idempotency key. Receiving GitHub does not change: notifications, comments, CI and PR binding still come from the GitHub Source, so a Thread keeps one Ticket.

1. In HX-Email, connect a GitHub account on the Messaging page's **GitHub account (gh CLI)** card, or with `POST /api/v1/router/github_user/save` `{"cli": "<absolute path of the gh wrapper>", "repository": "<owner/name>"}` from an admin console session. Use the same wrapper, or one signed in to the same account, as the GitHub Source's `cli`, and the same repository. The check must answer `report.ok: true` with the agent's login; the instance is then `online`.
2. Set `githubInstance` to that instance's `id` in **Settings → Sources → HX-Email messaging gateway**, with `baseUrl` and the key set as above, and keep the Source enabled. Turning the Source off, or setting `0`, sends replies directly again.

What to expect:

- **Same account, or the agent answers itself.** The GitHub Source recognises the agent's own comments by its login. A gateway instance signed in to another account makes the agent's replies look like someone else's comments.
- **Notifications.** The gateway instance also polls the account's notifications and marks them read. The GitHub Source reads notifications with `all=true` and a time cursor, so it still receives them.
- **Waiting for GitHub.** Each send waits up to 5 seconds for GitHub's answer. A send that waits for the gateway's GitHub rate shaping counts as sent; the gateway posts it when it is due.
- **Failures.** A deleted Issue (410) or a locked one settles the reply as gone. Any other failure, including a 404 from lost access to a private repository, is retried by the Outbox. Each retry uses the next idempotency key, since a failed delivery posted nothing.
- **Long replies.** The gateway takes at most 4,000 characters per message. A longer reply goes out through the agent's own gh, as before.
- **Not through the gateway.** Workers still run gh themselves for branches, pull requests and reviews. The gateway carries only the replies the Outbox sends.
- **Verified.** On 2026-11-10 the GitHub Source's channel ran against the live local gateway with a `github_user` instance whose gh was a script answering like GitHub. Covered: a comment on an Issue or PR, a reply in an inline review thread, a retry that posted nothing new, deleted and locked Issues settling as gone, a 404 retried under the next key once rate shaping released it, and a long reply going out directly. The first real post goes to github.com after deployment; the gateway's own `github_user` writes were run against GitHub in docs/providers/github-user.md of HX-Email.

## Install

Run this block once, on a machine that has no `superagent` profile yet:

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone <this repository> dsh-superagent && cd dsh-superagent
pnpm install && pnpm build
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
```

The pinned version above is public; other versions must satisfy `engines.dsh` in `package.json`.

The fourth command creates `~/.dsh/profiles/superagent` from the DeepSeek Harness Web template. The fifth installs this bundle. Set `DSH_HOME` to relocate the default `~/.dsh` directory.

Run the profile-creation command only for a new installation. If the profile already exists, that command replaces it and deletes its `cordis.patch.yml`, including machine configuration. Do not use it for upgrades.

## Machine configuration

Copy [examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) to `~/.dsh/profiles/superagent/cordis.patch.yml`, replacing that file, and replace every `<placeholder>`. For Feishu, also enable the `dsh-superagent-feishu` entry there. The `webserver` entry sets the panel's port.

| Key | Required | Meaning |
| --- | --- | --- |
| `stateDir` | yes | Absolute path: the database, the lock, the command shims in `worker-bin`, the agent's git configuration and, by default, the Ticket directories in `work`. Back it up before upgrades |
| `promptMaxChars`, `admissionContextMaxPages`, `admissionContextTimeoutMs` | no | The largest saved prompt configuration, and how many Thread pages one assessment reads within what time |

After the first start, edit machine limits in **Settings → Deployment** or the DeepSeek Harness Plugin Manager. Changes apply without restart. `stateDir` cannot be changed there. Invalid values or unknown configuration keys prevent startup; the log identifies the key.

## Docker Compose (superagent and gateway together)

`docker-compose.yml` at the repository root starts dsh-superagent and the HX-Email messaging gateway with one command, with the gateway address and router key already wired between them. Linux with Docker Compose 2.17 or later; every service uses host networking, because the management API accepts only a `127.0.0.1` Web server and Host header, and the gateway binds its backend to loopback.

```sh
cp deploy/compose.env.example .env   # set HX_EMAIL_DIR, DEEPSEEK_API_KEY, the gateway admin password and HX_EMAIL_SECRET_KEY
mkdir -p deploy/gh-agent deploy/dsh-seed
GH_CONFIG_DIR=$PWD/deploy/gh-agent gh auth login   # as the agent GitHub account
docker compose up -d --build
docker compose logs gateway-init superagent
```

The first `docker compose up` must carry `--build`, and so must every `up` after a change to this checkout, to `HX_EMAIL_DIR` or to `DSH_VERSION`. All three images are local tags (`:local`) built from these sources; without `--build`, Compose starts whatever image already has that tag, which may come from an earlier checkout.

| Service | What it does |
| --- | --- |
| `gateway` | HX-Email backend built from `$HX_EMAIL_DIR/server` (plus `gh` and `/usr/local/bin/gh-agent`), on `127.0.0.1:${HX_EMAIL_BACKEND_PORT:-18090}`. Runs as uid 1000 (build arg `APP_UID`), the same uid as the superagent container's `node` user, so gh never leaves root-owned files in the shared gh directory. Self-update is off |
| `gateway-web` | HX-Email web UI on `http://127.0.0.1:${HX_EMAIL_HTTP_PORT:-18080}`, where QQ and `github_user` instances are created |
| `gateway-init` | One-shot. Logs in as the gateway admin, issues an `hxr_` key named `dsh-superagent` and writes it, mode 0600, to the `shared` volume. On later starts it keeps the key while the gateway accepts it and issues a new one otherwise |
| `superagent` | The image builds the `superagent` profile and runs `dsh plugin --profile superagent add link:/app` (pnpm links this checkout into the profile); the `dsh-home` volume is filled from it on first use. The first start writes the profile's `cordis.patch.yml` (port, `stateDir`), reads the key into `HX_ROUTER_TOKEN` and runs `dsh --profile superagent --no-open`. Panel: `http://127.0.0.1:${SUPERAGENT_PORT:-3082}/orchestrator` |

On first start `deploy/configure.mjs` fills, through the management API, only settings that are still empty: the hxrouter Source's `baseUrl` (the gateway), `tokenEnv` and `enabled`, plus `githubInstance` when `HX_ROUTER_GITHUB_INSTANCE` is set, and the GitHub Source's `repository` and `cli` (`/usr/local/bin/gh-agent`) when `SUPERAGENT_GITHUB_REPOSITORY` is set. Changes made later in the panel are never overwritten. Sessions, Policy and the rest stay in the panel.

A fresh deployment starts with nothing to do, and this is expected:

- The runtime reports `paused` (setup pending) until the GitHub Source has a `repository`. Setup stops at the deployment check, which needs the repository to check that the agent account can push to it. Set `SUPERAGENT_GITHUB_REPOSITORY` in `.env` before the first start, or fill the repository on the GitHub Source in the panel; saving runs the check and restarts dsh-superagent. While paused, Sources still record incoming triggers, but nothing is evaluated, dispatched or delivered.
- The hxrouter Source has an empty `sessions` list and reports `paused` (No sessions are listed), so no gateway subscription runs. `configure.mjs` never fills sessions. Create the QQ (or other) instance in the gateway UI, then add each session address to the hxrouter Source in the panel; the Source picks up the change without a restart.

For GitHub replies through the gateway, create a `github_user` instance in the gateway UI with CLI `/usr/local/bin/gh-agent`; both containers mount the same `GH_AGENT_CONFIG_DIR`, so it is the same account as the GitHub Source. Then set its id as `githubInstance`.

The model: the web template's DeepSeek provider (`llm-deepseek`) reads the credential reference `DEEPSEEK_API_KEY`, from `$DSH_HOME/.credentials.yaml` first and the process environment after it. Set `DEEPSEEK_API_KEY` in `.env`, or put a `.credentials.yaml` (and optionally `.env`) in `DSH_SEED_DIR`, copied once. Do not seed `settings.yaml`: dsh treats it as a removed legacy document and imports every section into the profile that boots. Other providers are added in the panel's model settings, which write the profile in the volume.

The superagent image installs DeepSeek Harness `0.2.1-rc.2` (`DSH_VERSION` build arg), the version the bundle was checked against on the development machine; that release pins its `@deepseek-ai/*` dependencies exactly. Move it together with the host installation. Create `GH_AGENT_CONFIG_DIR` before the first `up`, owned by uid 1000; a missing bind source is created by Docker as root.

State lives in the volumes `dsh-home` (profile and `stateDir`, back up `state/superagent/orchestrator.sqlite`), `gateway-data` and `shared`. `docker compose down` keeps them; `down -v` deletes them, including the issued key.

## Start and stop

```sh
scripts/dsh-superagent start
scripts/dsh-superagent status
```

`start` runs `dsh --profile superagent` in tmux session `dsh-superagent`, or `dsh-<profile>` for another profile. It waits up to one minute for the runtime to become ready or report a setup requirement. On a first run it prints the missing setup information. It refuses duplicate instances, including ones started outside this script.

`stop` and `restart` request graceful shutdown and wait up to five minutes for Executors. They never force-kill the process or touch other tmux sessions.

`status` prints process ids, health and setup problems. For a different profile or port, use `--profile` and `--url`, or set `DSH_SUPERAGENT_PROFILE` and `DSH_SUPERAGENT_URL`.

`status`, `start` and `restart` exit with one of four codes:

| Code | Meaning |
| --- | --- |
| 0 | The service runs normally |
| 1 | It does not run, runs twice, does not answer, or its runtime reports an error; a restart may fix it |
| 2 | It runs, but a part other than the runtime, such as a Source or a Policy sync (`sync:<source id>`), reports an error; a restart does not fix it |
| 3 | It runs and waits for setup; a restart does not fix it |

A Source that is still starting counts as normal operation. So does a Feishu bot that setup could not check.

`status` returns failed parts and their details under `errors`, and setup requirements under `setup`. `start` and `restart` print those problems as lines; they exit 1 if the service never comes up. Only an intentional `stop` pauses automatic recovery.

Each profile stores logs and control files under `.artifacts/`:

- Startup logs: `dsh-superagent-<profile>-<date>-<time>-<pid>.log`, where the pid belongs to the script. The newest 20 are kept.
- Control files: `control/profiles/<profile>/`, containing the stop marker, lock and process id.

Open the URL printed in the log, then choose **Superagent** in the sidebar.

### Hourly check

Create the hourly check in the DeepSeek Harness profile you normally use, not in `superagent`. It must keep running when the agent service is down. Ask an agent in that profile to create an hourly schedule using this prompt, with the checkout path filled in:

```text
Check dsh-superagent: run `scripts/dsh-superagent --profile superagent status` in <checkout>. Exit 0: do nothing and say nothing. Exit 2: do not restart; tell me each part under `errors` with its detail, unless you already told me about the same ones. Exit 3: do not restart; tell me what `setup` says setup needs, unless you already told me. If it reports manually_stopped: true, leave it stopped. Otherwise (exit 1) run `scripts/dsh-superagent --profile superagent --respect-stop restart`, which exits the same way: 0 means it recovered, so say nothing; 2 and 3 are reported as above; if it exits 1 or fails otherwise, read the newest .artifacts/dsh-superagent-superagent-*.log and the Troubleshooting section of docs/006-deployment.md, fix what you can, and tell me what was wrong and what you did.
```

`--respect-stop` preserves an intentional stop. Only `stop` writes the marker; `start` clears it. `restart` writes no marker, so the check can recover a restart whose shutdown timed out.

## Settings

Setup must succeed before polling or work starts. Overview lists missing requirements and links to their settings. A settings change runs setup again. If you fix something outside the application, such as CLI authentication, choose **Check again**.

1. **Sources.** Set the GitHub repository (`owner/name`) and agent CLI, for example `/home/me/.local/bin/gh-agent`. Requests normally arrive through the agent account's notifications. A new Issue or comment mentioning the account arrives on the next poll; adding a mention by editing an existing Issue body does not. Post a new comment instead. For Feishu, set the bot CLI, chats, each chat's receive-all or mentions-only mode, and whether to receive direct messages.
   **More repositories.** One installation can watch many repositories. Under the GitHub card, the **GitHub repositories** table adds rows one by one or in bulk (paste `owner/name` lines or github.com links), removes them, and saves them together; new rows can start from another repository's allowed list. Each repository becomes an instance of the GitHub Source (`github-2`, `github-3`, …) with its own card, receive switches, gateway `github_user` instance, allowed accounts, admission table, Threads and Tickets. The agent account, its CLI and the polling interval are the default repository's and are shared. Saving checks that the agent account can push to every added repository and refuses the save otherwise, then restarts dsh-superagent like any account change. Removing a repository with open Tickets is refused. Limits: at most 50 repositories including the default; one agent account for all of them; the polling interval grows by a minute per 15 repositories; a Ticket from a chat works in the default repository (`DSH_SUPERAGENT_GITHUB_REPOSITORY`), and its worker can still open and report a PR in another watched repository (`DSH_SUPERAGENT_GITHUB_REPOSITORIES`, `pr_repository`). The gateway's `github_user` instance serves one repository, so each repository that replies through the gateway needs its own instance there.
2. **Policy.** The two example rules can be edited or removed. Under **On each Source**, add the GitHub accounts and Feishu users who may ask for work; until a list has someone, no request can become a Ticket. With Feishu, a chat can be chosen to sync the list from, at startup and on **Sync now**.
3. **Execution.** The directory root and a prepare command. To give each Ticket a checkout of the repository:

   ```sh
   git -C /home/me/src/widgets fetch --no-tags "https://github.com/$DSH_SUPERAGENT_GITHUB_REPOSITORY.git" "${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/$DSH_SUPERAGENT_TICKET" &&
   git -C /home/me/src/widgets worktree add -b "agent/$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_DIR" "refs/dsh-superagent/$DSH_SUPERAGENT_TICKET"
   ```

   List personal CLIs, such as one signed in to your own account, as blocked commands.
4. **Prompts.** Set the team sections: the GitHub disclosure line, review bots, the commit author and the auto-merge condition.

### Management API

The panel uses a local HTTP API that agents can also call. `SETUP.md` uses it to save settings, and the service script reads `GET state`.

Send requests to `http://127.0.0.1:<port>/orchestrator/api/` with `x-orchestrator-request: 1`. The host must be `127.0.0.1:<port>` or `localhost:<port>`. Missing headers or an `Origin` from another site receive 403.

API saves have the panel's permissions. They can change execution environment and setup account fields, unlike saves made through the main Session's tools.

Agents may rely on these routes and fields. The other routes in `src/app/api.ts` serve the panel and change with it.

| Request | Answer |
| --- | --- |
| `GET state` | What every page reads: `setup`, with `problem` and `feishuProblem`, each `null` or a setup problem with `place`, `code`, `values` and `detail`, and `accounts` once setup resolved them; `health`, an entry per part, below, with `state` (`starting`, `ready`, `paused` or `error`), `detail` and `at`; `load`, the Executor Sessions `running`, the Tickets `queued` and `maxWorkers`; `paused`; and `masterId` |
| `GET settings` | `blocks`: `policy`, `eval` and `executor`, each with its `value` and its `revision`; `sources`: the Source instances, each with `id`, `kind`, `installed`, its block's `value`, `{"enabled": …, "config": {…}}`, and `revision`, its kind's form, and its setup `problem` when it has one; `policyVersion`; and `environment`, the execution environment's `root` and `variables` |
| `GET sources` | Each Source's status: `state` (`missing`, `off`, `error`, `setup`, `starting`, `paused` or `ready`), the `health` of its parts, its setup `problem`, the last day's `stats`, the Triggers it `filtered` in that day, and the messages it `dropped` in that day, newest drop first, each with its `channel`, `preview`, `ticket` (`id` and `title`) when it was for one, its `thread` when the store has it, and `dropped.at` and `dropped.reason`, `channelGone` or `channelIgnored` |
| `PUT sources/github/instances` with `{"rows": [{"id"?, "enabled", "config": {"repository", …}, "policyFrom"?}], "revision": n}` | Replaces the extra GitHub instances, one per repository: a row with `id` keeps that instance, one without adds a new one, an instance not listed is removed. `revision` is `instances.github.revision` from `GET settings`. Answers `revision`, `restarting` and the saved `instances` |
| `PUT settings/<block>` with `{"value": …, "revision": n}` | Saves one block: `saved`, the block's new `revision`, `policy_changed` and `restarting`. `value` is the whole block, as `GET settings` holds it; a missing key takes its default |
| `POST executor/pause` with `{"paused": true}` or `false` | Pauses or resumes processing: `paused` |
| `POST setup/check` | Runs setup again by restarting dsh-superagent: `restarting: true`. Refused when setup has nothing to fix |
| `POST policy-sync/<source id>` | Syncs that Source's allowed list now: `policy`, the Source's part as saved |
| `GET prompts`, `PUT prompts` with `{"config", "baseRevision"}` | Reads the prompt configuration: `current`, with its `revision` and `config`, `defaults`, `sections`, the team sections in the order Sessions read them, `skillName`, the pattern of a team skill's name, `builtin`, the names a team skill cannot take, and `skillPrefix`, which Sessions load a skill's name under. Or saves it: the new `revision` |
| `POST tickets/<id>/retry`, `POST tickets/<id>/stop` | Retries or stops a Ticket, as the panel does |

Health entries are grouped by responsibility:

| Entry | Reports |
| --- | --- |
| `runtime` | The application itself |
| `models` | Sessions waiting on a model-budget retry |
| `evals` | Unavailable Evals from the last hour with no later judgement or dismissal |
| `assessment`, `launch`, `delivery`, `relay`, `notice`, `reply` | Stored work described in [003 Execution](003-execution.md); delivery counts waiting work, while reply covers Channel messages |
| `worker` | Executor Session event handling; appears after its first failure |
| `github`, `feishu`, `history` | Source polling, events and history recovery |
| `sync:<source id>` | Allowed-list synchronization |

A refusal has a status and `error`, its English text:

- 400: an invalid value (`issues`, each with its `path`), a failed account check (`setup`), a fixed refusal (`code` and `values`), or a body that is not JSON or is too large.
- 404: something that does not exist.
- 409: a stale revision.
- 500: anything else.

The blocks:

- `source:github`, `source:feishu`: `{"enabled": true, "config": {…}}`. GitHub's config has `repository` and `cli`, and the switches `observeIssues`, `observePulls`, `observeComments` and `observeCi`, off by default, which receive every new Issue, new pull request and comment in the repository and the default branch's CI; Feishu's has `cli`, `chats` as `[{"chatId": "oc_…", "name": "…", "listen": "mentions"}]` (or `"all"`), `directMessages`, and `otherChats` as `"none"` or `"mentions"`.
- `policy`: `{"rules": […], "sources": {"github": {"allowed": [{"id": "<login>"}], "bots": [{"id": "dependabot[bot]"}]}, "feishu": {"allowed": [{"id": "ou_…", "name": "…"}], "syncChat": "oc_…", "admission": {"oc_…": {"unlistedAddressed": "explicit"}}}}}`. `bots` lists the bots whose messages may become inferred candidates. An `admission` row is keyed by chat id, `other` or `direct` for Feishu, and by `issues`, `pulls`, `comments` or `ci` for GitHub; an unset cell takes its default (see [002 Authorization](002-authorization.md)).
- `source:hxrouter`: `{"enabled": true, "config": {…}}` with `baseUrl`, `tokenEnv`, `sessions`, `accounts`, `githubInstance`, `pollSeconds` and `readPageSize`, as in [HX-Email message router](#hx-email-message-router-optional); its Policy part is `{"allowed": [{"id": "qq:10001"}], "bots": [{"id": "qq:4242"}]}`.
- `eval`: `mode`, `timeoutSeconds` and `model`.
- `executor`: `model`, `maxWorkers`, `directory`, `prepare` and `blockedCommands`. The processing pause is a setting of its own, `paused`, which `POST executor/pause` sets.

Changing a repository or CLI runs the corresponding setup check first. A failed check returns 400 with details in `setup`. A successful account change, or any save while setup is pending, returns `restarting: true`. The API is temporarily unavailable while the application restarts.

```sh
api=http://127.0.0.1:3082/orchestrator/api
rev=$(curl -s -H 'x-orchestrator-request: 1' $api/settings | jq '.sources[] | select(.id == "github") | .revision')
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' $api/settings/source:github \
  -d "{\"value\": {\"enabled\": true, \"config\": {\"repository\": \"acme/widgets\", \"cli\": \"$HOME/.local/bin/gh-agent\"}}, \"revision\": $rev}"
```

## Setup checks

Setup uses the DeepSeek Harness subprocess service, as worker shells do. It removes environment variables whose names contain KEY, PASSWORD, SECRET or TOKEN.

Setup verifies the GitHub repository and the agent's push access, writes the worker environment, and checks that git uses only the agent credentials for github.com. A Feishu setup failure disables only the Feishu Source.

The process environment that setup writes:

- **Command shims** in `<stateDir>/worker-bin`, first on `PATH`: `gh` runs the agent's CLI; `lark-cli` runs the bot's CLI; blocked commands fail. A shim removes its own directory from `PATH` before it runs its target.
- **git configuration** in `<stateDir>/worker-gitconfig`: replaces the operator's global and system git configuration. It selects the agent CLI as the github.com credential helper, rewrites GitHub SSH addresses to HTTPS and defines Git LFS filters. Personal git settings such as an HTTP proxy do not apply. No commit identity is set here, git never prompts for credentials, and `GH_TOKEN` and `GITHUB_TOKEN` are removed.

A file in `worker-bin` or `worker-gitconfig` that dsh-superagent did not write stops setup. A Ticket directory inside a git repository whose own configuration adds credentials fails the Ticket.

## Try it

From an allowed GitHub account, open an Issue or post a comment containing `@<agent login> <request>`. Within a polling interval (one minute by default), Overview should show a Ticket. The agent acknowledges the request, works in its own Session and directory, and delivers in the original conversation. For Feishu, mention the bot in a configured chat.

## Upgrade

1. Wait until no Executor is in the middle of a turn.
2. Back up `<stateDir>/orchestrator.sqlite`.
3. Run `git pull && pnpm install && pnpm build`.
4. Run `scripts/dsh-superagent restart` and inspect its status.

A restart ends running Assignments and starts replacements with recovery notes. Team text and overridden prompt parts are retained; parts without overrides follow the new defaults. Review parts marked **Default updated** after upgrading.

A database migrated by a newer version cannot be opened by an older one. Rollback therefore requires the pre-upgrade backup. After upgrading DeepSeek Harness itself, restart the running instance so the panel loads matching artifacts.

### Hark secretary persona (optional)

[examples/hark-secretary.prompts.json](../examples/hark-secretary.prompts.json) is a prompt configuration that gives the orchestrator the hark secretary's voice for IM replies. Workers and GitHub messages are unchanged. It overrides only `runtime/orchestrator`, keeping the built-in text and appending the persona, so an upgrade that changes the built-in text marks the part **Default updated** for review. Its team sections are the defaults, so do not save the file over a configuration a team has edited: add its `overrides` entry to the current configuration on the panel's **Prompts** page, or read `GET prompts`, add the entry and save with `PUT prompts` `{"config": …, "baseRevision": <current revision>}`.

To import it:

- **Panel.** Open **Prompts**, open the part **Main Session role** (`runtime/orchestrator`), replace its text with `overrides["runtime/orchestrator"].text` from the file, and save. The other parts keep what the team has.
- **API.** The commands below keep the current configuration and add only the persona's override. The service must run, and `jq` must be installed. Run them in the checkout, with the port from `GET state` or the service log.

```sh
api=http://127.0.0.1:3082/orchestrator/api
h='x-orchestrator-request: 1'
curl -s -H "$h" $api/prompts > /tmp/prompts.json
jq --slurpfile p examples/hark-secretary.prompts.json \
  '{config: (.current.config | .overrides = ((.overrides // {}) + {"runtime/orchestrator": $p[0].overrides["runtime/orchestrator"]})), baseRevision: .current.revision}' \
  /tmp/prompts.json > /tmp/prompts-put.json
curl -s -X PUT -H "$h" -H 'content-type: application/json' $api/prompts --data @/tmp/prompts-put.json
```

A 409 means someone saved in between; run the commands again. To undo, remove the `runtime/orchestrator` entry from `overrides` the same way, or reset the part on the **Prompts** page.

The persona is adapted from the hark secretary doctrine, not copied: the orchestrator already routes the original message, leaves plans and acceptance to workers, sends follow-ups to the ticket's workers, never polls, and tells workers not to ask routine implementation preferences, so those rules are not repeated. The doctrine's tool names, account switching and self-editing rules have no counterpart here and are left out, and so is deciding a worker's question in its place: the orchestrator has no channel back to a running worker, only to the person.

### Agent presets

The worker and router presets move shell commands to the background after 5 seconds. A Session cannot load without its preset. Keep the `dsh-superagent-worker` and `dsh-superagent-router` rows in `cordis.patch.yml` while their Sessions are in use; otherwise resume fails with `agent-preset/not-found`.

## Troubleshooting

Setup problems appear on the overview with a link to the fix, in the panel's language; the log and the API show the English text below.

| Symptom | Cause and fix |
| --- | --- |
| `The agent GitHub CLI is not set.` | Set the agent's CLI on the GitHub card |
| `The agent GitHub CLI was not found.` | Set the wrapper's absolute path, or a command name on `PATH` |
| `The agent GitHub CLI cannot read its account` | Sign the wrapper in with `auth login` |
| `@… cannot read …` or `@… cannot push to …` | Give the agent account write access to the repository |
| `The GitHub Source names no repository.` | Set the repository, `owner/name`, on the GitHub card |
| A Ticket fails with `The prepare command failed: …` | The output names the cause, such as a wrong clone path; fix the command, then retry the Ticket |
| `git does not read the github.com credential configuration dsh-superagent writes` | Install git 2.32 or later |
| A Ticket fails with `The git configuration of the repository in … sets …` | Remove the named credential or `http.*.extraheader` settings from the clone's `.git/config` |
| `… was not written by dsh-superagent` | Move the named file out of `<stateDir>/worker-bin` or `<stateDir>/worker-gitconfig`, or choose another `stateDir` |
| `The bot lark-cli allows user identities` | Point the Feishu Source at a bot-only configuration, as in Feishu bot above |
| `The bot lark-cli does not work.` or `The bot identity of app … is …` | Check the configuration's app id and secret |
| `The Feishu bot is not a member of the chat.` | Add the bot to the chat in the chat's settings; the next attempt succeeds |
| `status` exits 2 | A part reports an error, which a restart does not fix: `errors` names each part, as listed under Management API, with its detail; each part clears its own entry once it works again |
| `status` exits 3 | Setup waits: `setup` says what is missing, and the overview links to the setting that fixes it |
| `status` exits 1 | The service does not run, runs twice, does not answer, or its runtime reports an error; the output and the newest log say which |
| `… timed out after 90 s`, `… was stopped by …`, `… exited with code …` or `… could not run: …` | A CLI failed without printing why; run the named program by hand as the operator's user to see its own message |
| The panel says dsh-superagent is not answering | It is restarting, or did not start because of its configuration; the DeepSeek Harness log names the cause |
| `dsh-superagent configuration has keys it does not use` (log) | Remove the named keys; the message says where each value lives now |
| The log says the plugin is incompatible with the running dsh | Install a DeepSeek Harness version within the `engines.dsh` range |
| The panel shows "Failed to load plugins" after a DeepSeek Harness upgrade | Restart the running instance |
| A QQ @-mention of the bot is ignored | Add the bot's QQ number for that instance under `accounts`; the QQ gateway does not flag mentions. Also check that the sender is on the HX-Email allowed list and that `HX_ROUTER_TOKEN` is set in the process environment |
| GitHub replies fail with `provider_offline` or `HX-Email gateway unreachable` | The gateway or its `github_user` instance is down or unchecked; run the instance's check in HX-Email until it is `online`. Replies wait and are retried |
| The agent answers its own GitHub comments | The gateway's `github_user` instance is signed in to another account than the GitHub Source's `cli`; sign it in to the agent account |
| Nothing happens after a mention | Check that the author is on the Source's allowed list, the Source is on, and processing is not paused. On GitHub, a mention added by editing an Issue's body is not received; mention the agent in a comment |
