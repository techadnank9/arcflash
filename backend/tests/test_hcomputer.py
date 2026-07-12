from __future__ import annotations

import base64
from typing import Any
from urllib.parse import urlencode

import httpx
import pytest

from arcflash_api.errors import ServiceError
from arcflash_api.hcomputer import DirectHGateway, HComputerService, MAX_SCREENSHOT_BYTES
from arcflash_api.nemoclaw import NemoClawStatus
from arcflash_api.settings import Settings


SCREENSHOT_BUCKET = "production-agentplatformb-screenshotbucketv2f6e481-kjfhukx6imoq"
SCREENSHOT_HOST = f"{SCREENSHOT_BUCKET}.s3.amazonaws.com"


def screenshot_source(session_id: str, filename: str = "observation-001.png") -> str:
    return (
        f"https://agp.hcompany.ai/api/v1/trajectories/{session_id}/resources/"
        f"{SCREENSHOT_BUCKET}/{session_id}/{filename}"
    )


def screenshot_redirect(session_id: str, filename: str = "observation-001.png") -> str:
    query = urlencode(
        {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": "ASIATESTACCESSKEY/20260711/us-east-1/s3/aws4_request",
            "X-Amz-Date": "20260711T120000Z",
            "X-Amz-Expires": "900",
            "X-Amz-SignedHeaders": "host",
            "X-Amz-Signature": "a" * 64,
            "X-Amz-Security-Token": "temporary-session-token",
        }
    )
    return f"https://{SCREENSHOT_HOST}/{session_id}/{filename}?{query}"


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
        self.screenshot_source = ""
        self.changes_response: Any = None

    async def create(self, prompt: str) -> Any:
        self.prompt = prompt
        return {"id": "h-1", "status": {"status": "pending"}}

    async def get(self, session_id: str) -> Any:
        return {"id": session_id, "status": {"status": "running"}}

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        del session_id, from_index, wait_seconds
        return self.changes_response

    async def pause(self, session_id: str) -> Any:
        return {"id": session_id, "status": "paused"}

    async def resume(self, session_id: str) -> Any:
        return {"id": session_id, "status": "running"}

    async def cancel(self, session_id: str) -> Any:
        return {"id": session_id, "status": "interrupted"}

    async def screenshot(self, session_id: str, source: str) -> Any:
        del session_id
        self.screenshot_source = source
        png = b"\x89PNG\r\n\x1a\npublic-demo-frame"
        return {
            "media_type": "image/png",
            "data_base64": base64.b64encode(png).decode("ascii"),
        }


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


@pytest.mark.asyncio
async def test_electrisim_uses_fixed_unsaved_draw_prompt_and_shared_session_guard() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(), FakeRuntime(), sandbox_gateway=gateway  # type: ignore[arg-type]
    )

    session = await service.create_electrisim()

    assert session["id"] == "h-1"
    assert session["workflow"] == {
        "id": "electrisim-public-unsaved-draw-v1",
        "target": "https://app.electrisim.com/",
        "allowedOrigins": ["https://app.electrisim.com"],
        "mode": "public-unsaved-draw",
        "checkpoints": [
            {"id": "editor", "label": "Open the public Electrisim editor"},
            {"id": "device-dialog-closed", "label": "Close the Device dialog"},
            {
                "id": "palette-items",
                "label": "Locate Line under Bus and Generator ~ under Source",
            },
            {"id": "line-placed", "label": "Draw the Line directly below Bus"},
            {
                "id": "source-placed",
                "label": "Draw Generator (~) directly below Source",
            },
            {
                "id": "visual-confirmation",
                "label": "Visually confirm Line and Generator on the canvas",
            },
            {
                "id": "safe-stop",
                "label": "Stop without connecting, simulating, or saving",
            },
        ],
    }
    assert "Open https://app.electrisim.com/ directly" in gateway.prompt
    assert "only visit app.electrisim.com over HTTPS" in gateway.prompt
    assert "Do not sign in" in gateway.prompt
    assert "close it exactly once using its X or Close control" in gateway.prompt
    assert "without choosing either Create New Diagram or Open Existing Diagram" in gateway.prompt
    assert "Do not open the diagram selection dialog" in gateway.prompt
    assert "canvas already behind it" in gateway.prompt
    assert "do not drag the Bus header" in gateway.prompt
    assert "horizontal gray Line item directly below the Bus header" in gateway.prompt
    assert "one continuous drag-and-drop gesture, not clicks" in gateway.prompt
    assert "press and hold the primary mouse button" in gateway.prompt
    assert "moving right onto the grid directly below Simulate" in gateway.prompt
    assert "Do not click Line and then click the canvas" in gateway.prompt
    assert "repeat that same continuous drag exactly once" in gateway.prompt
    assert "Generator, shown as a tilde (~) directly below the Source header" in gateway.prompt
    assert "same continuous press-hold-move-right-release gesture" in gateway.prompt
    assert "below Simulate beside but not overlapping Line" in gateway.prompt
    assert "do not drag the Source header" in gateway.prompt
    assert "two separate unconnected items" in gateway.prompt
    assert "do not select any category, example, or template" in gateway.prompt
    assert "Simple Example" not in gateway.prompt
    assert "click Create" in gateway.prompt
    assert "do not place any other element" in gateway.prompt
    assert "Do not open or use Simulate" in gateway.prompt
    assert "only claim an item was placed if you visually confirmed it" in gateway.prompt
    assert "never claim that the items were connected, saved, or simulated" in gateway.prompt
    with pytest.raises(ServiceError) as active:
        await service.create()
    assert active.value.code == "HCOMPUTER_SESSION_ACTIVE"


