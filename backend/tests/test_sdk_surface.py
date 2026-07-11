from __future__ import annotations

from hai_agents import AsyncClient, HaiAgentsEnvironment


def test_pinned_h_sdk_exposes_required_async_surface() -> None:
    client = AsyncClient(api_key="offline-contract-check")
    assert callable(client.sessions.create_session)
    assert callable(client.sessions.get_session)
    assert callable(client.sessions.get_session_changes)
    assert callable(client.sessions.pause_session)
    assert callable(client.sessions.resume_session)
    assert callable(client.sessions.cancel_session)
    assert HaiAgentsEnvironment.EU.value == "https://agp.eu.hcompany.ai"
    assert HaiAgentsEnvironment.US.value == "https://agp.hcompany.ai"
