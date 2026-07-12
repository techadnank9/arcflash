from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request


SCRIPT = Path(__file__).resolve().parents[1] / "arcflash_api" / "arcflash_h_worker.py"
SPEC = importlib.util.spec_from_file_location("arcflash_h_worker", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)

BUCKET = "production-agentplatformb-screenshotbucketv2f6e481-kjfhukx6imoq"
BUCKET_HOST = f"{BUCKET}.s3.amazonaws.com"


def signed_redirect(session_id: str, filename: str) -> str:
    return f"https://{BUCKET_HOST}/{session_id}/{filename}?" + urlencode(
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


def test_changes_explicitly_requests_agent_events() -> None:
    requested: list[str] = []

    def fake_request(method: str, url: str, body: Any = None) -> dict[str, object]:
        del method, body
        requested.append(url)
        return {"new_events": []}

    original = worker.h_request
    worker.h_request = fake_request
    try:
        worker.run(
            "changes",
            {
                "region": "us",
                "session_id": "session-1",
                "from_index": 3,
                "wait_for_seconds": 2,
            },
        )
    finally:
        worker.h_request = original

    assert len(requested) == 1
    assert "from_index=3" in requested[0]
    assert "include_events=true" in requested[0]
    assert "wait_for_seconds=2" in requested[0]


def test_screenshot_source_validation_is_region_and_session_scoped() -> None:
    valid = (
        "https://agp.hcompany.ai/api/v1/trajectories/session-1/"
        f"resources/{BUCKET}/session-1/observation.png"
    )

    assert worker.validate_screenshot_source(valid, "session-1", "us") == "observation.png"

    for invalid in (
        valid.replace("agp.hcompany.ai", "example.com"),
        valid.replace("session-1/resources", "other/resources"),
        valid.replace(f"{BUCKET}/session-1", f"{BUCKET}/other"),
        valid.replace(BUCKET, "another-bucket"),
        valid.replace("observation.png", "observation.jpg"),
        valid.replace("resources/", "resources/../"),
    ):
        try:
            worker.validate_screenshot_source(invalid, "session-1", "us")
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted unsafe screenshot source: {invalid}")


def test_screenshot_fetcher_rejects_all_redirects() -> None:
    handler = worker.RejectRedirects()
    request = Request("https://agp.hcompany.ai/api/v1/trajectories/s/resources/f.png")

    assert (
        handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://example.com/credential-target",
        )
        is None
    )


def test_screenshot_fetcher_authenticates_h_only_then_fetches_exact_signed_s3_url() -> None:
    source = (
        "https://agp.hcompany.ai/api/v1/trajectories/session-1/"
        f"resources/{BUCKET}/session-1/observation.png"
    )
    redirect = signed_redirect("session-1", "observation.png")
    requests: list[Request] = []

    class Response:
        def __init__(self, status: int, headers: dict[str, str], content: bytes = b"") -> None:
            self.status = status
            self.headers = headers
            self.content = content

        def read(self, limit: int = -1) -> bytes:
            return self.content if limit < 0 else self.content[:limit]

        def close(self) -> None:
            pass

    class Opener:
        def open(self, request: Request, timeout: int) -> Response:
            del timeout
            requests.append(request)
            if request.full_url == source:
                return Response(302, {"Location": redirect})
            assert request.full_url == redirect
            return Response(200, {}, b"\x89PNG\r\n\x1a\nsandbox-frame")

    original_opener = worker.build_opener
    original_key = worker.os.environ.get("HAI_API_KEY")
    worker.build_opener = lambda *handlers: Opener()
    worker.os.environ["HAI_API_KEY"] = "worker-test-token"
    try:
        payload = worker.screenshot_request(source, "session-1", "observation.png")
    finally:
        worker.build_opener = original_opener
        if original_key is None:
            worker.os.environ.pop("HAI_API_KEY", None)
        else:
            worker.os.environ["HAI_API_KEY"] = original_key

    assert payload["media_type"] == "image/png"
    assert requests[0].get_header("Authorization") == "Bearer worker-test-token"
    assert requests[1].get_header("Authorization") is None


def test_signed_redirect_validation_rejects_wrong_target_or_missing_signature() -> None:
    valid = signed_redirect("session-1", "observation.png")
    assert worker.validate_screenshot_redirect(
        valid, "session-1", "observation.png"
    ) == valid

    for invalid in (
        valid.replace(BUCKET_HOST, "example.com"),
        valid.replace("/session-1/observation.png", "/other/observation.png"),
        valid.split("?", 1)[0],
        valid.replace("X-Amz-Signature", "Not-A-Signature"),
        f"{valid}&X-Amz-Signature={'b' * 64}",
    ):
        try:
            worker.validate_screenshot_redirect(invalid, "session-1", "observation.png")
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted unsafe screenshot redirect: {invalid}")
