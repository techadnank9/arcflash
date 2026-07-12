#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_USER="arcflash"
readonly APP_HOME="/home/arcflash"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'error: run this verification as root\n' >&2
  exit 1
fi

runuser -u "${APP_USER}" -- env \
  HOME="${APP_HOME}" \
  PATH="${APP_HOME}/.local/bin:${APP_HOME}/.nemoclaw/bin:${APP_HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin" \
  bash -c 'command -v nemoclaw >/dev/null && nemoclaw sandbox status arcflash-copilot --json'

curl --fail --silent --show-error http://127.0.0.1:8787/api/health
printf '\n'
curl --fail --silent --show-error http://127.0.0.1:8787/api/nemoclaw/status
printf '\n'
curl --fail --silent --show-error http://127.0.0.1:8787/api/hcomputer/status
printf '\n'
curl --fail --silent --show-error http://127.0.0.1:8787/api/gradium/status
printf '\n'

for frontend_route in / /study /labs/electrisim; do
  curl --fail --silent --show-error "http://127.0.0.1:8787${frontend_route}" \
    | python3 -c 'import sys; raise SystemExit(0 if "id=\"root\"" in sys.stdin.read() else 1)'
done

curl --fail --silent --show-error http://127.0.0.1:8787/api/openapi.json \
  | python3 -c '
import json
import sys

paths = json.load(sys.stdin)["paths"]
required = {
    "/api/electrisim/sessions",
    "/api/electrisim/sessions/{session_id}",
    "/api/electrisim/sessions/{session_id}/changes",
    "/api/electrisim/sessions/{session_id}/screenshots",
    "/api/electrisim/calculations/cv104",
}
missing = sorted(required.difference(paths))
if missing:
    raise SystemExit(f"missing Electrisim API routes: {missing}")
'

systemctl --quiet is-active docker
systemctl --quiet is-active arcflash
systemctl --quiet is-active caddy

printf 'DigitalOcean host checks passed, including existing and Electrisim routes. Confirm the JSON reports ready=true before a paid H run.\n'
