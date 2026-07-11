from __future__ import annotations

from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from arcflash_api.errors import ServiceError
from arcflash_api.gradium import GRADIUM_STT_URL, MAX_AUDIO_BYTES, GradiumService
from arcflash_api.main import create_app
from arcflash_api.nemoclaw import NemoClawRuntime
from arcflash_api.settings import Settings


def make_settings(**values: object) -> Settings:
    return Settings(_env_file=None, nemoclaw_mode="required", **values)


class FakeGradiumService:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, str]] = []

    async def status(self) -> dict[str, Any]:
        return {"configured": True, "provider": "gradium"}

    async def transcribe(self, audio: bytes, content_type: str) -> dict[str, str]:
        self.calls.append((audio, content_type))
        return {"text": "Generate the draft report."}


def app_with_gradium(service: FakeGradiumService) -> Any:
    configured = make_settings()
    runtime = NemoClawRuntime(configured, executable="")
    return create_app(
        configured,
        runtime=runtime,
        gradium_service=service,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_status_reports_configuration_without_exposing_secret() -> None:
    secret = "gd_test_secret_value"
    service = GradiumService(make_settings(gradium_api_key=secret))

    status = await service.status()

    assert status["configured"] is True
    assert status["provider"] == "gradium"
    assert secret not in str(status)


@pytest.mark.asyncio
async def test_blank_api_key_is_not_configured() -> None:
    service = GradiumService(make_settings(gradium_api_key=" "))

    status = await service.status()

    assert status["configured"] is False
    with pytest.raises(ServiceError) as captured:
        await service.transcribe(b"RIFF", "audio/wav")
    assert captured.value.code == "GRADIUM_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_transcribe_forwards_supported_audio_and_parses_ndjson() -> None:
    secret = "gd_test_secret_value"
    audio = b"RIFF-test-audio"

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == GRADIUM_STT_URL
        assert request.method == "POST"
        assert request.headers["content-type"] == "audio/wav"
        assert request.headers["x-api-key"] == secret
        assert request.content == audio
        return httpx.Response(
            200,
            headers={"content-type": "application/x-ndjson"},
            content=(
                b'{"type":"text","text":"Generate the draft"}\n'
                b'{"type":"end_text","stop_s":1.2}\n'
                b'{"type":"text","text":"report."}\n'
            ),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = GradiumService(
            make_settings(gradium_api_key=secret),
            client=client,
        )
        result = await service.transcribe(audio, "audio/wav; charset=binary")

    assert result == {"text": "Generate the draft report."}


@pytest.mark.asyncio
async def test_transcribe_returns_stable_error_without_upstream_secret() -> None:
    secret = "gd_test_secret_value"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"rejected {secret}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = GradiumService(
            make_settings(gradium_api_key=secret),
            client=client,
        )
        with pytest.raises(ServiceError) as captured:
            await service.transcribe(b"RIFF", "audio/wav")

    assert captured.value.status_code == 502
    assert captured.value.code == "GRADIUM_TRANSCRIPTION_FAILED"
    assert secret not in str(captured.value)
    assert captured.value.detail is None


@pytest.mark.asyncio
async def test_api_status_and_transcription_use_injected_service() -> None:
    service = FakeGradiumService()
    app = app_with_gradium(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        status = await client.get("/api/gradium/status")
        transcript = await client.post(
            "/api/gradium/transcribe",
            content=b"OggS-test-audio",
            headers={"Content-Type": "audio/ogg; codecs=opus"},
        )

    assert status.status_code == 200
    assert status.json() == {"configured": True, "provider": "gradium"}
    assert transcript.status_code == 200
    assert transcript.json() == {"text": "Generate the draft report."}
    assert service.calls == [(b"OggS-test-audio", "audio/ogg")]


@pytest.mark.asyncio
@pytest.mark.parametrize("content_type", [None, "text/plain", "audio/webm"])
async def test_api_rejects_unsupported_audio_types(content_type: str | None) -> None:
    service = FakeGradiumService()
    app = app_with_gradium(service)
    headers = {"Content-Type": content_type} if content_type is not None else {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/gradium/transcribe",
            content=b"not-forwarded",
            headers=headers,
        )

    assert response.status_code == 415
    assert response.json()["code"] == "GRADIUM_AUDIO_TYPE_UNSUPPORTED"
    assert service.calls == []


@pytest.mark.asyncio
async def test_api_rejects_empty_and_oversized_audio_before_forwarding() -> None:
    service = FakeGradiumService()
    app = app_with_gradium(service)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        empty = await client.post(
            "/api/gradium/transcribe",
            content=b"",
            headers={"Content-Type": "audio/wav"},
        )
        oversized = await client.post(
            "/api/gradium/transcribe",
            content=b"x" * (MAX_AUDIO_BYTES + 1),
            headers={"Content-Type": "audio/pcm"},
        )

    assert empty.status_code == 400
    assert empty.json()["code"] == "GRADIUM_AUDIO_EMPTY"
    assert oversized.status_code == 413
    assert oversized.json()["code"] == "GRADIUM_AUDIO_TOO_LARGE"
    assert service.calls == []


@pytest.mark.asyncio
async def test_api_reports_missing_gradium_configuration() -> None:
    configured = make_settings()
    runtime = NemoClawRuntime(configured, executable="")
    app = create_app(configured, runtime=runtime)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/gradium/transcribe",
            content=b"RIFF",
            headers={"Content-Type": "audio/wav"},
        )

    assert response.status_code == 503
    assert response.json() == {
        "code": "GRADIUM_NOT_CONFIGURED",
        "message": "Gradium speech transcription is not configured.",
    }
