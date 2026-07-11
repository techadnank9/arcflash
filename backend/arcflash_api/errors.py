from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ServiceError(Exception):
    status_code: int
    code: str
    message: str
    detail: Any = None

    def __str__(self) -> str:
        return self.message
