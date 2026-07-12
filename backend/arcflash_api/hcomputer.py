from __future__ import annotations

import asyncio
import base64
import binascii
from collections.abc import Callable
import math
import re
import time
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlsplit

import httpx
from fastapi.encoders import jsonable_encoder
from hai_agents import AsyncClient, HaiAgentsEnvironment
from hai_agents.core import ApiError

from .errors import ServiceError
from .nemoclaw import NemoClawRuntime
from .prompts import build_arcflash_prompt, build_electrisim_prompt, electrisim_demo_metadata
from .settings import Settings


MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
SCREENSHOT_FILENAME_PATTERN = re.compile(
    r"(?=.{5,255}\Z)[A-Za-z0-9][A-Za-z0-9._~-]*\.png\Z"
)
SCREENSHOT_BUCKET = "production-agentplatformb-screenshotbucketv2f6e481-kjfhukx6imoq"
SCREENSHOT_BUCKET_HOST = f"{SCREENSHOT_BUCKET}.s3.amazonaws.com"
ELECTRISIM_START_COOLDOWN_SECONDS = 300.0


class HGateway(Protocol):
    async def create(
        self, prompt: str, *, max_steps: int = 25, max_time_s: float = 150
    ) -> Any: ...
    async def get(self, session_id: str) -> Any: ...
    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any: ...
    async def pause(self, session_id: str) -> Any: ...
    async def resume(self, session_id: str) -> Any: ...
    async def cancel(self, session_id: str) -> Any: ...
    async def screenshot(self, session_id: str, source: str) -> Any: ...


