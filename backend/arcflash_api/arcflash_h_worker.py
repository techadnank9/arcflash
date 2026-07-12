#!/usr/bin/env python3
"""One-shot, standard-library H Computer worker for a NemoClaw sandbox."""

from __future__ import annotations

import base64
import json
import os
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MARKER = "ARCFLASH_JSON:"
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9._/-]{1,160}$")
MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
SCREENSHOT_FILENAME = re.compile(
    r"(?=.{5,255}\Z)[A-Za-z0-9][A-Za-z0-9._~-]*\.png\Z"
)
SCREENSHOT_BUCKET = "production-agentplatformb-screenshotbucketv2f6e481-kjfhukx6imoq"
SCREENSHOT_BUCKET_HOST = f"{SCREENSHOT_BUCKET}.s3.amazonaws.com"


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        request: Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        del request, file_pointer, code, message, headers, new_url
        return None


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    print(f"{MARKER}{json.dumps(payload, separators=(',', ':'))}", flush=True)
    raise SystemExit(exit_code)


def decode_payload(encoded: str) -> dict[str, Any]:
    padding = "=" * (-len(encoded) % 4)
    value = json.loads(base64.urlsafe_b64decode(encoded + padding))
    if not isinstance(value, dict):
        raise ValueError("Payload must be an object.")
    return value


def api_base(region: Any) -> str:
    if region == "us":
        return "https://agp.hcompany.ai/api/v2"
    if region == "eu":
        return "https://agp.eu.hcompany.ai/api/v2"
    raise ValueError("Region must be eu or us.")


def validate_session_id(value: Any) -> str:
    if not isinstance(value, str) or not SESSION_ID.fullmatch(value):
        raise ValueError("Invalid session ID.")
    return value


def h_request(method: str, url: str, body: dict[str, Any] | None = None) -> Any:
    credential = os.environ.get("HAI_API_KEY")
    if not credential:
        emit(
            {
                "ok": False,
                "status": 503,
                "code": "HCOMPUTER_CREDENTIAL_MISSING",
                "message": "The NemoClaw credential provider did not supply HAI_API_KEY.",
            },
            1,
        )
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {credential}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "ArcFlash-Copilot-NemoClaw/0.2",
        },
    )
    try:
        with build_opener(RejectRedirects).open(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace").replace(credential, "[redacted]")
        try:
            detail: Any = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            detail = {"message": raw[:1000]}
        emit(
            {
                "ok": False,
                "status": error.code,
                "code": "HCOMPUTER_UPSTREAM_FAILED",
                "message": f"H Computer request failed with {error.code}.",
                "detail": detail,
            },
            1,
        )
    except (URLError, TimeoutError):
        emit(
            {
                "ok": False,
                "status": 502,
                "code": "HCOMPUTER_NETWORK_FAILED",
                "message": "The sandbox could not reach the allowlisted H Computer endpoint.",
            },
            1,
        )


def screenshot_request(url: str, session_id: str, filename: str) -> dict[str, str]:
    credential = os.environ.get("HAI_API_KEY")
    if not credential:
        emit(
            {
                "ok": False,
                "status": 503,
                "code": "HCOMPUTER_CREDENTIAL_MISSING",
                "message": "The NemoClaw credential provider did not supply HAI_API_KEY.",
            },
            1,
        )
    authenticated_request = Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {credential}",
            "Accept": "image/png",
            "User-Agent": "ArcFlash-Copilot-NemoClaw/0.2",
        },
    )
    try:
        source_response = _open_without_redirects(authenticated_request)
        try:
            if _response_status(source_response) != 302:
                raise ValueError("H resource did not return the expected redirect.")
            redirect = validate_screenshot_redirect(
                source_response.headers.get("Location"), session_id, filename
            )
        finally:
            source_response.close()

        # Do not copy the H Authorization header to the presigned object request.
        presigned_request = Request(
            redirect,
            method="GET",
            headers={
                "Accept": "image/png",
                "User-Agent": "ArcFlash-Copilot-NemoClaw/0.2",
            },
        )
        response = _open_without_redirects(presigned_request)
        try:
            if _response_status(response) != 200:
                raise ValueError("Presigned browser frame did not return PNG data.")
            content_length = response.headers.get("Content-Length")
            if (
                content_length is not None
                and content_length.isdecimal()
                and int(content_length) > MAX_SCREENSHOT_BYTES
            ):
                raise OverflowError("Browser frame is oversized.")
            content = response.read(MAX_SCREENSHOT_BYTES + 1)
            if len(content) > MAX_SCREENSHOT_BYTES:
                raise OverflowError("Browser frame is oversized.")
            if not content.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Browser frame is not a PNG.")
            return {
                "media_type": "image/png",
                "data_base64": base64.b64encode(content).decode("ascii"),
            }
        finally:
            response.close()
    except OverflowError:
        emit(
            {
                "ok": False,
                "status": 502,
                "code": "ELECTRISIM_SCREENSHOT_INVALID",
                "message": "H Computer returned an oversized browser frame.",
            },
            1,
        )
    except (HTTPError, ValueError):
        emit(
            {
                "ok": False,
                "status": 502,
                "code": "ELECTRISIM_SCREENSHOT_FAILED",
                "message": "H Computer did not return the requested browser frame.",
            },
            1,
        )
    except (URLError, TimeoutError):
        emit(
            {
                "ok": False,
                "status": 502,
                "code": "HCOMPUTER_NETWORK_FAILED",
                "message": "The sandbox could not reach the allowlisted H Computer endpoint.",
            },
            1,
        )


