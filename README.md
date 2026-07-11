# ArcFlash Copilot

An evidence-first computer-use agent for arc-flash report preparation. It operates a stable engineering workbench, captures traceable study evidence, assembles a draft report, and stops at an explicit engineer approval gate.

> **The agent handles the clicks. The engineer keeps the judgment.**

This is a hackathon MVP, not an arc-flash calculation engine and not a substitute for a qualified professional engineer.

## What is implemented

- CV-104 project workspace with revision, study case, one-line model, and source files
- Typed or voice-style task entry and resolved nine-step agent plan
- Isolated-session boot sequence and application/file allowlist
- Live computer-use cockpit with a realistic browser-operated study workbench
- Deterministic offline replay for reliable demos
- Server-side H Computer session adapter using H's visual browser agent
- Evidence register with source screen, screenshot, value, action, timestamp, and confidence
- Three captured equipment results: `SWGR-01`, `MCC-01`, and `CV-104`
- Deliberate `MCC-01` clearing-time exception stored as `null`; no invented value
- Watermarked seven-section report preview separating facts, narrative, and engineer content
- Append-only session audit trail
- Hard engineer approval gate with automatic approval revocation after recapture
- Downloadable multi-page PDF marked `DRAFT FOR ENGINEERING REVIEW — NOT APPROVED FOR ISSUE`
- Dedicated `/study` target designed for reliable visual operation by H Computer
- Reproducible open-source validation adapter using pandapower and `LiaungYip/arcflash`
- Desktop and mobile layouts, keyboard focus, reduced-motion support, and print styles

## Quick start

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The primary flow works with no API key. Click the suggested command or microphone, review the plan, start the secure run, acknowledge the MCC-01 exception, approve the internal-review draft, and export the PDF.

## H Computer integration

H Computer is connected through the Node server so the API key never enters the browser bundle.

1. Copy `.env.example` to `.env.local`.
2. Set a new `HAI_API_KEY` server-side.
3. Deploy the full Node app and set `PUBLIC_APP_URL` to its public HTTPS origin.
4. Start a run. The app creates an `h/web-surfer-flash` session against:

   ```text
   {PUBLIC_APP_URL}/study?operator=h-computer&project=CV-104
   ```

The H target uses semantic labels, fixed controls, large click targets, and a deterministic path:

```text
Open CV-104 → Verify Study Case A → Open Arc Flash
→ Capture SWGR-01 → Flag + capture MCC-01 → Capture CV-104
→ Generate draft → Stop at engineer review
```

H cloud browsers cannot reach a local-only `localhost` page. If `PUBLIC_APP_URL` is absent or the cloud session fails, the app visibly switches to `DETERMINISTIC REPLAY`; it does not pretend a cloud session is live.

Relevant endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/hcomputer/status` | Safe configuration status; never returns the key |
| `POST /api/hcomputer/sessions` | Start the visual H browser session |
| `GET /api/hcomputer/sessions/:id` | Read the H session snapshot |
| `GET /api/hcomputer/sessions/:id/changes` | Read incremental H events |
| `GET /api/health` | Deployment health check |

## Open-source study adapter

The demo source screens remain the evidence of record. A separate adapter produces comparison data without silently overwriting those values:

- **pandapower 3.4.0** — the CV-104 network and IEC 60909 three-phase fault currents
- **LiaungYip/arcflash 0.1.0** — IEEE 1584-2018 arcing current, incident energy, and boundary calculation
- **OpenDSS** — represented as a compatible distribution-study route and recommended second-engine validation layer

Run the adapter:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r engine/requirements.txt
python engine/generate_cv104_study.py
```

Output is written to `engine/output/cv104_validation.json`. The adapter intentionally refuses to calculate MCC-01 incident energy when protective-device clearing time is missing.

## Architecture

```text
Engineer command
      │
      ├── voice/text adapter ── task plan
      │
      ├── secure execution boundary
      │         └── allowlisted apps + /projects/CV-104 + audit
      │
      └── H Computer visual browser
                └── /study workbench
                       ├── open-source study data
                       ├── result capture + provenance
                       └── exception detection
                                │
                                ▼
                         report assembler
                                │
                                ▼
                       ENGINEER APPROVAL GATE
                                │
                                ▼
                      watermarked review PDF
```

The React app uses one deterministic session state machine:

```text
home → plan → booting → running → review_required
                                  │
                                  └── explicit acknowledgement
                                               ↓
                                    approved_for_draft_export → exported
```

Any recapture request after approval revokes the approval and returns the package to `review_required`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Full browser acceptance test (requires the production server and system Chrome):

```bash
npm run build
npm start
# in another terminal
npm run qa:flow
```

`qa:flow` verifies:

- the complete user flow
- three unique evidence records
- the visible MCC-01 warning
- export disabled before review
- explicit engineer acknowledgement
- a real non-empty `%PDF` download
- the complete H Computer `/study` target workflow

Set `CHROME_PATH` or `QA_BASE_URL` if your environment differs from the defaults.

## Demo script

1. “Arc-flash engineers spend hours navigating legacy software and copying results into reports.”
2. Enter or speak: “Generate the draft arc-flash report for CV-104.”
3. Start the isolated run and let the workbench collect three records.
4. Point out that MCC-01 has no breaker clearing time and the agent did not invent one.
5. Approve the remaining content for internal-review export.
6. Export the permanently watermarked PDF.
7. Close with: “The agent handles the clicks. The engineer keeps the judgment.”

## Safety boundaries

- No automatic engineering judgment
- No protection-device setting recommendations
- No final or stamped report
- No export before explicit engineer acknowledgement
- Missing values remain `null`
- Recapture or evidence changes revoke prior approval
- Every exported page remains marked as a draft
- API credentials remain server-side and are excluded from Git

## Key files

- `src/App.tsx` — product state machine and complete workflow
- `src/components/OperatorWorkbench.tsx` — browser target for H Computer
- `src/components/ReportPreview.tsx` — evidence-linked review document
- `src/lib/report.ts` — guarded PDF generator
- `src/lib/safety.ts` — approval/export invariants
- `server/index.ts` — H Computer server adapter
- `engine/generate_cv104_study.py` — pandapower + IEEE 1584 adapter
- `scripts/qa-flow.mjs` — browser acceptance test

## Upstream documentation

- [H Computer-Use Agents quickstart](https://hub.hcompany.ai/computer-use-agents/quickstart)
- [H browser environment configuration](https://hub.hcompany.ai/computer-use-agents/browser/configuration)
- [pandapower](https://www.pandapower.org/)
- [OpenDSS](https://opendss.epri.com/IntroductiontoOpenDSS.html)
- [LiaungYip/arcflash](https://github.com/LiaungYip/arcflash)
