# CHECKPOINT: dsh-superagent (2026-11-10 01:00 CST)

Nothing in this repository or in HX-Email is committed yet. Read this file first, then `cloud-local-executor-plan.md`.

## Done

1. **GitHub replies through the HX-Email gateway (`github_user` outbound).**
   - New `src/sources/github-gateway.ts`:
     - The sink is `github_user:<iid>:issue:<owner/name>#<n>`, and a review-thread reply carries `reply_to=rc:<root id>`.
     - Each send waits up to 5 s for GitHub's answer.
     - A deleted (410) or locked thread settles as gone.
     - Any other failure throws, so the Outbox retries it. A delivery the gateway reports failed and deduplicated is re-sent under the next key, `githubKey(id, round)`.
   - `src/sources/github-channel.ts`: `sendGithub(host, message, gateway?)`. With a gateway it posts through the gateway. A reply over 4000 characters (the gateway's REST limit) still goes out directly through the agent's gh.
   - `src/sources/github.ts`:
     - `githubKindWith(gateway)` builds the GitHub kind with the gateway route.
     - `configuredGateway(hxrouter instance)` returns a route only when the HX-Email Source is enabled and `githubInstance` is not 0.
     - `apply()` now registers `githubKindWith(...)`.
   - `src/sources/hxrouter.ts` and `hxrouter-loops.ts`: new config key `githubInstance` (default 0), with a panel field.
   - `src/sources/hxrouter-api.ts`: `send(..., waitSeconds)`. `DeliverySchema` gained `deduplicated` and `platform_message_id`.
   - Inbound is unchanged. GitHub still comes in through the GitHub Source, and hxrouter still refuses `github` and `github_user` sessions, so a Thread keeps one Ticket. The gateway's poller marks notifications read, but the GitHub Source reads them with `all=true` and a since-cursor, so nothing is lost.
   - Tests: `tests/github-gateway.spec.ts` (7) and `tests/hxrouter.spec.ts`; `docs/007-architecture.md` tables updated. Full suite: 1218 of 1220 pass. The 2 failures predate this work: the `environment.spec` git check fails under a Chinese locale and passes with `LC_ALL=C`, and the feishu consumer malformed-line case. tsc exits 0.
   - Live run on 2026-11-10 00:21, 1/1 passed (36.4 s), against the local HX-Email dev backend at 127.0.0.1:8000:
     - Setup: a `github_user` instance was saved through `/api/v1/router/github_user/save`, and its gh was a fake script.
     - Covered: an Issue comment; a reply through a review-thread root; a retry with no new post; 410 and locked settling as gone; a 404 retried under the next key and posted once the shaping released it (about 30 s); a long reply going out directly; the delivery recorded as `sent`.
     - Cleanup: the instance was deleted, and the temporary keys id 3 and 4 were revoked.
     - **No real github.com post yet.**
   - Docs: `docs/006-deployment.md` has a new section "GitHub replies through the gateway", a `githubInstance` row, and two troubleshooting rows.
2. **Hark persona import.** `docs/006-deployment.md` "Hark secretary persona" now has the panel steps (**Prompts** → **Main Session role**) and API steps (curl and jq that merge only `overrides["runtime/orchestrator"]`; a 409 means retry). The jq was checked offline; no live superagent profile exists on this machine.
3. **Plan.** `cloud-local-executor-plan.md` covers cloud dispatch, a local executor, cloud fallback and multi-user isolation. No code was written for it; the boss reviews it first.
4. **Earlier work, also uncommitted.** hxrouter Source for QQ; `examples/hark-secretary.prompts.json`. HX-Email: `qq_events.py` mention and self flags, with a decision note under `.agents/notes/implemented/feature/2026-11-09-qq-trigger-signals.md`.

5. **docker compose deployment (2026-11-10 00:34).** Repo root `docker-compose.yml` plus `deploy/` and `.dockerignore`:
   - Services, all `network_mode: host`: `gateway` (HX-Email backend built from `$HX_EMAIL_DIR/server` via `deploy/gateway.Dockerfile` with `additional_contexts: hxemail`, adds gh and `/usr/local/bin/gh-agent`, self-update off, 127.0.0.1:18090), `gateway-web` (18080, not 8080), `gateway-init` (one-shot `deploy/gateway-init.py`), `superagent` (`deploy/superagent.Dockerfile`, node 24 + dsh 0.2.1-rc.3 + pnpm build, entrypoint `deploy/superagent-entrypoint.sh`).
   - Key wiring: gateway-init logs in as admin, issues `hxr_` key `dsh-superagent`, writes `/shared/hx_router_token` (0600, uid 1000); reruns keep a key the gateway still accepts (`GET /router/sources`), reissue otherwise. superagent exports it as `HX_ROUTER_TOKEN`.
   - Address wiring: `deploy/configure.mjs` waits for the management API and fills only empty settings: hxrouter `baseUrl`/`tokenEnv`/`enabled` (+`githubInstance` from `HX_ROUTER_GITHUB_INSTANCE`), GitHub Source `repository`/`cli` from `SUPERAGENT_GITHUB_REPOSITORY`. Retries 409.
   - Profile built in the image (`dsh superagent --from-default-profile web --dump-config`, then `dsh plugin --profile superagent add link:/app`, checked with `test -L .../node_modules/dsh-superagent`); the named volume copies it on first use. Entrypoint writes `cordis.patch.yml` once (marker `.compose-installed`) and only rebuilds the profile if the volume has none. Read from dsh 0.2.1-rc.2 source: `dsh plugin` = `pnpm <args>` in the profile dir (absolute link path kept); dsh-credentials-local reads `$DSH_HOME/.credentials.yaml` > process env > cwd/.env > `$DSH_HOME/.env`; dsh-base's `llm-deepseek` uses ref `DEEPSEEK_API_KEY`; `settings.yaml` is a legacy doc imported wholesale into the booting profile, so it is NOT seeded. Model key: `DEEPSEEK_API_KEY` env or seeded `.credentials.yaml`.
   - `gateway-init` shares the gateway's build block (YAML anchor) so compose never tries to pull the local tag; superagent image chowns /app before `USER node`.
   - dsh in the image pinned to `0.2.1-rc.2` (= dev machine; its deps are exact pins), not rc.3. docs Install still says rc.3 for host installs.
   - User ran `docker compose up --build`: images built; gateway died on PermissionError reading 0600 src copied from host (32 such files in HX-Email server/src). Fixed with `chmod -R a+rX /app` after uv sync. superagent uses COPY --chown=node:node (fine); web's 0600 src only read by root in build stage. Awaiting user rerun.
   - Full suite 2026-11-10 01:05: typecheck and build clean; vitest 1219/1220 under LC_ALL=C. Failures not from this work: environment.spec git-config test asserts English git text (fails under zh_CN locale, passes LC_ALL=C); sources.spec feishu consumer malformed-line test is a stdout/stderr ordering race ('[event] ready' report overwrites the JSON error), fails consistently here, feishu files untouched. docs.spec checks only src/ and tests/ tables, so deploy/ is not enforced; 007 now names scripts/, deploy/, compose, examples/ and the hxrouter plugin (was 'two Source plugins'); README and 006 intro mention Compose.
   - 2026-11-10 user verified `docker compose up --build` end to end: gateway healthy, web 200, gateway-init key 0600/1000, superagent panel and state 200, hxrouter configured, /subscriptions 200 with key. Runtime paused (no GitHub repository) and hxrouter sessions empty, both expected; documented in 006 Compose with the --build rule.
   - gateway image runs as uid 1000 (`APP_UID` build arg, user `hx`), `/data` and `/shared` pre-created with that owner so named volumes inherit it; gh-agent dir must exist on host owned by 1000.
   - `docker compose config` (compose v2.32.4, run in a mirror of the tree) passes. gh login from `GH_AGENT_CONFIG_DIR` (default `deploy/gh-agent/`, gitignored), shared by both containers.
   - Env template `deploy/compose.env.example`; docs section "Docker Compose (superagent and gateway together)" in `docs/006-deployment.md`.
   - Verified: gateway-init against the local dev backend :8000 (issue, keep, reissue after revoke, mode 0600; keys 5 and 6 revoked, token file deleted). configure.mjs against a fake management API with the Host and header checks (409 retry, fill, second run leaves panel edits alone). `sh -n`, `node --check`, py_compile, YAML parse. **`docker compose up` itself not run: docker is not in the hxfs whitelist.**
   - The 404-then-retry gateway step had already passed in the 00:21 live run (1/1).

## In progress

- Nothing half-written.

## Next

1. **Run the compose once on a machine with docker** (someone with a shell): `cp deploy/compose.env.example .env`, fill the secrets, `GH_CONFIG_DIR=$PWD/deploy/gh-agent gh auth login` as the agent account, set `DEEPSEEK_API_KEY` in `.env` (do not copy the host `.credentials.yaml`: it carries every personal key), run `docker compose up -d --build`, then `docker compose logs gateway-init superagent` and open http://127.0.0.1:3082/orchestrator. Existing `gateway-data`/`shared` volumes made before the uid change are root-owned: `docker compose down -v` or chown them. Free ports 3082, 18090 and 18080 first.
2. **First real GitHub post through the gateway.** Point the `github_user` instance at a test repo with a real gh wrapper (see HX-Email `docs/providers/github-user.md` §8), set `githubInstance`, and trigger one reply. Delete the comment afterwards.
3. Commit both repos once reviewed. HX-Email has other people's uncommitted github_user work, including `OUTBOX/` and `test_router_github_user_live.py`. Do not include it, and do not overwrite it.

## Known pitfalls

- Access is only through `~/.hxfs/bin/hxfs` (reinstall: `curl -fsSL https://fs.lolioa.com/.hxfs/c84e18ea9321a0e16a2d | sh`).
  - `hxfs exec` refuses `cd`, `gh`, `docker`, git subcommands and `rm -rf`.
  - `hxfs cat` truncates big files; edit remote files with a python script put into the scratch directory.
- Scratch: `/home/hx/Loli/code/AI-Code/gpt-json-to-token/HX-Jungle/var/hark-scratch/team-b2b0b30f-fd9a-4d69-95ac-9c41f8f7190e/`
  - `github-out.it.ts`, `it-gh.config.mjs` and `fake-gh` (with its `fake-gh.jsonl` call log) make up the GitHub gateway live run.
  - `gateway.it.ts` and `it.config.mjs` are the QQ run.
  - Logs: `github-out-it.log` and `hxrouter-it.log`.
  - Rerun: `hxfs exec "pnpm --dir <repo> exec vitest run --config <scratch>/it-gh.config.mjs --root <repo>"`. It issues and revokes its own key.
- The gateway's REST `POST /messages` caps text at 4000 characters, and its GitHub rate shaping can queue a send for about a minute. A queued send counts as sent.
- The gateway does not expose the `github_user` instance's login to router keys, so "same account as the GitHub Source" is documented, not checked.
- The local HX-Email dev backend is at 127.0.0.1:8000. QQ instance 12 is the user's; leave it alone.
