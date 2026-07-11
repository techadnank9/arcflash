from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence

import pytest

from arcflash_api.errors import ServiceError
from arcflash_api.nemoclaw import (
    PROBE_MARKER,
    RESULT_MARKER,
    CommandResult,
    NemoClawRuntime,
)
from arcflash_api.settings import Settings


def settings(**values: object) -> Settings:
    return Settings(
        _env_file=None,
        nemoclaw_status_cache_seconds=0,
        public_app_url="https://arcflash.example.com",
        **values,
    )


class ReadyRunner:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.worker_payload = {"id": "session-1", "status": {"status": "pending"}}

    async def run(self, arguments: Sequence[str], timeout: float) -> CommandResult:
        del timeout
        command = list(arguments)
        self.calls.append(command)
        if command[1:3] == ["sandbox", "status"]:
            return CommandResult(
                0,
                json.dumps(
                    {
                        "found": True,
                        "phase": "Ready",
                        "policies": [],
                    }
                ),
            )
        if len(command) > 2 and command[2] == "policy-list":
            return CommandResult(0, "● arcflash-hcomputer-eu [user-added]")
        if len(command) > 2 and command[2] == "policy-get":
            return CommandResult(
                0,
                "network_policies:\n"
                "  arcflash_hcomputer:\n"
                "    name: arcflash-hcomputer-eu\n",
            )
        if command[1:3] == ["credentials", "list"]:
            return CommandResult(0, "arcflash-hcomputer (generic)")
        if "/usr/bin/test" in command:
            return CommandResult(0)
        if "-c" in command:
            return CommandResult(
                0,
                f'{PROBE_MARKER}{json.dumps({"credential": True, "worker": True})}\n',
            )
        return CommandResult(0, f"{RESULT_MARKER}{json.dumps({'ok': True, 'data': self.worker_payload})}\n")


@pytest.mark.asyncio
async def test_status_is_explicit_when_cli_is_missing() -> None:
    runtime = NemoClawRuntime(settings(), executable="")
    state = await runtime.status()
    assert state.available is False
    assert state.ready is False
    assert state.enforced is False
    assert "deterministic" in state.message


@pytest.mark.asyncio
async def test_ready_status_requires_sandbox_policy_provider_and_worker() -> None:
    runner = ReadyRunner()
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")
    state = await runtime.status(refresh=True)
    assert state.ready is True
    assert state.enforced is True
    assert state.policyApplied is True
    assert state.providerAttached is True
    assert state.workerReady is True


@pytest.mark.asyncio
async def test_status_probes_are_serialized_for_nemoclaw_lock_safety() -> None:
    class SerializedRunner(ReadyRunner):
        def __init__(self) -> None:
            super().__init__()
            self.active = 0
            self.maximum_active = 0

        async def run(self, arguments: Sequence[str], timeout: float) -> CommandResult:
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
            try:
                await asyncio.sleep(0.001)
                return await super().run(arguments, timeout)
            finally:
                self.active -= 1

    runner = SerializedRunner()
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")

    state = await runtime.status(refresh=True)

    assert state.ready is True
    assert runner.maximum_active == 1


@pytest.mark.asyncio
async def test_worker_and_provider_readiness_are_reported_independently() -> None:
    runner = ReadyRunner()

    async def missing_worker(arguments: Sequence[str], timeout: float) -> CommandResult:
        command = list(arguments)
        if "-c" in command:
            return CommandResult(
                0,
                f'{PROBE_MARKER}{json.dumps({"credential": True, "worker": False})}\n',
            )
        return await ReadyRunner.run(runner, arguments, timeout)

    runner.run = missing_worker  # type: ignore[method-assign]
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")

    state = await runtime.status(refresh=True)

    assert state.providerAttached is True
    assert state.workerReady is False
    assert state.ready is False
    assert "worker" in state.message.lower()


@pytest.mark.asyncio
async def test_invoke_uses_argv_and_never_passes_the_api_key() -> None:
    runner = ReadyRunner()
    runtime = NemoClawRuntime(
        settings(hai_api_key="test-secret-token"), runner=runner, executable="nemoclaw"
    )
    result = await runtime.invoke("create", {"region": "eu", "prompt": "Open the app"})
    assert result["id"] == "session-1"
    invocation = runner.calls[-1]
    assert invocation[0] == "nemoclaw"
    assert "exec" in invocation
    assert "test-secret-token" not in " ".join(invocation)


@pytest.mark.asyncio
async def test_invoke_fails_closed_when_sandbox_is_unavailable() -> None:
    runtime = NemoClawRuntime(settings(), executable="")
    with pytest.raises(ServiceError) as captured:
        await runtime.invoke("create", {})
    assert captured.value.status_code == 503
    assert captured.value.code == "NEMOCLAW_NOT_READY"


@pytest.mark.asyncio
async def test_known_but_unapplied_policy_never_reports_enforced() -> None:
    runner = ReadyRunner()

    async def untrusted_run(arguments: Sequence[str], timeout: float) -> CommandResult:
        result = await ReadyRunner.run(runner, arguments, timeout)
        command = list(arguments)
        if len(command) > 2 and command[2] == "policy-get":
            return CommandResult(0, "network_policies: {}\n")
        return result

    runner.run = untrusted_run  # type: ignore[method-assign]
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")
    state = await runtime.status(refresh=True)
    assert state.policyApplied is False
    assert state.enforced is False


@pytest.mark.asyncio
async def test_similarly_named_credential_is_not_treated_as_attached() -> None:
    runner = ReadyRunner()

    async def wrong_credential(arguments: Sequence[str], timeout: float) -> CommandResult:
        result = await ReadyRunner.run(runner, arguments, timeout)
        if list(arguments)[1:3] == ["credentials", "list"]:
            return CommandResult(0, "arcflash-hcomputer-old (generic)")
        return result

    runner.run = wrong_credential  # type: ignore[method-assign]
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")
    state = await runtime.status(refresh=True)
    assert state.providerAttached is False
    assert state.enforced is False
