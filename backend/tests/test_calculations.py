from __future__ import annotations

import asyncio
import threading

import pytest

from arcflash_api.calculations import CV104CalculationService
from arcflash_api.errors import ServiceError


@pytest.mark.asyncio
async def test_fixed_calculation_returns_generator_payload() -> None:
    payload = {"project": "CV-104", "results": [{"equipment_id": "SWGR-01"}]}
    service = CV104CalculationService(generator=lambda: payload, timeout_seconds=1)

    assert await service.calculate() == payload


@pytest.mark.asyncio
async def test_calculation_has_one_inflight_run() -> None:
    started = threading.Event()
    release = threading.Event()

    def generate() -> dict[str, object]:
        started.set()
        release.wait(2)
        return {"project": "CV-104"}

    service = CV104CalculationService(generator=generate, timeout_seconds=2)
    first = asyncio.create_task(service.calculate())
    assert await asyncio.to_thread(started.wait, 1)

    with pytest.raises(ServiceError) as captured:
        await service.calculate()

    assert captured.value.status_code == 429
    assert captured.value.code == "CV104_CALCULATION_BUSY"
    release.set()
    assert await first == {"project": "CV-104"}


@pytest.mark.asyncio
async def test_calculation_timeout_is_stable_and_work_remains_bounded() -> None:
    release = threading.Event()

    def generate() -> dict[str, object]:
        release.wait(2)
        return {"project": "CV-104"}

    service = CV104CalculationService(generator=generate, timeout_seconds=0.01)

    with pytest.raises(ServiceError) as captured:
        await service.calculate()
    assert captured.value.status_code == 504
    assert captured.value.code == "CV104_CALCULATION_TIMEOUT"

    with pytest.raises(ServiceError) as busy:
        await service.calculate()
    assert busy.value.code == "CV104_CALCULATION_BUSY"
    release.set()


@pytest.mark.asyncio
async def test_missing_optional_engines_have_stable_error() -> None:
    def unavailable() -> dict[str, object]:
        raise ModuleNotFoundError("pandapower")

    service = CV104CalculationService(generator=unavailable, timeout_seconds=1)

    with pytest.raises(ServiceError) as captured:
        await service.calculate()

    assert captured.value.status_code == 503
    assert captured.value.code == "CV104_CALCULATION_UNAVAILABLE"


@pytest.mark.asyncio
async def test_completed_calculation_has_global_cooldown() -> None:
    now = [50.0]
    service = CV104CalculationService(
        generator=lambda: {"project": "CV-104"},
        timeout_seconds=1,
        cooldown_seconds=15,
        clock=lambda: now[0],
    )

    assert await service.calculate() == {"project": "CV-104"}

    with pytest.raises(ServiceError) as cooling_down:
        await service.calculate()
    assert cooling_down.value.status_code == 429
    assert cooling_down.value.code == "CV104_CALCULATION_COOLDOWN"
    assert cooling_down.value.detail == {"retryAfterSeconds": 15}

    now[0] += 15
    assert await service.calculate() == {"project": "CV-104"}
