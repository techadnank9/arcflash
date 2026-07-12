#!/usr/bin/env python3
"""Provision the ArcFlash worker in an already-onboarded NemoClaw sandbox."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = "/sandbox/.openclaw/workspace/arcflash"
WORKER_DIRECTORY = f"{WORKSPACE}/worker"
WORKER_DESTINATION = f"{WORKER_DIRECTORY}/arcflash_h_worker.py"


def run(arguments: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(arguments))
    return subprocess.run(arguments, check=check, text=True, capture_output=False)


def output(arguments: list[str]) -> str:
    completed = subprocess.run(
        arguments,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout


def wait_for_worker_readiness(nemoclaw: str, sandbox: str) -> tuple[bool, bool]:
    """Wait for both provider injection and the uploaded worker to be observable."""
    probe = [
        nemoclaw,
        sandbox,
        "exec",
        "--no-stdin",
        "--",
        "/usr/bin/python3",
        "-c",
        "import os,pathlib;raise SystemExit(0 if os.environ.get('HAI_API_KEY') and pathlib.Path('"
        + WORKER_DESTINATION
        + "').is_file() else 1)",
    ]
    for attempt in range(1, 31):
        completed = subprocess.run(probe, check=False, text=True)
        if completed.returncode == 0:
            return True, True
        if attempt < 30:
            print(f"= waiting for sandbox worker readiness ({attempt}/30)")
            time.sleep(2)

    credential = subprocess.run(
        [
            nemoclaw,
            sandbox,
            "exec",
            "--no-stdin",
            "--",
            "/usr/bin/python3",
            "-c",
            "import os;raise SystemExit(0 if os.environ.get('HAI_API_KEY') else 1)",
        ],
        check=False,
        text=True,
    )
    worker = subprocess.run(
        [
            nemoclaw,
            sandbox,
            "exec",
            "--no-stdin",
            "--",
            "/usr/bin/test",
            "-f",
            WORKER_DESTINATION,
        ],
        check=False,
        text=True,
    )
    return credential.returncode == 0, worker.returncode == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Attach a generic H credential, apply a narrow egress policy, and upload the Python worker."
    )
    parser.add_argument("--sandbox", default="arcflash-copilot")
    parser.add_argument("--region", choices=("eu", "us"), default="eu")
    parser.add_argument("--credential-name", default="arcflash-hcomputer")
    parser.add_argument(
        "--replace-credential",
        action="store_true",
        help="Explicitly reset an existing provider and register the exported HAI_API_KEY.",
    )
    parser.add_argument(
        "--skip-rebuild",
        action="store_true",
        help="Use only when the credential was attached by an earlier sandbox build.",
    )
    return parser.parse_args()


def valid_name(value: str) -> bool:
    return bool(re.fullmatch(r"(?:[a-z]|[a-z][a-z0-9-]{0,61}[a-z0-9])", value))


def effective_policy_names(policy_text: str) -> set[str]:
    policies = _network_policies(policy_text)
    if policies is None:
        return set()
    names: set[str] = set()
    for policy in policies.values():
        if isinstance(policy, dict) and isinstance(policy.get("name"), str):
            names.add(policy["name"])
    return names


def _network_policies(policy_text: str) -> dict[str, object] | None:
    try:
        payload = yaml.safe_load(policy_text)
    except yaml.YAMLError:
        return None
    if not isinstance(payload, dict):
        return None
    policies = payload.get("network_policies")
    if not isinstance(policies, dict):
        return None
    return policies


def named_policy_shape(policy_text: str, policy_name: str) -> str | None:
    """Canonicalize the complete named policy while ignoring unrelated policies."""
    policies = _network_policies(policy_text)
    if policies is None:
        return None
    matches = [
        policy
        for policy in policies.values()
        if isinstance(policy, dict) and policy.get("name") == policy_name
    ]
    if len(matches) != 1:
        return None
    try:
        return _canonical_yaml(matches[0])
    except (TypeError, ValueError):
        return None


def _canonical_yaml(value: object) -> str:
    return json.dumps(
        _normalize_policy_value(value),
        sort_keys=True,
        separators=(",", ":"),
    )


def _normalize_policy_value(value: object, path: tuple[str, ...] = ()) -> object:
    if isinstance(value, dict):
        return {
            str(key): _normalize_policy_value(nested, (*path, str(key)))
            for key, nested in sorted(value.items(), key=lambda item: str(item[0]))
        }
    if isinstance(value, list):
        normalized = [_normalize_policy_value(item, path) for item in value]
        if path and path[-1] in {"endpoints", "rules", "binaries", "allowed_ips"}:
            return sorted(
                normalized,
                key=lambda item: json.dumps(item, sort_keys=True, separators=(",", ":")),
            )
        return normalized
    return value


def desired_policy_rules_present(
    current_text: str, desired_text: str, policy_name: str
) -> bool:
    """Require an exact named-policy match; unrelated policies are ignored."""
    desired = named_policy_shape(desired_text, policy_name)
    current = named_policy_shape(current_text, policy_name)
    return desired is not None and current == desired


def policy_update_action(
    policy_list: str, current_text: str, desired_text: str, policy_name: str
) -> str:
    exists = (
        policy_name in effective_policy_names(current_text)
        or listed_name(policy_list, policy_name)
    )
    if not exists:
        return "add"
    if not desired_policy_rules_present(current_text, desired_text, policy_name):
        return "refresh"
    return "keep"


def listed_name(output_text: str, expected: str) -> bool:
    boundary = rf"(?<![a-z0-9-]){re.escape(expected)}(?![a-z0-9-])"
    return re.search(boundary, output_text.lower()) is not None


def main() -> int:
    args = parse_args()
    if not valid_name(args.sandbox) or not valid_name(args.credential_name):
        print("Sandbox and credential names must be lowercase RFC 1123 labels.", file=sys.stderr)
        return 2
    nemoclaw = shutil.which("nemoclaw")
    if not nemoclaw:
        print(
            "NemoClaw is not installed. Follow NVIDIA's installer/onboarding guide, then rerun this script.",
            file=sys.stderr,
        )
        return 2
    openshell = shutil.which("openshell")
    if not openshell:
        print(
            "OpenShell is not installed in this account's PATH; repair NemoClaw before setup.",
            file=sys.stderr,
        )
        return 2

    status = subprocess.run(
        [nemoclaw, "sandbox", "status", args.sandbox, "--json"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        status_payload = json.loads(status.stdout)
    except json.JSONDecodeError:
        status_payload = {}
    if not isinstance(status_payload, dict):
        status_payload = {}
    if status.returncode != 0 or not status_payload.get("found", False):
        print(
            f"Sandbox {args.sandbox!r} is not onboarded. Run `nemoclaw onboard` first.",
            file=sys.stderr,
        )
        return 2

    credentials = output([nemoclaw, "credentials", "list"])
    credential_exists = listed_name(credentials, args.credential_name)
    attached = output([openshell, "sandbox", "provider", "list", args.sandbox])
    provider_attached = listed_name(attached, args.credential_name)
    provider_changed = False
    if args.replace_credential and credential_exists:
        if not os.environ.get("HAI_API_KEY"):
            print("--replace-credential requires an exported HAI_API_KEY.", file=sys.stderr)
            return 2
        if provider_attached:
            run(
                [
                    openshell,
                    "sandbox",
                    "provider",
                    "detach",
                    args.sandbox,
                    args.credential_name,
                ]
            )
            provider_attached = False
        run([nemoclaw, "credentials", "reset", args.credential_name, "--yes"])
        credential_exists = False
        provider_changed = True
    if not credential_exists:
        if not os.environ.get("HAI_API_KEY"):
            print(
                "Export a newly rotated HAI_API_KEY before registering the generic provider.",
                file=sys.stderr,
            )
            return 2
        run(
            [
                nemoclaw,
                "credentials",
                "add",
                args.credential_name,
                "--type",
                "generic",
                "--credential",
                "HAI_API_KEY",
            ]
        )
        provider_changed = True

    if not provider_attached:
        run(
            [
                openshell,
                "sandbox",
                "provider",
                "attach",
                args.sandbox,
                args.credential_name,
            ]
        )
        provider_changed = True

    if args.skip_rebuild and provider_changed:
        print(
            "The provider changed and requires a rebuild; rerun without --skip-rebuild.",
            file=sys.stderr,
        )
        return 2

    # The gateway now owns the value. Do not expose it to rebuild/upload probes.
    os.environ.pop("HAI_API_KEY", None)

    policy_name = f"arcflash-hcomputer-{args.region}"
    policy = REPOSITORY_ROOT / "infrastructure" / "nemoclaw" / f"hcomputer-{args.region}.yaml"
    policy_list = output([nemoclaw, args.sandbox, "policy-list"])
    if "source unverified" in policy_list.lower():
        print("NemoClaw policy state is source-unverified; recover the sandbox before setup.", file=sys.stderr)
        return 2
    policy_get = output([nemoclaw, args.sandbox, "policy-get"])
    policy_action = policy_update_action(
        policy_list,
        policy_get,
        policy.read_text(encoding="utf-8"),
        policy_name,
    )
    if policy_action == "add":
        run([nemoclaw, args.sandbox, "policy-add", "--from-file", str(policy), "--yes"])
    elif policy_action == "refresh":
        print(f"= refreshing changed policy {policy_name}")
        run(
            [
                nemoclaw,
                "sandbox",
                "policy",
                "remove",
                args.sandbox,
                policy_name,
                "--yes",
            ]
        )
        run([nemoclaw, args.sandbox, "policy-add", "--from-file", str(policy), "--yes"])
    else:
        print(f"= policy {policy_name} is already applied")

    if not args.skip_rebuild:
        run([nemoclaw, args.sandbox, "rebuild", "--yes"])

    run(
        [
            nemoclaw,
            args.sandbox,
            "exec",
            "--no-stdin",
            "--",
            "/usr/bin/mkdir",
            "-p",
            WORKER_DIRECTORY,
        ]
    )
    worker = REPOSITORY_ROOT / "backend" / "arcflash_api" / "arcflash_h_worker.py"
    run([nemoclaw, args.sandbox, "upload", str(worker), WORKER_DIRECTORY])

    run([nemoclaw, args.sandbox, "status", "--json"])
    run([nemoclaw, args.sandbox, "policy-list"])
    credential_ready, worker_ready = wait_for_worker_readiness(nemoclaw, args.sandbox)
    if not credential_ready:
        print(
            "The HAI_API_KEY provider placeholder did not become ready within 60 seconds.",
            file=sys.stderr,
        )
        return 1
    if not worker_ready:
        print(
            f"The ArcFlash worker was not readable at {WORKER_DESTINATION} within 60 seconds.",
            file=sys.stderr,
        )
        return 1
    print("ArcFlash NemoClaw worker is ready. You can now unset HAI_API_KEY in this shell.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
