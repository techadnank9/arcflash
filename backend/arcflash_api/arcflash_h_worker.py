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
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

MARKER = "ARCFLASH_JSON:"
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9._/-]{1,160}$")


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
        with urlopen(request, timeout=30) as response:
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


def run(action: str, payload: dict[str, Any]) -> Any:
    base = api_base(payload.get("region"))
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
                "messages": [{"type": "user_message", "message": prompt}],
                "max_steps": min(50, max(1, int(payload.get("max_steps", 25)))),
                "max_time_s": min(600, max(30, float(payload.get("max_time_s", 150)))),
            },
        )
    session_id = quote(validate_session_id(payload.get("session_id")), safe="")
    if action == "get":
        return h_request("GET", f"{base}/sessions/{session_id}")
    if action == "changes":
        from_index = max(0, int(payload.get("from_index", 0)))
        wait_seconds = min(25, max(0, int(payload.get("wait_for_seconds", 1))))
        query = urlencode({"from_index": from_index, "wait_for_seconds": wait_seconds})
        response = h_request("GET", f"{base}/sessions/{session_id}/changes?{query}")
        return response or {"new_events": [], "status": "running"}
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
