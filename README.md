# ArcFlash Copilot

An evidence-first computer-use agent for preparing draft arc-flash reports. It operates a stable engineering workbench, captures traceable results, assembles a review package, and stops at an explicit engineer approval gate.

> **The agent handles the clicks. The engineer keeps the judgment.**

This hackathon MVP is not an arc-flash calculation engine, compliance checker, or substitute for a qualified professional engineer.

## What is implemented

- CV-104 project workspace, one-line model, study case, assumptions, and source files
- Browser-operated mock SKM-style study workbench at `/study`
- H Computer hosted-browser integration through a Python control plane
- NemoClaw-controlled Python launcher with scoped workspace, credential injection, H-only egress, and runtime status
- Real microphone transcription through Gradium's server-side speech-to-text API
- Honest deterministic replay whenever H or NemoClaw is unavailable
- Evidence register with source screen, screenshot, value, action, timestamp, and confidence
- Three captured results: `SWGR-01`, `MCC-01`, and `CV-104`
- Missing `MCC-01` clearing time stored as `null` and flagged for engineer review
- Seven-section report preview, audit trail, approval gate, and watermarked PDF export
- Open-source comparison adapter using pandapower and `LiaungYip/arcflash`

## Monorepo layout

```text
backend/arcflash_api/          FastAPI control plane, H/NemoClaw, and Gradium adapters
infrastructure/nemoclaw/       EU and US least-privilege egress presets
scripts/bootstrap_nemoclaw.py  Safe sandbox provisioning and worker upload
src/                           React application and mock engineering workbench
engine/                        Open-source study comparison adapter
scripts/qa-flow.mjs            End-to-end browser acceptance test
```

The browser-native UI and PDF renderer remain TypeScript. Computer-use orchestration, H API access, runtime checks, provisioning, and study validation are Python.

## Quick start

