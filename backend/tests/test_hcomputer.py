from __future__ import annotations

from typing import Any

import pytest

from arcflash_api.errors import ServiceError
from arcflash_api.hcomputer import HComputerService
from arcflash_api.nemoclaw import NemoClawStatus
from arcflash_api.settings import Settings


class FakeRuntime:
    def __init__(self, ready: bool = True) -> None:
        self.ready = ready

    async def status(self, *, refresh: bool = False) -> NemoClawStatus:
        del refresh
        return NemoClawStatus(
            available=self.ready,
            configured=self.ready,
            ready=self.ready,
            sandboxName="arcflash-copilot",
            phase="Ready" if self.ready else "unavailable",
            sandboxReady=self.ready,
            policyApplied=self.ready,
            providerAttached=self.ready,
            workerReady=self.ready,
            mode="required",
            enforced=self.ready,
            message="ready" if self.ready else "unavailable",
        )


class FakeGateway:
    def __init__(self) -> None:
        self.prompt = ""

    async def create(self, prompt: str) -> Any:
        self.prompt = prompt
        return {"id": "h-1", "status": {"status": "pending"}}

    async def get(self, session_id: str) -> Any:
        return {"id": session_id, "status": {"status": "running"}}

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        del session_id, from_index, wait_seconds
        return None

    async def pause(self, session_id: str) -> Any:
        return {"id": session_id, "status": "paused"}

    async def resume(self, session_id: str) -> Any:
        return {"id": session_id, "status": "running"}

    async def cancel(self, session_id: str) -> Any:
        return {"id": session_id, "status": "interrupted"}


def settings(**values: object) -> Settings:
    return Settings(
        _env_file=None,
        public_app_url="https://arcflash.example.com",
        nemoclaw_mode="required",
        **values,
    )


def test_settings_default_to_verified_h_web_surfer_agent() -> None:
    assert Settings(_env_file=None).hcomputer_agent == "h/web-surfer-pro"


@pytest.mark.asyncio
async def test_service_uses_sandbox_gateway_and_builds_scoped_prompt() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(), FakeRuntime(), sandbox_gateway=gateway  # type: ignore[arg-type]
    )
    session = await service.create()
    assert session["id"] == "h-1"
    assert "https://arcflash.example.com/study" in gateway.prompt
    assert "Never invent" in gateway.prompt
    assert "MCC-01" in gateway.prompt


@pytest.mark.asyncio
async def test_changes_preserve_legacy_empty_response_contract() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(), FakeRuntime(), sandbox_gateway=gateway  # type: ignore[arg-type]
    )
    assert await service.changes("h-1", 0, 1) == {"new_events": [], "status": "running"}


@pytest.mark.asyncio
async def test_status_never_claims_sandbox_when_runtime_is_unavailable() -> None:
    service = HComputerService(settings(), FakeRuntime(ready=False))  # type: ignore[arg-type]
    state = await service.status()
    assert state["configured"] is False
    assert state["mode"] == "demo"
    assert state["agent"] == "h/web-surfer-pro"
    assert "deterministic" in state["message"]


@pytest.mark.asyncio
async def test_direct_gateway_requires_explicit_off_mode() -> None:
    direct = FakeGateway()
    sandbox = FakeGateway()
    configured = Settings(
        _env_file=None,
        public_app_url="https://arcflash.example.com",
        nemoclaw_mode="off",
        hai_api_key="test-only-token",
    )
    service = HComputerService(
        configured,
        FakeRuntime(ready=False),  # type: ignore[arg-type]
        direct_gateway=direct,
        sandbox_gateway=sandbox,
    )
    await service.create()
    assert "CV-104" in direct.prompt
    assert sandbox.prompt == ""
    state = await service.status()
    assert state["mode"] == "cloud"


@pytest.mark.asyncio
async def test_session_controls_and_single_flight_guard() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(), FakeRuntime(), sandbox_gateway=gateway  # type: ignore[arg-type]
    )
    session = await service.create()
    assert await service.pause(session["id"]) == {"id": "h-1", "status": "paused"}
    assert await service.resume(session["id"]) == {"id": "h-1", "status": "running"}
    with pytest.raises(ServiceError) as active:
        await service.create()
    assert getattr(active.value, "code", None) == "HCOMPUTER_SESSION_ACTIVE"
    assert await service.cancel(session["id"]) == {"id": "h-1", "status": "interrupted"}
    assert (await service.create())["id"] == "h-1"
