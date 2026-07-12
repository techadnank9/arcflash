from __future__ import annotations

import asyncio
from collections.abc import Callable
from importlib import import_module
import math
import time

from .errors import ServiceError


CV104_CALCULATION_TIMEOUT_SECONDS = 45.0
CV104_CALCULATION_COOLDOWN_SECONDS = 15.0


class CV104CalculationService:
    """Run the fixed open-source comparison without coupling it to H or Electrisim."""

    def __init__(
        self,
        generator: Callable[[], dict[str, object]] | None = None,
        timeout_seconds: float = CV104_CALCULATION_TIMEOUT_SECONDS,
        cooldown_seconds: float = CV104_CALCULATION_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._generator = generator
        self._timeout_seconds = timeout_seconds
        self._cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._state_lock = asyncio.Lock()
        self._inflight: asyncio.Task[dict[str, object]] | None = None
        self._last_completed_at: float | None = None
        self._last_recorded_task: asyncio.Task[dict[str, object]] | None = None

    async def calculate(self) -> dict[str, object]:
        task = await self._start_one()
        try:
            return await asyncio.wait_for(asyncio.shield(task), self._timeout_seconds)
        except TimeoutError as error:
            raise ServiceError(
                504,
                "CV104_CALCULATION_TIMEOUT",
                "The independent CV-104 comparison exceeded its execution limit.",
            ) from error
        except (ImportError, ModuleNotFoundError) as error:
            raise ServiceError(
                503,
                "CV104_CALCULATION_UNAVAILABLE",
                "The independent CV-104 calculation engines are not installed.",
            ) from error
        except ServiceError:
            raise
        except Exception as error:
            raise ServiceError(
                500,
                "CV104_CALCULATION_FAILED",
                "The independent CV-104 comparison failed.",
            ) from error
        finally:
            if task.done():
                self._record_completion(task)
                async with self._state_lock:
                    if self._inflight is task:
                        self._inflight = None

    async def _start_one(self) -> asyncio.Task[dict[str, object]]:
        async with self._state_lock:
            if self._inflight is not None:
                if not self._inflight.done():
                    raise ServiceError(
                        429,
                        "CV104_CALCULATION_BUSY",
                        "An independent CV-104 comparison is already running.",
                    )
                self._record_completion(self._inflight)
                self._inflight = None
            self._reject_cooldown()
            task = asyncio.create_task(asyncio.to_thread(self._generate))
            task.add_done_callback(self._record_completion)
            self._inflight = task
            return task

    def _record_completion(self, task: asyncio.Task[dict[str, object]]) -> None:
        if task.cancelled():
            return
        task.exception()
        if self._last_recorded_task is task:
            return
        self._last_recorded_task = task
        self._last_completed_at = self._clock()

    def _reject_cooldown(self) -> None:
        if self._last_completed_at is None:
            return
        remaining = self._cooldown_seconds - (self._clock() - self._last_completed_at)
        if remaining > 0:
            raise ServiceError(
                429,
                "CV104_CALCULATION_COOLDOWN",
                "Wait before running the independent CV-104 comparison again.",
                {"retryAfterSeconds": math.ceil(remaining)},
            )

    def _generate(self) -> dict[str, object]:
        generator = self._generator
        if generator is None:
            module = import_module("engine.generate_cv104_study")
            generator = getattr(module, "generate")
        result = generator()
        if not isinstance(result, dict):
            raise TypeError("CV-104 generator returned a non-object result.")
        return result
