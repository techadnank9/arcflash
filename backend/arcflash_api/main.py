from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .errors import ServiceError
from .gradium import (
    MAX_AUDIO_BYTES,
    GradiumService,
    normalize_audio_type,
    validate_audio_size,
)
from .hcomputer import HComputerService
from .nemoclaw import NemoClawRuntime
from .settings import Settings, get_settings


def create_app(
    settings: Settings | None = None,
    runtime: NemoClawRuntime | None = None,
    service: HComputerService | None = None,
    gradium_service: GradiumService | None = None,
) -> FastAPI:
    current_settings = settings or get_settings()
    current_runtime = runtime or NemoClawRuntime(current_settings)
    current_service = service or HComputerService(current_settings, current_runtime)
    current_gradium = gradium_service or GradiumService(current_settings)

    api = FastAPI(
        title="ArcFlash Copilot API",
        version="0.2.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    api.state.settings = current_settings
    api.state.nemoclaw = current_runtime
    api.state.hcomputer = current_service
    api.state.gradium = current_gradium

    @api.exception_handler(ServiceError)
    async def handle_service_error(_request: Request, error: ServiceError) -> JSONResponse:
        payload = {"code": error.code, "message": error.message}
        if error.detail is not None:
            payload["detail"] = error.detail
        return JSONResponse(status_code=error.status_code, content=payload)

    @api.get("/api/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "service": "arcflash-copilot",
            "runtime": "python",
            "timestamp": datetime.now(UTC).isoformat(),
        }

    @api.get("/api/nemoclaw/status")
    async def nemoclaw_status() -> dict[str, object]:
        return (await current_runtime.status()).as_dict()

    @api.get("/api/hcomputer/status")
    async def hcomputer_status() -> dict[str, object]:
        return await current_service.status()

    @api.get("/api/gradium/status")
    async def gradium_status() -> dict[str, object]:
        return await current_gradium.status()

    @api.post("/api/gradium/transcribe")
    async def gradium_transcribe(request: Request) -> dict[str, str]:
        content_type = normalize_audio_type(request.headers.get("content-type"))
        audio = await _read_limited_audio(request)
        return await current_gradium.transcribe(audio, content_type)

    @api.post("/api/hcomputer/sessions", status_code=201)
    async def create_hcomputer_session() -> object:
        return await current_service.create()

    @api.get("/api/hcomputer/sessions/{session_id}")
    async def get_hcomputer_session(session_id: str) -> object:
        return await current_service.get(session_id)

    @api.get("/api/hcomputer/sessions/{session_id}/changes")
    async def get_hcomputer_changes(
        session_id: str,
        from_index: Annotated[int, Query(ge=0)] = 0,
        wait_for_seconds: Annotated[int, Query(ge=0, le=25)] = 1,
    ) -> object:
        return await current_service.changes(session_id, from_index, wait_for_seconds)

    @api.post("/api/hcomputer/sessions/{session_id}/pause")
    async def pause_hcomputer_session(session_id: str) -> object:
        return await current_service.pause(session_id)

    @api.post("/api/hcomputer/sessions/{session_id}/resume")
    async def resume_hcomputer_session(session_id: str) -> object:
        return await current_service.resume(session_id)

    @api.delete("/api/hcomputer/sessions/{session_id}")
    async def cancel_hcomputer_session(session_id: str) -> object:
        return await current_service.cancel(session_id)

    _mount_frontend(api)
    return api


async def _read_limited_audio(request: Request) -> bytes:
    declared_size = request.headers.get("content-length")
    if declared_size is not None:
        try:
            parsed_size = int(declared_size)
        except ValueError:
            raise ServiceError(
                400,
                "GRADIUM_AUDIO_LENGTH_INVALID",
                "Audio content length is invalid.",
            ) from None
        if parsed_size < 0:
            raise ServiceError(
                400,
                "GRADIUM_AUDIO_LENGTH_INVALID",
                "Audio content length is invalid.",
            )
        if parsed_size > MAX_AUDIO_BYTES:
            validate_audio_size(parsed_size)

    audio = bytearray()
    async for chunk in request.stream():
        if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
            validate_audio_size(len(audio) + len(chunk))
        audio.extend(chunk)

    validate_audio_size(len(audio))
    return bytes(audio)


def _mount_frontend(api: FastAPI) -> None:
    repository_root = Path(__file__).resolve().parents[2]
    dist = repository_root / "dist"
    assets = dist / "assets"
    if not (dist / "index.html").is_file():
        return
    if assets.is_dir():
        api.mount("/assets", StaticFiles(directory=assets), name="assets")

    @api.get("/{frontend_path:path}", include_in_schema=False)
    async def frontend(frontend_path: str) -> FileResponse:
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found.")
        requested = (dist / frontend_path).resolve()
        if requested.is_relative_to(dist.resolve()) and requested.is_file():
            return FileResponse(requested)
        if frontend_path.rstrip("/") in {"", "study"}:
            return FileResponse(dist / "index.html")
        raise HTTPException(status_code=404, detail="Page not found.")


app = create_app()
