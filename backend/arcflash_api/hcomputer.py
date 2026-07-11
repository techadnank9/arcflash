from __future__ import annotations

import asyncio
from typing import Any, Protocol

from fastapi.encoders import jsonable_encoder
from hai_agents import AsyncClient, HaiAgentsEnvironment
from hai_agents.core import ApiError

from .errors import ServiceError
from .nemoclaw import NemoClawRuntime
from .prompts import build_arcflash_prompt
from .settings import Settings


class HGateway(Protocol):
    async def create(self, prompt: str) -> Any: ...
    async def get(self, session_id: str) -> Any: ...
    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any: ...
    async def pause(self, session_id: str) -> Any: ...
    async def resume(self, session_id: str) -> Any: ...
    async def cancel(self, session_id: str) -> Any: ...


class DirectHGateway:
    """Explicit development-only adapter for running outside NemoClaw."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
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

    async def create(self, prompt: str) -> Any:
        return await self.client.sessions.create_session(
            agent=self.settings.hcomputer_agent,
            messages=[{"type": "user_message", "message": prompt}],
            max_steps=25,
            max_time_s=150,
        )

    async def get(self, session_id: str) -> Any:
        return await self.client.sessions.get_session(session_id)

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        return await self.client.sessions.get_session_changes(
            session_id,
            from_index=from_index,
            wait_for_seconds=wait_seconds,
        )

    async def pause(self, session_id: str) -> Any:
        return await self.client.sessions.pause_session(session_id)

    async def resume(self, session_id: str) -> Any:
        return await self.client.sessions.resume_session(session_id)

    async def cancel(self, session_id: str) -> Any:
        return await self.client.sessions.cancel_session(session_id)


class SandboxHGateway:
    def __init__(self, settings: Settings, runtime: NemoClawRuntime) -> None:
        self.settings = settings
        self.runtime = runtime

    async def create(self, prompt: str) -> Any:
        return await self.runtime.invoke(
            "create",
            {
                "region": self.settings.hai_region,
                "agent": self.settings.hcomputer_agent,
                "prompt": prompt,
                "max_steps": 25,
                "max_time_s": 150,
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


class HComputerService:
    def __init__(
        self,
        settings: Settings,
        runtime: NemoClawRuntime,
        direct_gateway: HGateway | None = None,
        sandbox_gateway: HGateway | None = None,
    ) -> None:
        self.settings = settings
        self.runtime = runtime
        self._direct_gateway = direct_gateway
        self._sandbox_gateway = sandbox_gateway or SandboxHGateway(settings, runtime)
        self._start_lock = asyncio.Lock()
        self._active_session_id: str | None = None

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
        async with self._start_lock:
            await self._reject_concurrent_session()
            prompt = build_arcflash_prompt(self.settings.public_app_url or "")
            session = await self._call(
                "HCOMPUTER_SESSION_FAILED", lambda gateway: gateway.create(prompt)
            )
            session_id = _session_id(session)
            if session_id:
                self._active_session_id = session_id
            return session

    async def get(self, session_id: str) -> Any:
        self._ensure_target()
        return await self._call(
            "HCOMPUTER_POLL_FAILED", lambda gateway: gateway.get(session_id)
        )

    async def changes(self, session_id: str, from_index: int, wait_seconds: int) -> Any:
        self._ensure_target()
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
        await self._call("HCOMPUTER_CANCEL_FAILED", lambda gateway: gateway.cancel(session_id))
        if self._active_session_id == session_id:
            self._active_session_id = None
        return {"id": session_id, "status": "interrupted"}

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
        if not self.settings.hcomputer_enabled or not self.settings.public_app_url:
            raise ServiceError(
                503,
                "HCOMPUTER_NOT_CONFIGURED",
                "H Computer requires a publicly reachable PUBLIC_APP_URL. Use deterministic demo mode on localhost.",
            )
        if self.settings.nemoclaw_mode == "off" and not self.settings.hai_api_key:
            raise ServiceError(
                503,
                "HCOMPUTER_NOT_CONFIGURED",
                "Direct-development mode requires HAI_API_KEY.",
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