class DirectHGateway:
    """Explicit development-only adapter for running outside NemoClaw."""

    def __init__(
        self,
        settings: Settings,
        *,
        screenshot_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self.settings = settings
        self._screenshot_client_factory = screenshot_client_factory or (
            lambda: httpx.AsyncClient(timeout=30, follow_redirects=False)
        )
        api_key = settings.hai_api_key.get_secret_value() if settings.hai_api_key else None
        environment = (
            HaiAgentsEnvironment.US if settings.hai_region == "us" else HaiAgentsEnvironment.EU
        )
        self.client = AsyncClient(
            api_key=api_key,
            environment=environment,
            timeout=30,
            max_retries=2,
        )

    async def create(
        self, prompt: str, *, max_steps: int = 25, max_time_s: float = 150
    ) -> Any:
        return await self.client.sessions.create_session(
            agent=self.settings.hcomputer_agent,
            agent_artifact=self.settings.hcomputer_agent_artifact,
            messages=[{"type": "user_message", "message": prompt}],
            max_steps=max_steps,
            max_time_s=max_time_s,
        )

    async def get(self, session_id: str) -> Any:
        return await self.client.sessions.get_session(session_id)

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        return await self.client.sessions.get_session_changes(
            session_id,
            from_index=from_index,
            include_events=True,
            wait_for_seconds=wait_seconds,
        )

    async def pause(self, session_id: str) -> Any:
        return await self.client.sessions.pause_session(session_id)

    async def resume(self, session_id: str) -> Any:
        return await self.client.sessions.resume_session(session_id)

    async def cancel(self, session_id: str) -> Any:
        return await self.client.sessions.cancel_session(session_id)

    async def screenshot(self, session_id: str, source: str) -> Any:
        filename = _validate_screenshot_source(
            session_id, source, self.settings.h_api_host
        )
        credential = (
            self.settings.hai_api_key.get_secret_value()
            if self.settings.hai_api_key
            else ""
        )
        authenticated_headers = {
            "Authorization": f"Bearer {credential}",
            "Accept": "image/png",
            "User-Agent": "ArcFlash-Copilot/0.2",
        }
        unauthenticated_headers = {
            "Accept": "image/png",
            "User-Agent": "ArcFlash-Copilot/0.2",
        }
        try:
            async with self._screenshot_client_factory() as client:
                async with client.stream(
                    "GET",
                    source,
                    headers=authenticated_headers,
                    follow_redirects=False,
                ) as response:
                    if response.status_code != 302:
                        raise _screenshot_failed()
                    redirect = _validate_screenshot_redirect(
                        response.headers.get("location"), session_id, filename
                    )

                # This is intentionally a fresh request with no H Authorization header.
                # The S3 URL's narrowly validated SigV4 query is its only credential.
                async with client.stream(
                    "GET",
                    redirect,
                    headers=unauthenticated_headers,
                    follow_redirects=False,
                ) as response:
                    if response.status_code != 200:
                        raise _screenshot_failed()
                    content_length = response.headers.get("content-length")
                    if (
                        content_length is not None
                        and content_length.isdecimal()
                        and int(content_length) > MAX_SCREENSHOT_BYTES
                    ):
                        raise _screenshot_invalid("oversized")
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(content) + len(chunk) > MAX_SCREENSHOT_BYTES:
                            raise _screenshot_invalid("oversized")
                        content.extend(chunk)
        except ServiceError:
            raise
        except httpx.HTTPError as error:
            raise _screenshot_failed() from error

        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise _screenshot_invalid("invalid")
        return {
            "media_type": "image/png",
            "data_base64": base64.b64encode(content).decode("ascii"),
        }


class SandboxHGateway:
    def __init__(self, settings: Settings, runtime: NemoClawRuntime) -> None:
        self.settings = settings
        self.runtime = runtime

    async def create(
        self, prompt: str, *, max_steps: int = 25, max_time_s: float = 150
    ) -> Any:
        return await self.runtime.invoke(
            "create",
            {
                "region": self.settings.hai_region,
                "agent": self.settings.hcomputer_agent,
                "agent_artifact": self.settings.hcomputer_agent_artifact,
                "prompt": prompt,
                "max_steps": max_steps,
                "max_time_s": max_time_s,
            },
        )

    async def get(self, session_id: str) -> Any:
        return await self.runtime.invoke(
            "get", {"region": self.settings.hai_region, "session_id": session_id}
        )

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        return await self.runtime.invoke(
            "changes",
            {
                "region": self.settings.hai_region,
                "session_id": session_id,
                "from_index": from_index,
                "wait_for_seconds": wait_seconds,
            },
        )

    async def pause(self, session_id: str) -> Any:
        return await self.runtime.invoke(
            "pause", {"region": self.settings.hai_region, "session_id": session_id}
        )

    async def resume(self, session_id: str) -> Any:
        return await self.runtime.invoke(
            "resume", {"region": self.settings.hai_region, "session_id": session_id}
        )

    async def cancel(self, session_id: str) -> Any:
        return await self.runtime.invoke(
            "cancel", {"region": self.settings.hai_region, "session_id": session_id}
        )

    async def screenshot(self, session_id: str, source: str) -> Any:
        return await self.runtime.invoke(
            "screenshot",
            {
                "region": self.settings.hai_region,
                "session_id": session_id,
                "source": source,
            },
        )


class HComputerService:
    def __init__(
        self,
        settings: Settings,
        runtime: NemoClawRuntime,
        direct_gateway: HGateway | None = None,
        sandbox_gateway: HGateway | None = None,
        clock: Callable[[], float] = time.monotonic,
        electrisim_start_cooldown_seconds: float = ELECTRISIM_START_COOLDOWN_SECONDS,
    ) -> None:
        self.settings = settings
        self.runtime = runtime
        self._direct_gateway = direct_gateway
        self._sandbox_gateway = sandbox_gateway or SandboxHGateway(settings, runtime)
        self._start_lock = asyncio.Lock()
        self._active_session_id: str | None = None
        self._electrisim_session_id: str | None = None
        self._electrisim_screenshot_sources: set[str] = set()
        self._clock = clock
        self._electrisim_start_cooldown_seconds = electrisim_start_cooldown_seconds
        self._last_electrisim_started_at: float | None = None

    async def status(self) -> dict[str, Any]:
        sandbox = await self.runtime.status()
        target_configured = bool(self.settings.public_app_url)
        if self.settings.nemoclaw_mode == "off":
            reachable = bool(self.settings.hai_api_key)
            configured = bool(self.settings.hcomputer_enabled and reachable and target_configured)
            mode = "cloud" if configured else "demo"
            message = (
                "Direct H cloud execution is enabled for development; NemoClaw enforcement is off."
                if configured
                else self._configuration_message(target_configured, sandbox.ready)
            )
        else:
            reachable = sandbox.providerAttached
            configured = bool(
                self.settings.hcomputer_enabled and target_configured and sandbox.ready
            )
            mode = "sandbox" if configured else "demo"
            message = (
                "H requests are launched by the Python worker through the NemoClaw-controlled orchestration layer."
                if configured
                else self._configuration_message(target_configured, sandbox.ready)
            )
        return {
            "configured": configured,
            "reachable": reachable,
            "targetConfigured": target_configured,
            "region": self.settings.hai_region,
            "agent": self.settings.hcomputer_agent,
            "mode": mode,
            "message": message,
            "sandbox": sandbox.as_dict(),
        }

    def _configuration_message(self, target_configured: bool, sandbox_ready: bool) -> str:
        if not self.settings.hcomputer_enabled:
            return "H Computer execution is disabled by configuration."
        if not target_configured:
            return "Add PUBLIC_APP_URL so H's cloud browser can reach the study workbench."
        if self.settings.nemoclaw_mode != "off" and not sandbox_ready:
            return "NemoClaw is not ready; the app will use its deterministic local replay."
        if self.settings.nemoclaw_mode == "off" and not self.settings.hai_api_key:
            return "Add HAI_API_KEY to use explicit direct-development mode."
        return "H Computer is not configured."

    async def create(self) -> Any:
        self._ensure_target()
        prompt = build_arcflash_prompt(self.settings.public_app_url or "")
        session = await self._create(prompt)
        self._electrisim_session_id = None
        self._electrisim_screenshot_sources.clear()
        return session

    async def create_electrisim(self) -> Any:
        self._ensure_hcomputer()
        session = await self._create(build_electrisim_prompt(), electrisim=True)
        self._electrisim_session_id = _session_id(session)
        self._electrisim_screenshot_sources.clear()
        return _with_electrisim_workflow(session)

    async def _create(self, prompt: str, *, electrisim: bool = False) -> Any:
        async with self._start_lock:
            await self._reject_concurrent_session()
            if electrisim:
                self._reject_electrisim_start_cooldown()
            max_steps = 40 if electrisim else 25
            max_time_s = 240 if electrisim else 150
            session = await self._call(
                "HCOMPUTER_SESSION_FAILED",
                lambda gateway: gateway.create(
                    prompt, max_steps=max_steps, max_time_s=max_time_s
                ),
            )
            session_id = _session_id(session)
            if session_id:
                self._active_session_id = session_id
                if electrisim:
                    self._last_electrisim_started_at = self._clock()
            return session

    async def get(self, session_id: str) -> Any:
        self._ensure_target()
        return await self._call(
            "HCOMPUTER_POLL_FAILED", lambda gateway: gateway.get(session_id)
        )

    async def get_electrisim(self, session_id: str) -> Any:
        self._ensure_hcomputer()
        self._ensure_electrisim_session(session_id)
        snapshot = await self._call(
            "HCOMPUTER_POLL_FAILED", lambda gateway: gateway.get(session_id)
        )
        return _with_electrisim_workflow(snapshot)

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        self._ensure_target()
        return await self._changes(session_id, from_index, wait_seconds)

    async def changes_electrisim(
        self, session_id: str, from_index: int, wait_seconds: int
    ) -> Any:
        self._ensure_hcomputer()
        self._ensure_electrisim_session(session_id)
        response = await self._changes(session_id, from_index, wait_seconds)
        for source in _image_sources(response):
            try:
                _validate_screenshot_source(session_id, source, self.settings.h_api_host)
            except ServiceError:
                continue
            self._electrisim_screenshot_sources.add(source)
        return response

    async def _changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        response = await self._call(
            "HCOMPUTER_CHANGES_FAILED",
            lambda gateway: gateway.changes(session_id, from_index, wait_seconds),
        )
        return response if response is not None else {"new_events": [], "status": "running"}

    async def pause(self, session_id: str) -> Any:
        self._ensure_target()
        await self._call("HCOMPUTER_PAUSE_FAILED", lambda gateway: gateway.pause(session_id))
        return {"id": session_id, "status": "paused"}

    async def resume(self, session_id: str) -> Any:
        self._ensure_target()
        await self._call("HCOMPUTER_RESUME_FAILED", lambda gateway: gateway.resume(session_id))
        return {"id": session_id, "status": "running"}

    async def cancel(self, session_id: str) -> Any:
        self._ensure_target()
        return await self._cancel(session_id)

    async def cancel_electrisim(self, session_id: str) -> Any:
        self._ensure_hcomputer()
        self._ensure_electrisim_session(session_id)
        response = await self._cancel(session_id)
        self._electrisim_session_id = None
        self._electrisim_screenshot_sources.clear()
        return response

    async def _cancel(self, session_id: str) -> Any:
        await self._call("HCOMPUTER_CANCEL_FAILED", lambda gateway: gateway.cancel(session_id))
        if self._active_session_id == session_id:
            self._active_session_id = None
        return {"id": session_id, "status": "interrupted"}

    async def pause_electrisim(self, session_id: str) -> Any:
        self._ensure_hcomputer()
        self._ensure_electrisim_session(session_id)
        await self._call("HCOMPUTER_PAUSE_FAILED", lambda gateway: gateway.pause(session_id))
        return {"id": session_id, "status": "paused"}

    async def resume_electrisim(self, session_id: str) -> Any:
        self._ensure_hcomputer()
        self._ensure_electrisim_session(session_id)
        await self._call("HCOMPUTER_RESUME_FAILED", lambda gateway: gateway.resume(session_id))
        return {"id": session_id, "status": "running"}

    async def screenshot_electrisim(self, session_id: str, source: str) -> tuple[bytes, str]:
        self._ensure_hcomputer()
        _validate_screenshot_source(session_id, source, self.settings.h_api_host)
        if (
            session_id != self._electrisim_session_id
            or session_id != self._active_session_id
            or source not in self._electrisim_screenshot_sources
        ):
            raise ServiceError(
                404,
                "ELECTRISIM_SCREENSHOT_NOT_OBSERVED",
                "That browser frame was not observed in the current Electrisim session.",
            )
        payload = await self._call(
            "ELECTRISIM_SCREENSHOT_FAILED",
            lambda gateway: gateway.screenshot(session_id, source),
        )
        return _decode_screenshot(payload)

    async def _reject_concurrent_session(self) -> None:
        if not self._active_session_id:
            return
        try:
            snapshot = await self._call(
                "HCOMPUTER_POLL_FAILED",
                lambda gateway: gateway.get(self._active_session_id or ""),
            )
        except ServiceError as error:
            raise ServiceError(
                409,
                "HCOMPUTER_SESSION_ACTIVE",
                "A previous H Computer session may still be active; cancel it before starting another.",
            ) from error
        if _session_state(snapshot) not in {
            "completed",
            "failed",
            "timed_out",
            "interrupted",
        }:
            raise ServiceError(
                409,
                "HCOMPUTER_SESSION_ACTIVE",
                "An H Computer session is already active for this API process.",
                {"sessionId": self._active_session_id},
            )
        self._active_session_id = None

    def _ensure_target(self) -> None:
        self._ensure_hcomputer()
        if not self.settings.public_app_url:
            raise ServiceError(
                503,
                "HCOMPUTER_NOT_CONFIGURED",
                "H Computer requires a publicly reachable PUBLIC_APP_URL. Use deterministic demo mode on localhost.",
            )

    def _ensure_hcomputer(self) -> None:
        if not self.settings.hcomputer_enabled:
            raise ServiceError(
                503,
                "HCOMPUTER_NOT_CONFIGURED",
                "H Computer execution is disabled by configuration.",
            )
        if self.settings.nemoclaw_mode == "off" and not self.settings.hai_api_key:
            raise ServiceError(
                503,
                "HCOMPUTER_NOT_CONFIGURED",
                "Direct-development mode requires HAI_API_KEY.",
            )

    def _ensure_electrisim_session(self, session_id: str) -> None:
        if session_id != self._electrisim_session_id:
            raise ServiceError(
                404,
                "ELECTRISIM_SESSION_NOT_FOUND",
                "The Electrisim browser session was not started by this API process.",
            )

    def _reject_electrisim_start_cooldown(self) -> None:
        if self._last_electrisim_started_at is None:
            return
        remaining = (
            self._electrisim_start_cooldown_seconds
            - (self._clock() - self._last_electrisim_started_at)
        )
        if remaining > 0:
            raise ServiceError(
                429,
                "ELECTRISIM_SESSION_COOLDOWN",
                "Wait before starting another Electrisim browser session.",
                {"retryAfterSeconds": math.ceil(remaining)},
            )

    def _gateway(self) -> HGateway:
        if self.settings.nemoclaw_mode != "off":
            return self._sandbox_gateway
        if self._direct_gateway is None:
            self._direct_gateway = DirectHGateway(self.settings)
        return self._direct_gateway

    async def _call(self, code: str, operation: Any) -> Any:
        try:
            result = await operation(self._gateway())
            return jsonable_encoder(result)
        except ServiceError:
            raise
        except ApiError as error:
            status = int(error.status_code or 502)
            raise ServiceError(
                status,
                code,
                f"H Computer request failed with {status}.",
                _safe_detail(error.body, self.settings),
            ) from error
        except Exception as error:
            raise ServiceError(502, code, "H Computer request failed.") from error


def _safe_detail(value: Any, settings: Settings) -> Any:
    encoded = jsonable_encoder(value)
    key = settings.hai_api_key.get_secret_value() if settings.hai_api_key else None
    if not key:
        return encoded
    serialized = str(encoded)
    return "[redacted]" if key in serialized else encoded


def _session_id(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    session_id = value.get("id") or value.get("session_id")
    return session_id if isinstance(session_id, str) else None


def _session_state(value: Any, depth: int = 0) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict) or depth > 3:
        return "unknown"
    for key in ("status", "state"):
        if key in value:
            state = _session_state(value[key], depth + 1)
            if state != "unknown":
                return state
    return "unknown"


def _with_electrisim_workflow(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    return {**value, "workflow": electrisim_demo_metadata()}


def _validate_screenshot_source(
    session_id: str, source: str, expected_host: str
) -> str:
    invalid = ServiceError(
        400,
        "ELECTRISIM_SCREENSHOT_SOURCE_INVALID",
        "The browser-frame source is not an allowed H Computer resource.",
    )
    if not SESSION_ID_PATTERN.fullmatch(session_id) or not isinstance(source, str):
        raise invalid
    try:
        parsed = urlsplit(source)
    except ValueError:
        raise invalid from None
    if (
        parsed.scheme != "https"
        or parsed.netloc != expected_host
        or parsed.query
        or parsed.fragment
    ):
        raise invalid
    prefix = (
        f"/api/v1/trajectories/{session_id}/resources/"
        f"{SCREENSHOT_BUCKET}/{session_id}/"
    )
    filename = parsed.path.removeprefix(prefix) if parsed.path.startswith(prefix) else ""
    if not SCREENSHOT_FILENAME_PATTERN.fullmatch(filename):
        raise invalid
    if parsed.path != f"{prefix}{filename}":
        raise invalid
    return filename


def _validate_screenshot_redirect(
    location: str | None, session_id: str, filename: str
) -> str:
    invalid = _screenshot_invalid("invalid redirect")
    if not isinstance(location, str) or len(location) > 12_000:
        raise invalid
    try:
        parsed = urlsplit(location)
    except ValueError:
        raise invalid from None
    if (
        parsed.scheme != "https"
        or parsed.netloc != SCREENSHOT_BUCKET_HOST
        or parsed.path != f"/{session_id}/{filename}"
        or not parsed.query
        or parsed.fragment
    ):
        raise invalid
    if len(parsed.query) > 10_000:
        raise invalid
    try:
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise invalid from None
    if not (6 <= len(pairs) <= 16):
        raise invalid
    query: dict[str, str] = {}
    for key, value in pairs:
        if (
            key in query
            or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", key)
            or not value
            or len(value) > 4096
            or any(ord(character) < 32 or ord(character) == 127 for character in value)
        ):
            raise invalid
        query[key] = value

    required = {
        "X-Amz-Algorithm",
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-Expires",
        "X-Amz-SignedHeaders",
        "X-Amz-Signature",
    }
    if not required.issubset(query):
        raise invalid
    if (
        query["X-Amz-Algorithm"] != "AWS4-HMAC-SHA256"
        or query["X-Amz-SignedHeaders"] != "host"
        or not re.fullmatch(r"[0-9a-fA-F]{64}", query["X-Amz-Signature"])
        or not re.fullmatch(r"\d{8}T\d{6}Z", query["X-Amz-Date"])
        or not query["X-Amz-Expires"].isdecimal()
    ):
        raise invalid
    expires = int(query["X-Amz-Expires"])
    if not 1 <= expires <= 604_800:
        raise invalid
    credential = query["X-Amz-Credential"].split("/")
    if (
        len(credential) != 5
        or not re.fullmatch(r"[A-Za-z0-9]{8,128}", credential[0])
        or credential[1] != query["X-Amz-Date"][:8]
        or not re.fullmatch(r"[a-z0-9-]{1,64}", credential[2])
        or credential[3:] != ["s3", "aws4_request"]
    ):
        raise invalid
    return location


def _screenshot_failed() -> ServiceError:
    return ServiceError(
        502,
        "ELECTRISIM_SCREENSHOT_FAILED",
        "H Computer did not return the requested browser frame.",
    )


def _screenshot_invalid(reason: str) -> ServiceError:
    message = (
        "H Computer returned an oversized browser frame."
        if reason == "oversized"
        else "H Computer returned an invalid browser frame."
    )
    return ServiceError(502, "ELECTRISIM_SCREENSHOT_INVALID", message)


def _decode_screenshot(payload: Any) -> tuple[bytes, str]:
    if not isinstance(payload, dict) or payload.get("media_type") != "image/png":
        raise ServiceError(
            502,
            "ELECTRISIM_SCREENSHOT_INVALID",
            "H Computer returned an invalid browser frame.",
        )
    encoded = payload.get("data_base64")
    if not isinstance(encoded, str):
        raise ServiceError(
            502,
            "ELECTRISIM_SCREENSHOT_INVALID",
            "H Computer returned an invalid browser frame.",
        )
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ServiceError(
            502,
            "ELECTRISIM_SCREENSHOT_INVALID",
            "H Computer returned an invalid browser frame.",
        ) from None
    if (
        not content
        or len(content) > MAX_SCREENSHOT_BYTES
        or not content.startswith(b"\x89PNG\r\n\x1a\n")
    ):
        raise ServiceError(
            502,
            "ELECTRISIM_SCREENSHOT_INVALID",
            "H Computer returned an invalid browser frame.",
        )
    return content, "image/png"


def _image_sources(value: Any, depth: int = 0) -> set[str]:
    if depth > 12:
        return set()
    if isinstance(value, list):
        return {
            source
            for item in value
            for source in _image_sources(item, depth + 1)
        }
    if not isinstance(value, dict):
        return set()
    sources: set[str] = set()
    image = value.get("image")
    if isinstance(image, dict) and isinstance(image.get("source"), str):
        sources.add(image["source"])
    for nested in value.values():
        if isinstance(nested, (dict, list)):
            sources.update(_image_sources(nested, depth + 1))
    return sources
