#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_USER="arcflash"
readonly APP_GROUP="arcflash"
readonly APP_HOME="/home/arcflash"
readonly APP_DIR="/opt/arcflash"
readonly CONFIG_DIR="/etc/arcflash"
readonly ASSET_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${ASSET_DIR}/../.." && pwd)"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

run_as_arcflash() {
  runuser -u "${APP_USER}" -- env \
    HOME="${APP_HOME}" \
    PATH="${APP_HOME}/.local/bin:${APP_HOME}/.nemoclaw/bin:/usr/local/bin:/usr/bin:/bin" \
    "$@"
}

if [[ "${EUID}" -ne 0 ]]; then
  die "run this script as root (for example, sudo env ARCFLASH_DOMAIN=demo.example.com $0)"
fi

ARCFLASH_DOMAIN="${ARCFLASH_DOMAIN:-}"
HAI_REGION="${HAI_REGION:-eu}"

if [[ ! "${ARCFLASH_DOMAIN}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; then
  die "ARCFLASH_DOMAIN must be a DNS hostname such as arcflash.example.com"
fi
if [[ "${HAI_REGION}" != "eu" && "${HAI_REGION}" != "us" ]]; then
  die "HAI_REGION must be eu or us"
fi
if [[ "${REPOSITORY_ROOT}" != "${APP_DIR}" ]]; then
  die "clone this repository at ${APP_DIR}, then run ${APP_DIR}/deploy/digitalocean/bootstrap-host.sh"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  binutils \
  ca-certificates \
  caddy \
  curl \
  docker-buildx \
  docker.io \
  git \
  gnupg \
  python3 \
  python3-pip \
  python3-venv \
  zstd

# Ubuntu 24.04 ships Node 18, while the current Vite toolchain requires Node
# 20+. Install the signed NodeSource Node 22 repository instead of using npm to
# mutate the system Node installation.
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
printf '%s\n' \
  'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y --no-install-recommends nodejs

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd "${APP_GROUP}"
fi
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --create-home --home-dir "${APP_HOME}" --shell /bin/bash \
    --gid "${APP_GROUP}" "${APP_USER}"
fi
usermod --gid "${APP_GROUP}" "${APP_USER}"
usermod -aG docker "${APP_USER}"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" "${APP_HOME}"

systemctl enable --now docker

if [[ ! -x /opt/arcflash-tools/bin/uv ]]; then
  python3 -m venv /opt/arcflash-tools
  /opt/arcflash-tools/bin/pip install --disable-pip-version-check 'uv>=0.6,<1'
fi
ln -sfn /opt/arcflash-tools/bin/uv /usr/local/bin/uv

cd "${APP_DIR}"
run_as_arcflash npm ci
run_as_arcflash npm run build
run_as_arcflash /usr/local/bin/uv sync --frozen --extra study

install -d -m 0750 -o root -g "${APP_GROUP}" "${CONFIG_DIR}"
if [[ ! -f "${CONFIG_DIR}/arcflash.env" ]]; then
  install -m 0640 -o root -g "${APP_GROUP}" \
    "${ASSET_DIR}/arcflash.env.example" "${CONFIG_DIR}/arcflash.env"
fi
sed -i \
  -e "s|^PUBLIC_APP_URL=.*|PUBLIC_APP_URL=https://${ARCFLASH_DOMAIN}|" \
  -e "s|^HAI_REGION=.*|HAI_REGION=${HAI_REGION}|" \
  "${CONFIG_DIR}/arcflash.env"
printf 'ARCFLASH_DOMAIN=%s\n' "${ARCFLASH_DOMAIN}" > "${CONFIG_DIR}/caddy.env"
chmod 0644 "${CONFIG_DIR}/caddy.env"

install -m 0644 "${ASSET_DIR}/arcflash.service" /etc/systemd/system/arcflash.service
install -d -m 0755 /etc/systemd/system/caddy.service.d
install -m 0644 "${ASSET_DIR}/caddy-arcflash.conf" \
  /etc/systemd/system/caddy.service.d/arcflash.conf
if [[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.before-arcflash ]]; then
  cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-arcflash
fi
install -m 0644 "${ASSET_DIR}/Caddyfile" /etc/caddy/Caddyfile
install -d -m 0750 -o caddy -g caddy /var/log/caddy

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/arcflash.service
env ARCFLASH_DOMAIN="${ARCFLASH_DOMAIN}" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable arcflash
systemctl restart arcflash
systemctl enable --now caddy
systemctl restart caddy

curl --fail --silent --show-error --retry 15 --retry-connrefused --retry-delay 1 \
  http://127.0.0.1:8787/api/health >/dev/null

printf '%s\n' \
  "ArcFlash is healthy on localhost and Caddy is configured for https://${ARCFLASH_DOMAIN}." \
  "Next: install and onboard NemoClaw as ${APP_USER}, then provision the ArcFlash sandbox worker." \
  "See ${ASSET_DIR}/README.md."
