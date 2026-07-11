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
