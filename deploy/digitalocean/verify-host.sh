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

systemctl --quiet is-active docker
systemctl --quiet is-active arcflash
systemctl --quiet is-active caddy

printf 'DigitalOcean host checks passed. Confirm the JSON reports ready=true before a paid H run.\n'
