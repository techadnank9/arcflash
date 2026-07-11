# DigitalOcean deployment

This layout runs the built React application, FastAPI, Docker/OpenShell, and the
NemoClaw CLI on one Ubuntu 24.04 Droplet. Caddy is the only public process;
FastAPI listens on `127.0.0.1:8787`. H Computer's visual browser remains hosted
by H and reaches the public `/study` page over HTTPS.

## Droplet and DNS

Use a dedicated Ubuntu 24.04 x64 Droplet with at least 4 vCPU, 16 GiB RAM, and a
50 GiB disk. Add a DNS `A` record for the Droplet before starting Caddy. In a
DigitalOcean Cloud Firewall, allow inbound TCP 80 and 443 from the internet and
TCP 22 only from the operator's IP. Do not expose 8787, the Docker socket, or a
NemoClaw/OpenShell dashboard port.

The DigitalOcean API token is needed only by `doctl` or Terraform on the
operator's machine. It does not belong on the Droplet, in this repository, or in
`arcflash.env`. Revoke any token that has appeared in chat or logs before using
this deployment.

## 1. Install the host application

Connect as root (or a sudo-capable initial user), then clone the repository at
the fixed service path and run the idempotent host bootstrap:

```bash
git clone https://github.com/techadnank9/arcflash.git /opt/arcflash
sudo env ARCFLASH_DOMAIN=arcflash.example.com HAI_REGION=eu \
  bash /opt/arcflash/deploy/digitalocean/bootstrap-host.sh
```

The script installs Docker, Caddy, Node 22, Python tooling, and `uv`; creates an
unprivileged `arcflash` account; builds the frontend and Python environment; and
starts both services. It does not install NemoClaw or accept NVIDIA's
third-party software notice on the user's behalf.

Use `/etc/arcflash/arcflash.env` for service settings and the server-side
`GRADIUM_API_KEY`; keep it root-owned and group-readable only by `arcflash`. In
the default `NEMOCLAW_MODE=required` deployment, do not persist `HAI_API_KEY`
there.

## 2. Install and onboard NemoClaw as the service account

The account that onboards NemoClaw must also run FastAPI. This ensures the
backend's `nemoclaw ... exec` subprocess sees the same CLI, gateway, sandbox,
and user-owned runtime state.

```bash
sudo -iu arcflash
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```

Review and accept the NVIDIA prompt, select a hosted inference provider, and
create the sandbox named `arcflash-copilot`. Follow the current
[NVIDIA quickstart](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/get-started/quickstart)
instead of automating interactive acceptance. An NVIDIA, OpenAI, Anthropic,
Gemini, or OpenRouter inference key is separate from the H Computer key.

Confirm the CLI path is one of the paths in `arcflash.service`:

```bash
command -v nemoclaw
nemoclaw arcflash-copilot status
exit
```

If the installer reports a different CLI directory, add that directory to the
service's `PATH` and run `sudo systemctl daemon-reload` before continuing.

## 3. Configure Gradium, register H, and provision the worker

Add the Gradium key to the protected systemd environment, then restart the API.
It stays server-side and is never returned to the browser:

```bash
sudoedit /etc/arcflash/arcflash.env
# Add: GRADIUM_API_KEY=your-gradium-key
sudo chown root:arcflash /etc/arcflash/arcflash.env
sudo chmod 0640 /etc/arcflash/arcflash.env
```

Rotate any H key exposed in chat. Enter the replacement only in the SSH shell;
the setup registers it with the NemoClaw provider and then removes it from the
process environment. It is never required in `/etc/arcflash/arcflash.env`.

```bash
sudo -iu arcflash
cd /opt/arcflash
read -rsp 'H Computer API key: ' HAI_API_KEY
export HAI_API_KEY
printf '\n'
/usr/local/bin/uv run python scripts/bootstrap_nemoclaw.py \
  --sandbox arcflash-copilot --region eu
unset HAI_API_KEY
exit
sudo systemctl restart arcflash
```

For a later H-key rotation, repeat the command with `--replace-credential`.
Make sure the `--region` value matches `HAI_REGION` in
`/etc/arcflash/arcflash.env`.

## 4. Verify

```bash
sudo bash /opt/arcflash/deploy/digitalocean/verify-host.sh
curl -fsS https://arcflash.example.com/api/health
```

Before starting a paid H session, inspect the JSON responses and require:

- `/api/nemoclaw/status`: `ready` and `enforced` are `true`.
- `/api/hcomputer/status`: cloud execution reports ready.
- `/api/gradium/status`: `configured` and `available` are `true`.
- `PUBLIC_APP_URL/study` loads from a separate browser/network.

The OpenShell/NemoClaw management dashboard should stay private. If needed, use
an SSH local-forward rather than opening its port in the Cloud Firewall.

## Updating

```bash
cd /opt/arcflash
sudo -u arcflash git pull --ff-only
sudo env ARCFLASH_DOMAIN=arcflash.example.com HAI_REGION=eu \
  bash deploy/digitalocean/bootstrap-host.sh
```

The bootstrap preserves `/etc/arcflash/arcflash.env`, apart from synchronizing
`PUBLIC_APP_URL` and `HAI_REGION` with its arguments.

## Teardown after the hackathon

The safest teardown is to destroy the dedicated Droplet and any attached volume
or snapshot, then revoke the DigitalOcean, inference-provider, and H Computer
keys. Merely powering a Droplet off does not stop Droplet billing.

If the Droplet must be retained, uninstall NemoClaw while its CLI and runtime
state are still available, then remove ArcFlash:

```bash
sudo -iu arcflash nemoclaw uninstall --yes --delete-models --destroy-user-data
sudo systemctl disable --now arcflash
sudo rm -f /etc/systemd/system/arcflash.service
sudo rm -f /etc/systemd/system/caddy.service.d/arcflash.conf
sudo rm -rf /etc/arcflash /opt/arcflash /opt/arcflash-tools
sudo userdel --remove arcflash
sudo mv /etc/caddy/Caddyfile.before-arcflash /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl restart caddy
```

The bootstrap saves the pre-ArcFlash Caddy configuration at
`/etc/caddy/Caddyfile.before-arcflash`. On a shared host, inspect that backup
before restoring it. Do not remove Docker or Caddy until you have confirmed that
no other workload uses them.