def _open_without_redirects(request: Request) -> Any:
    try:
        return build_opener(RejectRedirects).open(request, timeout=30)
    except HTTPError as error:
        return error


def _response_status(response: Any) -> int:
    return int(getattr(response, "status", getattr(response, "code", 0)))


def validate_screenshot_source(source: Any, session_id: str, region: Any) -> str:
    if not isinstance(source, str):
        raise ValueError("Invalid browser-frame source.")
    expected_host = "agp.hcompany.ai" if region == "us" else "agp.eu.hcompany.ai"
    try:
        parsed = urlsplit(source)
    except ValueError:
        raise ValueError("Invalid browser-frame source.") from None
    if (
        parsed.scheme != "https"
        or parsed.netloc != expected_host
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid browser-frame source.")
    prefix = (
        f"/api/v1/trajectories/{session_id}/resources/"
        f"{SCREENSHOT_BUCKET}/{session_id}/"
    )
    filename = parsed.path.removeprefix(prefix) if parsed.path.startswith(prefix) else ""
    if not SCREENSHOT_FILENAME.fullmatch(filename) or parsed.path != f"{prefix}{filename}":
        raise ValueError("Invalid browser-frame source.")
    return filename


def validate_screenshot_redirect(
    location: Any, session_id: str, filename: str
) -> str:
    if not isinstance(location, str) or len(location) > 12_000:
        raise ValueError("Invalid browser-frame redirect.")
    try:
        parsed = urlsplit(location)
    except ValueError:
        raise ValueError("Invalid browser-frame redirect.") from None
    if (
        parsed.scheme != "https"
        or parsed.netloc != SCREENSHOT_BUCKET_HOST
        or parsed.path != f"/{session_id}/{filename}"
        or not parsed.query
        or parsed.fragment
        or len(parsed.query) > 10_000
    ):
        raise ValueError("Invalid browser-frame redirect.")
    try:
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise ValueError("Invalid browser-frame redirect.") from None
    if not (6 <= len(pairs) <= 16):
        raise ValueError("Invalid browser-frame redirect.")
    query: dict[str, str] = {}
    for key, value in pairs:
        if (
            key in query
            or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", key)
            or not value
            or len(value) > 4096
            or any(ord(character) < 32 or ord(character) == 127 for character in value)
        ):
            raise ValueError("Invalid browser-frame redirect.")
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
        raise ValueError("Invalid browser-frame redirect.")
    if (
        query["X-Amz-Algorithm"] != "AWS4-HMAC-SHA256"
        or query["X-Amz-SignedHeaders"] != "host"
        or not re.fullmatch(r"[0-9a-fA-F]{64}", query["X-Amz-Signature"])
        or not re.fullmatch(r"\d{8}T\d{6}Z", query["X-Amz-Date"])
        or not query["X-Amz-Expires"].isdecimal()
    ):
        raise ValueError("Invalid browser-frame redirect.")
    expires = int(query["X-Amz-Expires"])
    credential = query["X-Amz-Credential"].split("/")
    if (
        not 1 <= expires <= 604_800
        or len(credential) != 5
        or not re.fullmatch(r"[A-Za-z0-9]{8,128}", credential[0])
        or credential[1] != query["X-Amz-Date"][:8]
        or not re.fullmatch(r"[a-z0-9-]{1,64}", credential[2])
        or credential[3:] != ["s3", "aws4_request"]
    ):
        raise ValueError("Invalid browser-frame redirect.")
    return location


def run(action: str, payload: dict[str, Any]) -> Any:
    region = payload.get("region")
    base = api_base(region)
    if action == "create":
        agent = payload.get("agent")
        prompt = payload.get("prompt")
        if not isinstance(agent, str) or not AGENT_ID.fullmatch(agent):
            raise ValueError("Invalid agent ID.")
        if not isinstance(prompt, str) or not (1 <= len(prompt) <= 12_000):
            raise ValueError("Invalid task prompt.")
        return h_request(
            "POST",
            f"{base}/sessions",
            {
                "agent": agent,
                "agent_artifact": str(payload.get("agent_artifact", "hackathon-dnd")),
                "messages": [{"type": "user_message", "message": prompt}],
                "max_steps": min(50, max(1, int(payload.get("max_steps", 25)))),
                "max_time_s": min(600, max(30, float(payload.get("max_time_s", 150)))),
            },
        )
    raw_session_id = validate_session_id(payload.get("session_id"))
    session_id = quote(raw_session_id, safe="")
    if action == "get":
        return h_request("GET", f"{base}/sessions/{session_id}")
    if action == "changes":
        from_index = max(0, int(payload.get("from_index", 0)))
        wait_seconds = min(25, max(0, int(payload.get("wait_for_seconds", 1))))
        query = urlencode(
            {
                "from_index": from_index,
                "include_events": "true",
                "wait_for_seconds": wait_seconds,
            }
        )
        response = h_request("GET", f"{base}/sessions/{session_id}/changes?{query}")
        return response or {"new_events": [], "status": "running"}
    if action == "screenshot":
        source = payload.get("source")
        filename = validate_screenshot_source(source, raw_session_id, region)
        return screenshot_request(source, raw_session_id, filename)
    if action in {"pause", "resume"}:
        h_request("POST", f"{base}/sessions/{session_id}/{action}")
        return {"id": session_id, "status": "paused" if action == "pause" else "running"}
    if action == "cancel":
        h_request("DELETE", f"{base}/sessions/{session_id}")
        return {"id": session_id, "status": "interrupted"}
    raise ValueError("Unsupported worker action.")


def main() -> None:
    if len(sys.argv) != 3:
        emit({"ok": False, "status": 400, "code": "INVALID_INVOCATION", "message": "Expected action and payload."}, 2)
    try:
        result = run(sys.argv[1], decode_payload(sys.argv[2]))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        emit({"ok": False, "status": 400, "code": "INVALID_JOB", "message": str(error)}, 2)
    emit({"ok": True, "data": result})


if __name__ == "__main__":
    main()
