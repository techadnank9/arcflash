from __future__ import annotations

import asyncio
import base64
import json
import re
import shutil
import time
from dataclasses import asdict, dataclass
from typing import Any, Protocol, Sequence

import yaml

from .errors import ServiceError
from .settings import Settings

RESULT_MARKER = "ARCFLASH_JSON:"
PROBE_MARKER = "ARCFLASH_PROBE:"


@dataclass(slots=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


class CommandRunner(Protocol):
    async def run(self, arguments: Sequence[str], timeout: float) -> CommandResult: ...


class SubprocessRunner:
    """Run fixed argv lists without a shell or inherited stdin."""

    async def run(self, arguments: Sequence[str], timeout: float) -> CommandResult:
        process = await asyncio.create_subprocess_exec(
            *arguments,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            process.kill()
            await process.communicate()
            raise
        return CommandResult(
            returncode=process.returncode or 0,
            stdout=stdout.decode("utf-8", errors="replace")[-100_000:],
            stderr=stderr.decode("utf-8", errors="replace")[-20_000:],
        )


@dataclass(slots=True)
class NemoClawStatus:
    available: bool
    configured: bool
    ready: bool
    sandboxName: str
    phase: str
    sandboxReady: bool
    policyApplied: bool
    providerAttached: bool
    workerReady: bool
    mode: str
    enforced: bool
    message: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class NemoClawRuntime:
    def __init__(
        self,
        settings: Settings,
        runner: CommandRunner | None = None,
        executable: str | None = None,
    ) -> None:
        self.settings = settings
        self.runner = runner or SubprocessRunner()
        self.executable = executable if executable is not None else shutil.which("nemoclaw")
        self._cached_status: NemoClawStatus | None = None
        self._cached_at = 0.0
        self._status_lock = asyncio.Lock()
        self._execution_lock = asyncio.Lock()

    def _unavailable(self, message: str, *, available: bool = False) -> NemoClawStatus:
        return NemoClawStatus(
            available=available,
            configured=False,
            ready=False,
            sandboxName=self.settings.nemoclaw_sandbox,
            phase="unavailable",
            sandboxReady=False,
            policyApplied=False,
            providerAttached=False,
            workerReady=False,
            mode=self.settings.nemoclaw_mode,
            enforced=False,
            message=message,
        )

    async def status(self, *, refresh: bool = False) -> NemoClawStatus:
        if not self.executable:
            return self._unavailable(
                "NemoClaw CLI is not installed; computer-use runs use the deterministic local replay."
            )

        now = time.monotonic()
        if (
            not refresh
            and self._cached_status is not None
            and now - self._cached_at < self.settings.nemoclaw_status_cache_seconds
        ):
            return self._cached_status

        async with self._status_lock:
            now = time.monotonic()
            if (
                not refresh
                and self._cached_status is not None
                and now - self._cached_at < self.settings.nemoclaw_status_cache_seconds
            ):
                return self._cached_status
            current = await self._probe()
            self._cached_status = current
            self._cached_at = time.monotonic()
            return current

    async def _probe(self) -> NemoClawStatus:
        assert self.executable is not None
        sandbox = self.settings.nemoclaw_sandbox
        commands = (
            [self.executable, "sandbox", "status", sandbox, "--json"],
            [self.executable, sandbox, "policy-list"],
            [self.executable, sandbox, "policy-get"],
            [self.executable, "credentials", "list"],
            [
                self.executable,
                sandbox,
                "exec",
                "--timeout",
                "20",
                "--no-stdin",
                "--",
                "/usr/bin/python3",
                "-c",
                "import json,os,pathlib;print('"
                + PROBE_MARKER
                + "'+json.dumps({'credential':bool(os.environ.get('HAI_API_KEY')),'worker':pathlib.Path('"
                + self.settings.nemoclaw_worker_path
                + "').is_file()},separators=(',',':')))",
            ],
        )
        # NemoClaw serializes permission transitions with a per-sandbox lock.
        # Concurrent probes can outlive a short caller timeout and leave a stale
        # lock, so status checks intentionally run one at a time.
        results: list[CommandResult | Exception] = []
        for index, command in enumerate(commands):
            try:
                results.append(await self.runner.run(command, 35.0 if index == 4 else 12.0))
            except Exception as error:
                results.append(error)
        if isinstance(results[0], Exception):
            return self._unavailable(
                "NemoClaw could not be queried. Run the bootstrap check for details.",
                available=True,
            )

        status_result = results[0]
        assert isinstance(status_result, CommandResult)
        phase, found = _sandbox_phase(status_result)
        sandbox_ready = (
            status_result.returncode == 0
            and found
            and phase.lower() in {"ready", "running"}
        )
        policy_result = results[1]
        policy_get_result = results[2]
        credential_result = results[3]
        readiness_result = results[4]
        readiness = (
            _parse_readiness_probe(readiness_result.stdout)
            if isinstance(readiness_result, CommandResult)
            and readiness_result.returncode == 0
            else {}
        )
        policy_applied = (
            isinstance(policy_result, CommandResult)
            and policy_result.returncode == 0
            and "source unverified" not in policy_result.stdout.lower()
            and isinstance(policy_get_result, CommandResult)
            and _effective_policy_has_name(
                policy_get_result, self.settings.nemoclaw_policy_name
            )
        )
        provider_attached = isinstance(credential_result, CommandResult) and (
            credential_result.returncode == 0
            and _credential_list_has_name(
                credential_result.stdout, self.settings.nemoclaw_credential_name
            )
            and readiness.get("credential") is True
        )
        worker_ready = readiness.get("worker") is True
        ready = sandbox_ready and policy_applied and provider_attached and worker_ready
        enforced = ready and self.settings.nemoclaw_mode != "off"

        if ready:
            message = (
                "NemoClaw controls the local H orchestration worker, scoped files, credential, and H API egress. "
                "The browser session itself runs in H Company's cloud."
            )
        elif not sandbox_ready:
            message = f"NemoClaw sandbox {sandbox!r} is not ready."
        elif not policy_applied:
            message = f"Required policy {self.settings.nemoclaw_policy_name!r} is not applied."
        elif not provider_attached:
            message = (
                f"Credential provider {self.settings.nemoclaw_credential_name!r} is not "
                "registered, attached, or available to the worker."
            )
        else:
            message = "The ArcFlash Python worker has not been uploaded to the NemoClaw workspace."

        return NemoClawStatus(
            available=True,
            configured=ready,
            ready=ready,
            sandboxName=sandbox,
            phase=phase,
            sandboxReady=sandbox_ready,
            policyApplied=policy_applied,
            providerAttached=provider_attached,
            workerReady=worker_ready,
            mode=self.settings.nemoclaw_mode,
            enforced=enforced,
            message=message,
        )

    async def invoke(self, action: str, payload: dict[str, Any]) -> Any:
        if action not in {"create", "get", "changes", "pause", "resume", "cancel"}:
            raise ValueError(f"Unsupported sandbox action: {action}")
        state = await self.status()
        if not state.ready or not self.executable:
            raise ServiceError(
                503,
                "NEMOCLAW_NOT_READY",
                "NemoClaw enforcement is required before H Computer can run.",
                {"sandbox": state.sandboxName, "phase": state.phase},
            )

        encoded = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":")).encode("utf-8")
        ).decode("ascii")
        arguments = [
            self.executable,
            self.settings.nemoclaw_sandbox,
            "exec",
            "--workdir",
            "/sandbox/.openclaw/workspace/arcflash",
            "--timeout",
            str(self.settings.nemoclaw_exec_timeout_seconds),
            "--no-stdin",
            "--",
            "/usr/bin/python3",
            self.settings.nemoclaw_worker_path,
            action,
            encoded,
        ]
        async with self._execution_lock:
            try:
                result = await self.runner.run(
                    arguments,
                    float(self.settings.nemoclaw_exec_timeout_seconds + 5),
                )
            except TimeoutError as error:
                raise ServiceError(
                    504,
                    "NEMOCLAW_EXECUTION_TIMEOUT",
                    "The sandboxed H Computer operation timed out.",
                ) from error

        envelope = _parse_worker_envelope(result.stdout)
        if result.returncode != 0 and envelope is None:
            raise ServiceError(
                502,
                "NEMOCLAW_EXECUTION_FAILED",
                "The sandboxed H Computer worker failed.",
                {"returncode": result.returncode},
            )
        if envelope is None:
            raise ServiceError(
                502,
                "NEMOCLAW_INVALID_RESPONSE",
                "The sandboxed H Computer worker returned an invalid response.",
            )
        if not envelope.get("ok"):
            raise ServiceError(
                int(envelope.get("status", 502)),
                str(envelope.get("code", "HCOMPUTER_UPSTREAM_FAILED")),
                str(envelope.get("message", "H Computer request failed.")),
                envelope.get("detail"),
            )
        return envelope.get("data")


