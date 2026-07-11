from __future__ import annotations

import json
from typing import Any

import httpx

from .errors import ServiceError
from .settings import Settings


GRADIUM_STT_URL = "https://api.gradium.ai/api/post/speech/asr"
MAX_AUDIO_BYTES = 2 * 1024 * 1024
ALLOWED_AUDIO_TYPES = frozenset(
    {
        "audio/ogg",
        "audio/opus",
        "audio/pcm",
        "audio/wav",
    }
)


def normalize_audio_type(content_type: str | None) -> str:
    """Return a Gradium-supported MIME type without optional parameters."""

    media_type = (content_type or "").partition(";")[0].strip().lower()
    if media_type not in ALLOWED_AUDIO_TYPES:
        raise ServiceError(
            415,
            "GRADIUM_AUDIO_TYPE_UNSUPPORTED",
            "Audio must use one of the supported content types: "
            + ", ".join(sorted(ALLOWED_AUDIO_TYPES))
            + ".",
        )
    return media_type


def validate_audio_size(size: int) -> None:
    if size == 0:
        raise ServiceError(
            400,
            "GRADIUM_AUDIO_EMPTY",
            "Audio content is required.",
        )
    if size > MAX_AUDIO_BYTES:
        raise ServiceError(
            413,
            "GRADIUM_AUDIO_TOO_LARGE",
            "Audio content must not exceed 2 MiB.",
        )


class GradiumService:
    """Server-side adapter for Gradium's one-shot speech-to-text API."""

    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    async def status(self) -> dict[str, Any]:
        configured = self._api_key() is not None
        return {
            "configured": configured,
            "available": configured,
            "provider": "gradium",
            "mode": "cloud" if configured else "disabled",
            "maxAudioBytes": MAX_AUDIO_BYTES,
            "message": (
                "Gradium speech transcription is configured."
                if configured
                else "Add GRADIUM_API_KEY to enable Gradium speech transcription."
            ),
        }

    async def transcribe(self, audio: bytes, content_type: str) -> dict[str, str]:
        media_type = normalize_audio_type(content_type)
        validate_audio_size(len(audio))

        api_key = self._api_key()
        if api_key is None:
            raise ServiceError(
                503,
                "GRADIUM_NOT_CONFIGURED",
                "Gradium speech transcription is not configured.",
            )

        try:
            response = await self._post(audio, media_type, api_key)
        except httpx.TimeoutException:
            raise ServiceError(
                504,
                "GRADIUM_TRANSCRIPTION_TIMEOUT",
                "Gradium speech transcription timed out.",
            ) from None
        except httpx.RequestError:
            raise ServiceError(
                502,
                "GRADIUM_TRANSCRIPTION_FAILED",
                "Gradium speech transcription is temporarily unavailable.",
            ) from None

        if response.is_error:
            raise ServiceError(
                502,
                "GRADIUM_TRANSCRIPTION_FAILED",
                "Gradium speech transcription failed.",
            )

        return {"text": _parse_ndjson_text(response.content)}

    def _api_key(self) -> str | None:
        if self.settings.gradium_api_key is None:
            return None
        api_key = self.settings.gradium_api_key.get_secret_value().strip()
        return api_key or None

    async def _post(
        self,
        audio: bytes,
        content_type: str,
        api_key: str,
    ) -> httpx.Response:
        headers = {
            "Content-Type": content_type,
            "x-api-key": api_key,
        }
        if self._client is not None:
            return await self._client.post(
                GRADIUM_STT_URL,
                content=audio,
                headers=headers,
                follow_redirects=True,
                timeout=30.0,
            )

        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            return await client.post(
                GRADIUM_STT_URL,
                content=audio,
                headers=headers,
            )


def _parse_ndjson_text(payload: bytes) -> str:
    text_parts: list[str] = []
    for raw_line in payload.splitlines():
        if not raw_line.strip():
            continue
        try:
            message = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ServiceError(
                502,
                "GRADIUM_RESPONSE_INVALID",
                "Gradium returned an invalid transcription response.",
            ) from None

        if not isinstance(message, dict) or not isinstance(message.get("type"), str):
            raise ServiceError(
                502,
                "GRADIUM_RESPONSE_INVALID",
                "Gradium returned an invalid transcription response.",
            )
        if message["type"] == "error":
            raise ServiceError(
                502,
                "GRADIUM_TRANSCRIPTION_FAILED",
                "Gradium speech transcription failed.",
            )
        if message["type"] != "text":
            continue

        text = message.get("text")
        if not isinstance(text, str):
            raise ServiceError(
                502,
                "GRADIUM_RESPONSE_INVALID",
                "Gradium returned an invalid transcription response.",
            )
        if text := text.strip():
            text_parts.append(text)

    return " ".join(text_parts)
