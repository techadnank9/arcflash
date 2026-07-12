from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from arcflash_api.main import create_app
from arcflash_api.nemoclaw import NemoClawRuntime
from arcflash_api.settings import Settings


DEMO_HEADERS = {"X-ArcFlash-Demo": "electrisim-public-v1"}


class FakeElectrisimService:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []

    async def create_electrisim(self) -> dict[str, object]:
        self.calls.append(("create",))
        return {
            "id": "h-public-1",
            "status": {"status": "pending"},
            "agent_view_url": "https://platform.hcompany.ai/agents/sessions/h-public-1",
            "workflow": {
                "id": "electrisim-public-unsaved-single-line-v6",
                "mode": "public-unsaved-draw",
                "checkpoints": [],
            },
        }

    async def get_electrisim(self, session_id: str) -> dict[str, object]:
        self.calls.append(("get", session_id))
        return {"id": session_id, "status": {"status": "running"}}

    async def changes_electrisim(
        self, session_id: str, from_index: int, wait_seconds: int
    ) -> dict[str, object]:
        self.calls.append(("changes", session_id, from_index, wait_seconds))
        return {"new_events": [], "status": "running"}

    async def pause_electrisim(self, session_id: str) -> dict[str, str]:
        self.calls.append(("pause", session_id))
        return {"id": session_id, "status": "paused"}

    async def resume_electrisim(self, session_id: str) -> dict[str, str]:
        self.calls.append(("resume", session_id))
        return {"id": session_id, "status": "running"}

    async def cancel_electrisim(self, session_id: str) -> dict[str, str]:
        self.calls.append(("cancel", session_id))
        return {"id": session_id, "status": "interrupted"}

    async def screenshot_electrisim(
        self, session_id: str, source: str
    ) -> tuple[bytes, str]:
        self.calls.append(("screenshot", session_id, source))
        return b"\x89PNG\r\n\x1a\nframe", "image/png"


class FakeCalculationService:
    async def calculate(self) -> dict[str, object]:
        return {
            "project": "CV-104 Conveyor Electrical Distribution",
            "engines": {"short_circuit": "pandapower / IEC 60909"},
            "results": [],
        }


def make_app(service: FakeElectrisimService) -> Any:
    settings = Settings(_env_file=None, nemoclaw_mode="required")
    runtime = NemoClawRuntime(settings, executable="")
    return create_app(
        settings,
        runtime=runtime,
        service=service,  # type: ignore[arg-type]
        calculation_service=FakeCalculationService(),  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_dedicated_electrisim_session_routes() -> None:
    service = FakeElectrisimService()
    app = make_app(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/electrisim/sessions", headers=DEMO_HEADERS)
        snapshot = await client.get("/api/electrisim/sessions/h-public-1")
        changes = await client.get(
            "/api/electrisim/sessions/h-public-1/changes?from_index=4&wait_for_seconds=2"
        )
        paused = await client.post(
            "/api/electrisim/sessions/h-public-1/pause", headers=DEMO_HEADERS
        )
        resumed = await client.post(
            "/api/electrisim/sessions/h-public-1/resume", headers=DEMO_HEADERS
        )
        cancelled = await client.delete(
            "/api/electrisim/sessions/h-public-1", headers=DEMO_HEADERS
        )

    assert created.status_code == 201
    assert created.json()["workflow"] == {
        "id": "electrisim-public-unsaved-single-line-v6",
        "mode": "public-unsaved-draw",
        "checkpoints": [],
    }
    assert snapshot.json()["status"]["status"] == "running"
    assert changes.json() == {"new_events": [], "status": "running"}
    assert paused.json()["status"] == "paused"
    assert resumed.json()["status"] == "running"
    assert cancelled.json()["status"] == "interrupted"
    assert ("changes", "h-public-1", 4, 2) in service.calls


@pytest.mark.asyncio
async def test_electrisim_changes_query_validation_matches_existing_contract() -> None:
    service = FakeElectrisimService()
    app = make_app(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/electrisim/sessions/h-public-1/changes?wait_for_seconds=26"
        )

    assert response.status_code == 422
    assert not any(call[0] == "changes" for call in service.calls)


@pytest.mark.asyncio
async def test_screenshot_proxy_uses_json_body_and_returns_no_store_png() -> None:
    service = FakeElectrisimService()
    app = make_app(service)
    source = (
        "https://agp.hcompany.ai/api/v1/trajectories/h-public-1/"
        "resources/frame.png"
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/electrisim/sessions/h-public-1/screenshots",
            json={"source": source},
            headers=DEMO_HEADERS,
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.content.startswith(b"\x89PNG")
    assert ("screenshot", "h-public-1", source) in service.calls


@pytest.mark.asyncio
async def test_independent_cv104_calculation_route() -> None:
    service = FakeElectrisimService()
    app = make_app(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/electrisim/calculations/cv104", headers=DEMO_HEADERS
        )

    assert response.status_code == 200
    assert response.json()["project"] == "CV-104 Conveyor Electrical Distribution"
    assert response.json()["engines"]["short_circuit"].startswith("pandapower")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    (
        ("POST", "/api/electrisim/sessions", {}),
        ("POST", "/api/electrisim/sessions/h-public-1/pause", {}),
        ("POST", "/api/electrisim/sessions/h-public-1/resume", {}),
        ("DELETE", "/api/electrisim/sessions/h-public-1", {}),
        (
            "POST",
            "/api/electrisim/sessions/h-public-1/screenshots",
            {"json": {"source": "https://agp.hcompany.ai/frame.png"}},
        ),
        ("POST", "/api/electrisim/calculations/cv104", {}),
    ),
)
async def test_electrisim_mutations_require_custom_demo_header(
    method: str, path: str, kwargs: dict[str, object]
) -> None:
    service = FakeElectrisimService()
    app = make_app(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        missing = await client.request(method, path, **kwargs)
        wrong = await client.request(
            method,
            path,
            headers={"X-ArcFlash-Demo": "wrong-demo"},
            **kwargs,
        )

    for response in (missing, wrong):
        assert response.status_code == 403
        assert response.json()["code"] == "ELECTRISIM_DEMO_HEADER_REQUIRED"
    assert service.calls == []
