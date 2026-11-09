# dsh-superagent: DeepSeek Harness + this bundle, run in the foreground as `dsh --profile superagent`.
FROM node:24-bookworm

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg git git-lfs python3 tmux; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*; \
    printf '#!/bin/sh\nGH_CONFIG_DIR=/gh-agent exec gh "$@"\n' > /usr/local/bin/gh-agent; \
    chmod 0755 /usr/local/bin/gh-agent

# Same dsh as the dev machine the bundle runs and was checked against (its 86 @deepseek-ai deps are
# exact pins, so this reproduces that tree). Change it together with the host install.
ARG DSH_VERSION=0.2.1-rc.2
RUN npm install -g "@deepseek-ai/dsh@${DSH_VERSION}" pnpm@11.7.0

WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN pnpm build

# The superagent profile is made at build time, where the registry is reachable; the dsh-home named
# volume is filled from this layer on first use. `dsh plugin` forwards `add link:/app` to pnpm in the
# profile directory, so the profile's node_modules links this checkout and a rebuilt image is picked up.
# The profile's cordis.patch.yml (port, stateDir) is written by the entrypoint on first start.
ENV DSH_HOME=/home/node/.dsh
RUN mkdir -p "$DSH_HOME" \
 && dsh superagent --from-default-profile web --dump-config > /dev/null \
 && dsh plugin --profile superagent add link:/app \
 && test -L "$DSH_HOME/profiles/superagent/node_modules/dsh-superagent"
VOLUME ["/home/node/.dsh"]
ENTRYPOINT ["/app/deploy/superagent-entrypoint.sh"]
