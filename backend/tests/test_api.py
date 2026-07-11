from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from arcflash_api.main import create_app
from arcflash_api.nemoclaw import NemoClawRuntime
from arcflash_api.settings import Settings


def make_settings(**values: object) -> Settings:
    return Settings(_env_file=None, nemoclaw_mode="required", **values)


@pytest.mark.asyncio
async def test_health_and_runtime_status_without_local_nemoclaw() -> None:
    configured = make_settings()
    runtime = NemoClawRuntime(configured, executable="")
    app = create_app(configured, runtime=runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        health = await client.get("/api/health")
        sandbox = await client.get("/api/nemoclaw/status")
        hcomputer = await client.get("/api/hcomputer/status")
    assert health.status_code == 200
    assert health.json()["runtime"] == "python"
    assert sandbox.json()["ready"] is False
    assert hcomputer.json()["mode"] == "demo"


@pytest.mark.asyncio
async def test_session_creation_fails_with_stable_configuration_error() -> None:
    configured = make_settings()
    runtime = NemoClawRuntime(configured, executable="")
    app = create_app(configured, runtime=runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/hcomputer/sessions")
    assert response.status_code == 503
    assert response.json() == {
        "code": "HCOMPUTER_NOT_CONFIGURED",
        "message": "H Computer requires a publicly reachable PUBLIC_APP_URL. Use deterministic demo mode on localhost.",
    }


@pytest.mark.asyncio
async def test_changes_query_is_validated_before_execution() -> None:
    configured = make_settings()
    runtime = NemoClawRuntime(configured, executable="")
    app = create_app(configured, runtime=runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/hcomputer/sessions/h-1/changes?from_index=-1")
    assert response.status_code == 422