def _sandbox_phase(result: CommandResult) -> tuple[str, bool]:
    if result.returncode != 0:
        return "missing", False
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        lowered = result.stdout.lower()
        for candidate in ("running", "ready", "stopped", "failed"):
            if candidate in lowered:
                return candidate, True
        return "unknown", bool(result.stdout.strip())

    found = bool(payload.get("found", True)) if isinstance(payload, dict) else True
    phase = "unknown"
    if isinstance(payload, dict):
        phase = str(
            payload.get("phase")
            or payload.get("status")
            or payload.get("sandbox", {}).get("phase")
            or "unknown"
        )
    return phase, found


def _effective_policy_has_name(result: CommandResult, expected: str) -> bool:
    if result.returncode != 0:
        return False
    try:
        payload = yaml.safe_load(result.stdout)
    except yaml.YAMLError:
        return False
    if not isinstance(payload, dict):
        return False
    policies = payload.get("network_policies")
    if not isinstance(policies, dict):
        return False
    for policy in policies.values():
        if isinstance(policy, dict) and policy.get("name") == expected:
            return True
    return False


def _credential_list_has_name(output: str, expected: str) -> bool:
    boundary = rf"(?<![a-z0-9-]){re.escape(expected)}(?![a-z0-9-])"
    return re.search(boundary, output.lower()) is not None


def _parse_worker_envelope(stdout: str) -> dict[str, Any] | None:
    for line in reversed(stdout.splitlines()):
        if line.startswith(RESULT_MARKER):
            try:
                parsed = json.loads(line[len(RESULT_MARKER) :])
            except json.JSONDecodeError:
                return None
            return parsed if isinstance(parsed, dict) else None
    return None


def _parse_readiness_probe(stdout: str) -> dict[str, bool]:
    for line in reversed(stdout.splitlines()):
        if not line.startswith(PROBE_MARKER):
            continue
        try:
            parsed = json.loads(line[len(PROBE_MARKER) :])
        except json.JSONDecodeError:
            return {}
        if not isinstance(parsed, dict):
            return {}
        return {
            "credential": parsed.get("credential") is True,
            "worker": parsed.get("worker") is True,
        }
    return {}