Requirements: Node.js 20+, Python 3.11+, npm, and [uv](https://docs.astral.sh/uv/).

```bash
npm install
uv sync --extra dev
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The complete product flow works without credentials and is visibly labeled `DETERMINISTIC REPLAY` when no controlled runtime is active.

For a production-style local server:

```bash
npm run build
npm start
```

FastAPI serves both `/api/*` and the built React SPA on port `8787`.

## Gradium voice input

Set `GRADIUM_API_KEY` only in the FastAPI server environment. The microphone
button records at most ten seconds, encodes mono WAV in the browser, and sends
the bounded audio body to FastAPI. FastAPI calls Gradium's REST STT endpoint
with the server-side `x-api-key` header and returns only the transcript. The key
is never included in the React bundle or an API response.

```dotenv
GRADIUM_API_KEY=your-gradium-key
```

Without a key, voice input is visibly unavailable and typed commands continue
to work.

## NemoClaw + H Computer

The enforced execution path is:

```text
React UI
   ↓
FastAPI host control plane
   ↓
nemoclaw <sandbox> exec
   ↓
standard-library Python H worker
   ├── scoped NemoClaw/OpenShell filesystem
   ├── HAI_API_KEY provider placeholder
   └── REST policy: H session endpoints only
   ↓
H Computer API
   ↓
H-hosted visual browser → PUBLIC_APP_URL/study
```

NemoClaw controls the local Python launcher, accessible files, credential exposure, and egress. H Company operates the remote browser on its own infrastructure; that hosted browser process is not inside the local NemoClaw sandbox. The app shows this boundary rather than presenting the demo replay or H cloud browser as locally isolated.

### Runtime modes

| `NEMOCLAW_MODE` | Behavior |
| --- | --- |
| `required` | Default. H endpoints fail closed unless sandbox, policy, credential, and worker probes pass. |
| `preferred` | Uses the controlled worker when ready; otherwise the UI uses deterministic replay. It never silently sends H traffic from the host. |
| `off` | Explicit local-development escape hatch using H's official Python SDK directly from FastAPI. |

### Provision the sandbox

1. Install and onboard a supported NemoClaw sandbox using the [official NVIDIA guide](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/get-started/quickstart). This repository deliberately does not auto-install or auto-accept NemoClaw's third-party notice.

2. Copy `.env.example` to `.env.local`, set the public deployed origin, select the same H region as the policy, and leave `NEMOCLAW_MODE=required`:

   ```dotenv
   PUBLIC_APP_URL=https://your-deployment.example.com
   HAI_REGION=eu
   HCOMPUTER_AGENT=h/web-surfer-pro
   NEMOCLAW_MODE=required
   NEMOCLAW_SANDBOX=arcflash-copilot
   ```

3. Rotate any H key that has appeared in chat, logs, or terminal history. Export the replacement only for provider registration, then run the bootstrap:

   ```bash
   export HAI_API_KEY='your-new-key'
   npm run setup:nemoclaw -- --sandbox arcflash-copilot --region eu
   unset HAI_API_KEY
   ```

   On a later rotation, make the provider replacement explicit:

   ```bash
   export HAI_API_KEY='your-next-rotated-key'
   npm run setup:nemoclaw -- --sandbox arcflash-copilot --region eu --replace-credential
   unset HAI_API_KEY
   ```

The bootstrap performs only supported CLI operations: it finds the onboarded sandbox, registers a generic provider by environment-variable name (not value in argv), applies the selected policy preset, rebuilds so the provider is attached, uploads the one-shot worker, and verifies the final state. It does not install NemoClaw.

`h/web-surfer-pro` is the hosted browser preset verified against this complete workflow. H's preset catalog can change; verify the configured name against the organization-scoped `GET /api/v2/agents` catalog when upgrading the H integration. A session is considered attached only after H returns a non-empty session ID.

OpenShell providers registered through NemoClaw attach to sandboxes rebuilt on the same gateway. Use a dedicated demo gateway when provider scope must be narrow.

### Policy and fail-closed behavior

The checked-in presets allow the Python executable to use only:

- `POST /api/v2/sessions`
- `GET /api/v2/sessions/*`
- `GET /api/v2/sessions/*/changes`
- `POST /api/v2/sessions/*/pause`
- `POST /api/v2/sessions/*/resume`
- `DELETE /api/v2/sessions/*`
- the selected EU or US H hostname on port `443`

`protocol: rest` lets OpenShell enforce method/path rules and replace the credential placeholder at the proxy. The API key is never placed in a browser bundle, task payload, subprocess argv, report, or API status response.

If the CLI, sandbox, policy, provider, or worker is missing, `/api/hcomputer/sessions` returns a structured `503` and the UI continues with a clearly labeled local replay.

### Direct H development mode

Only for local debugging without NemoClaw:

```dotenv
NEMOCLAW_MODE=off
HAI_API_KEY=your-rotated-key
PUBLIC_APP_URL=https://your-public-development-origin.example.com
```

This path uses the official open-source `hai-agents` Python SDK and is visibly labeled `HOST DIRECT`, not sandboxed.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Python service health |
| `GET /api/nemoclaw/status` | Live sandbox, policy, provider, and worker probes |
| `GET /api/hcomputer/status` | Safe execution readiness; never returns credentials |
| `GET /api/gradium/status` | Gradium transcription readiness; never returns credentials |
| `POST /api/gradium/transcribe` | Transcribe a raw WAV/PCM/Ogg/Opus body, limited to 2 MiB |
| `POST /api/hcomputer/sessions` | Start the H visual browser through the selected runtime |
| `GET /api/hcomputer/sessions/{id}` | Read a session snapshot |
| `GET /api/hcomputer/sessions/{id}/changes` | Read incremental session events |
| `POST /api/hcomputer/sessions/{id}/pause` | Pause the hosted H session and local replay together |
| `POST /api/hcomputer/sessions/{id}/resume` | Resume both execution layers |
| `DELETE /api/hcomputer/sessions/{id}` | Cancel the hosted session before stop/reset |
| `GET /api/docs` | FastAPI OpenAPI UI |

H receives a constrained task for the stable target:

```text
Open CV-104 → Verify Study Case A → Open Arc Flash
→ Capture SWGR-01 → Flag + capture MCC-01 → Capture CV-104
→ Generate draft → Stop at engineer review
```

## Open-source study adapter

The UI evidence remains the report source of record. A separate adapter produces comparison data without silently overwriting it:

- **pandapower 3.4.0** — network model and IEC 60909 fault currents
- **LiaungYip/arcflash** — IEEE 1584-2018 arcing current, incident energy, and boundary calculation
- **OpenDSS** — documented as a compatible second-engine validation route

```bash
uv sync --extra study
npm run engine:generate
```

Output is written to `engine/output/cv104_validation.json`. The adapter refuses to calculate MCC-01 incident energy while clearing time is missing.

## Verification

```bash
uv sync --extra dev
uv run pytest
npm run typecheck
npm test
npm run build
```

Full browser acceptance test:

```bash
npm run build
npm start
# in another terminal
npm run qa:flow
```

The browser test covers the complete workflow, three unique evidence records, missing-data warning, locked export, explicit engineer acknowledgement, non-empty PDF download, and the `/study` H target.

For a real sandbox smoke test, provision NemoClaw and confirm:

```bash
curl -s http://localhost:8787/api/nemoclaw/status
curl -s http://localhost:8787/api/gradium/status
nemoclaw arcflash-copilot policy-list
nemoclaw arcflash-copilot logs --tail 100 --since 5m
```

NemoClaw/OpenShell are alpha software. Treat warnings about unavailable kernel controls, policy denials, or degraded runtime state as failures to investigate, not as successful enforcement.

The API also enforces one active H session per process to reduce accidental duplicate paid runs. This remains a hackathon control plane: place mutation endpoints behind engineer authentication and deployment-level rate limits before exposing them beyond a controlled demo environment.

## Safety boundaries

- No automatic engineering judgment or protection-setting recommendations
- No final, stamped, or issue-approved report
- No export before explicit engineer acknowledgement
- Missing values remain `null`
- Recapture or evidence edits revoke prior approval
- Every exported page remains marked as a draft
- API credentials remain outside Git, browser code, job payloads, and logs

## Upstream documentation

- [H Computer-Use Agents Python SDK](https://pypi.org/project/hai-agents/)
- [NVIDIA NemoClaw overview](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/about/overview)
- [NemoClaw CLI reference](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/reference/commands)
- [OpenShell policy schema](https://docs.nvidia.com/openshell/latest/reference/policy-schema)
- [OpenShell providers](https://docs.nvidia.com/openshell/latest/sandboxes/manage-providers)
- [Gradium speech-to-text](https://docs.gradium.ai/guides/speech-to-text-rest)
- [pandapower](https://www.pandapower.org/)
- [OpenDSS](https://opendss.epri.com/IntroductiontoOpenDSS.html)
- [LiaungYip/arcflash](https://github.com/LiaungYip/arcflash)
