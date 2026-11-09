# HX-Email backend for the superagent compose: HX-Email's server/ (build context "hxemail")
# plus gh and a gh-agent wrapper for github_user instances, run as uid APP_UID (default 1000, the
# superagent container's node user). No docker CLI: self-update is off here.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*; \
    printf '#!/bin/sh\nGH_CONFIG_DIR=/gh-agent exec gh "$@"\n' > /usr/local/bin/gh-agent; \
    chmod 0755 /usr/local/bin/gh-agent

COPY --from=hxemail pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY --from=hxemail src ./src
# COPY keeps host modes, and part of HX-Email's src is 0600 on the host. Make /app (src and .venv)
# world-readable, directories traversable, still root-owned so the app user cannot modify its code.
RUN uv sync --frozen --no-dev \
 && chmod -R a+rX /app

ENV PATH="/app/.venv/bin:${PATH}" \
    HX_EMAIL_DATA_DIR=/data \
    HX_EMAIL_UPDATE_ENABLED=false

# Runs as the superagent container's uid (node = 1000), so gh writes the shared gh-agent config dir,
# /data and the router key in /shared as that user, never as root. The directories exist here so the
# named volumes are created with this owner.
ARG APP_UID=1000
RUN useradd --create-home --uid "${APP_UID}" --user-group hx \
 && mkdir -p /data /shared \
 && chown hx:hx /data /shared
USER hx

VOLUME ["/data", "/shared"]
CMD ["sh", "-c", "hx-email migrate && exec uvicorn hx_email.app:app --host ${HX_EMAIL_BIND_HOST:-127.0.0.1} --port ${HX_EMAIL_BACKEND_PORT:-18090}"]
