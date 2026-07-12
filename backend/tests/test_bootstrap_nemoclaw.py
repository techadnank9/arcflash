from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "bootstrap_nemoclaw.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_nemoclaw", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
bootstrap_nemoclaw = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bootstrap_nemoclaw)
effective_policy_names = bootstrap_nemoclaw.effective_policy_names
listed_name = bootstrap_nemoclaw.listed_name
desired_policy_rules_present = bootstrap_nemoclaw.desired_policy_rules_present
policy_update_action = bootstrap_nemoclaw.policy_update_action


def test_effective_policy_names_reads_custom_network_policy() -> None:
    policy = """
version: 1
network_policies:
  arcflash_hcomputer:
    name: arcflash-hcomputer-us
    endpoints: []
  pypi:
    name: pypi
    endpoints: []
"""

    assert effective_policy_names(policy) == {"arcflash-hcomputer-us", "pypi"}


def test_effective_policy_names_rejects_invalid_yaml_shape() -> None:
    assert effective_policy_names("network_policies: []\n") == set()
    assert effective_policy_names("network_policies: [") == set()


def test_listed_name_uses_exact_provider_boundaries() -> None:
    listing = "arcflash-hcomputer-old generic\narcflash-hcomputer generic\n"

    assert listed_name(listing, "arcflash-hcomputer") is True
    assert listed_name("arcflash-hcomputer-old generic", "arcflash-hcomputer") is False


def test_policy_refresh_detects_new_least_privilege_rule() -> None:
    current = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: POST, path: /api/v2/sessions}
    binaries:
      - {path: /usr/bin/python3*}
"""
    desired = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: POST, path: /api/v2/sessions}
          - allow: {method: GET, path: /api/v1/trajectories/*/resources/*/*/*}
    binaries:
      - {path: /usr/bin/python3*}
"""

    assert desired_policy_rules_present(current, desired, "arcflash-hcomputer-us") is False
    assert desired_policy_rules_present(desired, desired, "arcflash-hcomputer-us") is True


def test_policy_refresh_detects_endpoint_identity_drift() -> None:
    desired = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: GET, path: /api/v1/trajectories/*/resources/*/*/*}
    binaries:
      - {path: /usr/bin/python3*}
"""
    changed = (
        desired.replace("agp.hcompany.ai", "example.com"),
        desired.replace("port: 443", "port: 8443"),
        desired.replace("protocol: rest", "protocol: tls"),
    )

    for current in changed:
        assert desired_policy_rules_present(
            current, desired, "arcflash-hcomputer-us"
        ) is False


def test_named_policy_with_empty_policy_get_is_refreshed_not_blindly_added() -> None:
    desired = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: GET, path: /api/v1/trajectories/*/resources/*/*/*}
    binaries:
      - {path: /usr/bin/python3*}
"""

    assert policy_update_action(
        "arcflash-hcomputer-us [user-added]",
        "",
        desired,
        "arcflash-hcomputer-us",
    ) == "refresh"
    assert policy_update_action("", "", desired, "arcflash-hcomputer-us") == "add"


def test_policy_exact_match_rejects_broader_rules_binaries_and_enforcement() -> None:
    desired = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: GET, path: /api/v2/sessions/*}
    binaries:
      - {path: /usr/bin/python3*}
"""
    broader_rule = desired.replace(
        "    binaries:",
        "          - allow: {method: GET, path: /api/*}\n    binaries:",
    )
    broader_binary = desired.replace(
        "      - {path: /usr/bin/python3*}",
        "      - {path: /usr/bin/python3*}\n      - {path: /bin/bash}",
    )
    changed_enforcement = desired.replace("enforcement: enforce", "enforcement: monitor")
    extra_access = desired.replace(
        "        enforcement: enforce",
        "        enforcement: enforce\n        allowed_ips: [0.0.0.0/0]",
    )

    for current in (broader_rule, broader_binary, changed_enforcement, extra_access):
        assert desired_policy_rules_present(
            current, desired, "arcflash-hcomputer-us"
        ) is False
        assert policy_update_action(
            "arcflash-hcomputer-us [user-added]",
            current,
            desired,
            "arcflash-hcomputer-us",
        ) == "refresh"


def test_policy_exact_match_ignores_unrelated_named_policies_and_order() -> None:
    desired = """
network_policies:
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - host: agp.hcompany.ai
        port: 443
        protocol: rest
        enforcement: enforce
        rules:
          - allow: {method: GET, path: /api/v2/sessions/*}
          - allow: {method: POST, path: /api/v2/sessions}
    binaries:
      - {path: /usr/bin/python3*}
      - {path: /usr/local/bin/python3*}
"""
    current = """
network_policies:
  unrelated:
    name: pypi
    endpoints:
      - host: pypi.org
        port: 443
        protocol: rest
        enforcement: monitor
        rules:
          - allow: {method: GET, path: "*"}
    binaries:
      - {path: /bin/bash}
  h:
    name: arcflash-hcomputer-us
    endpoints:
      - enforcement: enforce
        protocol: rest
        port: 443
        host: agp.hcompany.ai
        rules:
          - allow: {path: /api/v2/sessions, method: POST}
          - allow: {path: /api/v2/sessions/*, method: GET}
    binaries:
      - {path: /usr/local/bin/python3*}
      - {path: /usr/bin/python3*}
"""

    assert desired_policy_rules_present(current, desired, "arcflash-hcomputer-us") is True
    assert policy_update_action(
        "arcflash-hcomputer-us [user-added]\npypi [built-in]",
        current,
        desired,
        "arcflash-hcomputer-us",
    ) == "keep"
