from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence

import pytest

from arcflash_api.errors import ServiceError
from arcflash_api.nemoclaw import (
    MAX_WORKER_STDOUT_BYTES,
    PROBE_MARKER,
    RESULT_MARKER,
    CommandResult,
    NemoClawRuntime,
    _effective_policy_has_required_rules,
    _parse_worker_envelope,
)
from arcflash_api.settings import Settings


READY_POLICY = """network_policies:
  arcflash_hcomputer:
    name: arcflash-hcomputer-eu
    endpoints:
      - host: agp.eu.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: POST, path: /api/v2/sessions}
          - allow: {method: GET, path: /api/v2/sessions/*}
          - allow: {method: GET, path: /api/v2/sessions/*/changes}
          - allow: {method: POST, path: /api/v2/sessions/*/pause}
          - allow: {method: POST, path: /api/v2/sessions/*/resume}
          - allow: {method: DELETE, path: /api/v2/sessions/*}
          - allow: {method: GET, path: /api/v1/trajectories/*/resources/*/*/*}
      - host: production-agentplatformb-screenshotbucketv2f6e481-kjfhukx6imoq.s3.amazonaws.com
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: GET, path: /*/*}
    binaries:
      - {path: /usr/bin/python3*}
      - {path: /usr/local/bin/python3*}
"""


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
            return CommandResult(0, READY_POLICY)
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
async def test_same_name_without_screenshot_rule_never_reports_ready() -> None:
    runner = ReadyRunner()

    async def stale_policy(arguments: Sequence[str], timeout: float) -> CommandResult:
        result = await ReadyRunner.run(runner, arguments, timeout)
        command = list(arguments)
        if len(command) > 2 and command[2] == "policy-get":
            return CommandResult(
                0,
                READY_POLICY.replace(
                    "          - allow: {method: GET, path: /api/v1/trajectories/*/resources/*/*/*}\n",
                    "",
                ),
            )
        return result

    runner.run = stale_policy  # type: ignore[method-assign]
    runtime = NemoClawRuntime(settings(), runner=runner, executable="nemoclaw")

    state = await runtime.status(refresh=True)

    assert state.policyApplied is False
    assert state.ready is False
    assert state.enforced is False


@pytest.mark.asyncio
async def test_same_name_without_exact_s3_frame_rule_never_reports_ready() -> None:
    runner = ReadyRunner()

    async def stale_policy(arguments: Sequence[str], timeout: float) -> CommandResult:
        result = await ReadyRunner.run(runner, arguments, timeout)
        if len(arguments) > 2 and arguments[2] == "policy-get":
            return CommandResult(
                0,
                READY_POLICY.replace(
                    "          - allow: {method: GET, path: /*/*}",
                    "          - allow: {method: GET, path: /*}",
                ),
            )
        return result

    runner.run = stale_policy  # type: ignore[method-assign]
    state = await NemoClawRuntime(
        settings(), runner=runner, executable="nemoclaw"
    ).status(refresh=True)

    assert state.policyApplied is False
    assert state.ready is False


def test_runtime_policy_readiness_rejects_any_broader_named_policy() -> None:
    broader_rule = READY_POLICY.replace(
        "    binaries:",
        "          - allow: {method: GET, path: /api/*}\n    binaries:",
    )
    broader_binary = READY_POLICY.replace(
        "      - {path: /usr/local/bin/python3*}",
        "      - {path: /usr/local/bin/python3*}\n      - {path: /bin/bash}",
    )
    extra_endpoint = READY_POLICY.replace(
        "    binaries:",
        "      - host: example.com\n"
        "        port: 443\n"
        "        protocol: rest\n"
        "        enforcement: enforce\n"
        "        rules: []\n"
        "    binaries:",
    )

    for policy in (broader_rule, broader_binary, extra_endpoint):
        assert _effective_policy_has_required_rules(
            CommandResult(0, policy),
            "arcflash-hcomputer-eu",
            "agp.eu.hcompany.ai",
        ) is False


def test_runtime_policy_readiness_ignores_separately_named_policy() -> None:
    with_unrelated = READY_POLICY + """
  unrelated:
    name: pypi
    endpoints: []
    binaries:
      - {path: /bin/bash}
"""

    assert _effective_policy_has_required_rules(
        CommandResult(0, with_unrelated),
        "arcflash-hcomputer-eu",
        "agp.eu.hcompany.ai",
    ) is True


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


def test_large_screenshot_envelope_is_not_lost_to_legacy_stdout_limit() -> None:
    encoded = "A" * 200_000
    stdout = RESULT_MARKER + json.dumps(
        {"ok": True, "data": {"media_type": "image/png", "data_base64": encoded}}
    )

    parsed = _parse_worker_envelope(stdout)

    assert parsed is not None
    assert parsed["data"]["data_base64"] == encoded
    assert MAX_WORKER_STDOUT_BYTES > len(stdout)
