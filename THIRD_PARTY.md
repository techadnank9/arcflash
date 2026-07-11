# Third-party components

ArcFlash Copilot uses or integrates with the following open-source projects. Refer to each upstream project for its complete license text and notices.

| Project | Use | License |
| --- | --- | --- |
| React | Application UI | MIT |
| Vite | Frontend build tooling | MIT |
| Framer Motion | Interface motion | MIT |
| Lucide | Interface icons | ISC |
| jsPDF | Client-side draft PDF generation | MIT |
| FastAPI | Python HTTP API and OpenAPI surface | MIT |
| Uvicorn | Python ASGI server | BSD-3-Clause |
| Pydantic / pydantic-settings | Runtime configuration and validation | MIT |
| HTTPX | Async API contract tests and SDK transport dependency | BSD-3-Clause |
| hai-agents | H Computer Python SDK for explicit direct-development mode | MIT |
| NVIDIA NemoClaw | Controlled-agent reference stack and CLI integration | Apache-2.0 |
| NVIDIA OpenShell | Sandbox, provider, and policy enforcement runtime | Apache-2.0 |
| pandapower | Power-system and IEC 60909 validation adapter | BSD-3-Clause |
| OpenDSS | Compatible distribution-system validation route | BSD-style |
| LiaungYip/arcflash | IEEE 1584-2018 calculation adapter | MIT |
| Playwright | Browser acceptance testing | Apache-2.0 |

H Computer remains an external hosted computer-use service, and Gradium remains
an external hosted speech-to-text service. NemoClaw and OpenShell are external
runtimes; this repository includes only ArcFlash-specific policy presets, a
bootstrap client, and the sandbox worker.