@pytest.mark.asyncio
async def test_electrisim_does_not_require_arcflash_public_app_target() -> None:
    gateway = FakeGateway()
    configured = Settings(_env_file=None, nemoclaw_mode="required")
    service = HComputerService(
        configured,
        FakeRuntime(),  # type: ignore[arg-type]
        sandbox_gateway=gateway,
    )

    assert (await service.create_electrisim())["id"] == "h-1"


@pytest.mark.asyncio
async def test_electrisim_controls_reject_sessions_not_started_by_lab() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(), FakeRuntime(), sandbox_gateway=gateway  # type: ignore[arg-type]
    )
    await service.create_electrisim()

    operations = (
        lambda: service.get_electrisim("other-session"),
        lambda: service.changes_electrisim("other-session", 0, 0),
        lambda: service.pause_electrisim("other-session"),
        lambda: service.resume_electrisim("other-session"),
        lambda: service.cancel_electrisim("other-session"),
    )
    for operation in operations:
        with pytest.raises(ServiceError) as captured:
            await operation()
        assert captured.value.status_code == 404
        assert captured.value.code == "ELECTRISIM_SESSION_NOT_FOUND"

    assert await service.cancel_electrisim("h-1") == {
        "id": "h-1",
        "status": "interrupted",
    }
    with pytest.raises(ServiceError) as cancelled:
        await service.get_electrisim("h-1")
    assert cancelled.value.code == "ELECTRISIM_SESSION_NOT_FOUND"


@pytest.mark.asyncio
async def test_electrisim_successful_start_has_global_cooldown() -> None:
    gateway = FakeGateway()
    now = [100.0]
    service = HComputerService(
        settings(),
        FakeRuntime(),  # type: ignore[arg-type]
        sandbox_gateway=gateway,
        clock=lambda: now[0],
        electrisim_start_cooldown_seconds=300,
    )

    await service.create_electrisim()
    await service.cancel_electrisim("h-1")

    with pytest.raises(ServiceError) as cooling_down:
        await service.create_electrisim()
    assert cooling_down.value.status_code == 429
    assert cooling_down.value.code == "ELECTRISIM_SESSION_COOLDOWN"
    assert cooling_down.value.detail == {"retryAfterSeconds": 300}

    now[0] += 300
    assert (await service.create_electrisim())["id"] == "h-1"


@pytest.mark.asyncio
async def test_electrisim_screenshot_is_session_and_host_scoped() -> None:
    gateway = FakeGateway()
    service = HComputerService(
        settings(hai_region="us"),
        FakeRuntime(),  # type: ignore[arg-type]
        sandbox_gateway=gateway,
    )
    source = screenshot_source("h-1")

    await service.create_electrisim()
    with pytest.raises(ServiceError) as not_observed:
        await service.screenshot_electrisim("h-1", source)
    assert not_observed.value.code == "ELECTRISIM_SCREENSHOT_NOT_OBSERVED"
    gateway.changes_response = {
        "new_events": [
            {
                "type": "AgentEvent",
                "data": {"kind": "observation_event", "image": {"source": source}},
            }
        ]
    }
    await service.changes_electrisim("h-1", 0, 0)

    content, media_type = await service.screenshot_electrisim("h-1", source)

    assert content.startswith(b"\x89PNG")
    assert media_type == "image/png"
    assert gateway.screenshot_source == source

    invalid_sources = (
        "https://example.com/api/v1/trajectories/h-1/resources/frame.png",
        "https://agp.hcompany.ai/api/v1/trajectories/other/resources/frame.png",
        "https://agp.hcompany.ai/api/v1/trajectories/h-1/resources/bucket/other/frame.png",
        screenshot_source("h-1").replace(SCREENSHOT_BUCKET, "another-bucket"),
        screenshot_source("h-1").replace("observation-001.png", "frame.jpg"),
        screenshot_source("h-1").replace("observation-001.png", "../secret.png"),
    )
    for invalid_source in invalid_sources:
        with pytest.raises(ServiceError) as captured:
            await service.screenshot_electrisim("h-1", invalid_source)
        assert captured.value.code == "ELECTRISIM_SCREENSHOT_SOURCE_INVALID"


