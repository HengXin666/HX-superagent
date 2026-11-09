#!/bin/sh
# Container entrypoint for the superagent service: profile on first start, router key into the
# environment, dsh in the foreground, then first-start settings through the management API.
set -eu

PROFILE=superagent
PORT="${SUPERAGENT_PORT:-3082}"
DSH_HOME="${DSH_HOME:-/home/node/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
STATE_DIR="$DSH_HOME/state/superagent"
MARKER="$PROFILE_DIR/.compose-installed"
export DSH_HOME

# Model credentials: $DSH_HOME/.credentials.yaml (and $DSH_HOME/.env) from the seed directory, copied once.
# Not settings.yaml: dsh treats it as a removed legacy document and imports every section of it into
# the profile that boots, so a host copy would drag personal settings in.
for name in .credentials.yaml .env; do
  if [ -f "/seed/$name" ] && [ ! -f "$DSH_HOME/$name" ]; then
    cp "/seed/$name" "$DSH_HOME/$name"
    chmod 600 "$DSH_HOME/$name"
  fi
done

[ -n "${DEEPSEEK_API_KEY:-}" ] || unset DEEPSEEK_API_KEY

# The image builds the profile; a volume made before that (no profile package.json) builds it here.
# The profile-creation command replaces an existing profile, so it never runs once the marker exists.
if [ ! -f "$MARKER" ]; then
  if [ ! -f "$PROFILE_DIR/package.json" ]; then
    dsh "$PROFILE" --from-default-profile web --dump-config > /dev/null
    dsh plugin --profile "$PROFILE" add link:/app
  fi
  mkdir -p "$STATE_DIR"
  cat > "$PROFILE_DIR/cordis.patch.yml" <<YAML
- id: webserver
  config:
    host: 127.0.0.1
    port: $PORT
- id: dsh-superagent
  config:
    stateDir: $STATE_DIR
YAML
  touch "$MARKER"
fi

TOKEN_FILE="${HX_ROUTER_TOKEN_FILE:-/shared/hx_router_token}"
if [ -s "$TOKEN_FILE" ]; then
  HX_ROUTER_TOKEN="$(cat "$TOKEN_FILE")"
  export HX_ROUTER_TOKEN
else
  echo "superagent: no router key at $TOKEN_FILE; the hxrouter Source stays paused" >&2
fi

dsh --profile "$PROFILE" --no-open &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' TERM INT

node /app/deploy/configure.mjs || echo "superagent: first-start settings not applied; set them in the panel" >&2

# wait returns early when a trapped signal arrives, so wait again for the graceful shutdown.
status=0
wait "$child" || status=$?
if kill -0 "$child" 2>/dev/null; then
  status=0
  wait "$child" || status=$?
fi
exit "$status"