@pytest.mark.asyncio
async def test_direct_screenshot_uses_auth_only_for_h_then_fetches_signed_s3_png() -> None:
    source = screenshot_source("h-1")
    redirect = screenshot_redirect("h-1")
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if str(request.url) == source:
            assert request.headers["authorization"] == "Bearer direct-test-token"
            return httpx.Response(302, headers={"Location": redirect})
        assert str(request.url) == redirect
        assert "authorization" not in request.headers
        return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nlive-browser-frame")

    gateway = DirectHGateway(
        Settings(
            _env_file=None,
            hai_region="us",
            hai_api_key="direct-test-token",
            nemoclaw_mode="off",
        ),
        screenshot_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=False
        ),
    )

    payload = await gateway.screenshot("h-1", source)

    assert len(requests) == 2
    assert base64.b64decode(payload["data_base64"]).startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_direct_screenshot_rejects_bad_or_chained_redirects() -> None:
    source = screenshot_source("h-1")
    valid_redirect = screenshot_redirect("h-1")
    invalid_redirects = (
        valid_redirect.replace(SCREENSHOT_HOST, "example.com"),
        valid_redirect.replace("/h-1/observation-001.png", "/other/observation-001.png"),
        valid_redirect.split("?", 1)[0],
        valid_redirect.replace("AWS4-HMAC-SHA256", "AWS4-HMAC-SHA1"),
        f"{valid_redirect}&X-Amz-Signature={'b' * 64}",
    )

    for redirect in invalid_redirects:
        async def invalid_handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url) == source
            return httpx.Response(302, headers={"Location": redirect})

        gateway = DirectHGateway(
            Settings(
                _env_file=None,
                hai_region="us",
                hai_api_key="direct-test-token",
                nemoclaw_mode="off",
            ),
            screenshot_client_factory=lambda: httpx.AsyncClient(
                transport=httpx.MockTransport(invalid_handler), follow_redirects=False
            ),
        )
        with pytest.raises(ServiceError) as captured:
            await gateway.screenshot("h-1", source)
        assert captured.value.code == "ELECTRISIM_SCREENSHOT_INVALID"

    seen_s3_auth: list[str | None] = []

    async def chained_handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == source:
            return httpx.Response(302, headers={"Location": valid_redirect})
        seen_s3_auth.append(request.headers.get("authorization"))
        return httpx.Response(302, headers={"Location": "https://example.com/escape.png"})

    chained_gateway = DirectHGateway(
        Settings(
            _env_file=None,
            hai_region="us",
            hai_api_key="direct-test-token",
            nemoclaw_mode="off",
        ),
        screenshot_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(chained_handler), follow_redirects=False
        ),
    )
    with pytest.raises(ServiceError) as chained:
        await chained_gateway.screenshot("h-1", source)
    assert chained.value.code == "ELECTRISIM_SCREENSHOT_FAILED"
    assert seen_s3_auth == [None]


@pytest.mark.asyncio
async def test_direct_screenshot_bounds_presigned_png_to_five_mib() -> None:
    source = screenshot_source("h-1")
    redirect = screenshot_redirect("h-1")

    async def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == source:
            return httpx.Response(302, headers={"Location": redirect})
        return httpx.Response(
            200,
            headers={"Content-Length": str(MAX_SCREENSHOT_BYTES + 1)},
            content=b"",
        )

    gateway = DirectHGateway(
        Settings(
            _env_file=None,
            hai_region="us",
            hai_api_key="direct-test-token",
            nemoclaw_mode="off",
        ),
        screenshot_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=False
        ),
    )

    with pytest.raises(ServiceError) as captured:
        await gateway.screenshot("h-1", source)
    assert captured.value.code == "ELECTRISIM_SCREENSHOT_INVALID"
