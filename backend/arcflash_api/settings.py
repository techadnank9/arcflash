from __future__ import annotations

from functools import lru_cache
import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from the process and local env files."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    port: int = Field(default=8787, ge=1, le=65535)
    hcomputer_enabled: bool = True
    hai_api_key: SecretStr | None = None
    gradium_api_key: SecretStr | None = None
    hai_region: Literal["eu", "us"] = "eu"
    hcomputer_agent: str = "h/web-surfer-pro"
    public_app_url: str | None = None

    nemoclaw_mode: Literal["required", "preferred", "off"] = "required"
    nemoclaw_sandbox: str = "arcflash-copilot"
    nemoclaw_credential_name: str = "arcflash-hcomputer"
    nemoclaw_worker_path: str = (
        "/sandbox/.openclaw/workspace/arcflash/worker/arcflash_h_worker.py"
    )
    nemoclaw_exec_timeout_seconds: int = Field(default=45, ge=5, le=600)
    nemoclaw_status_cache_seconds: float = Field(default=5.0, ge=0, le=60)

    @field_validator("public_app_url")
    @classmethod
    def normalize_public_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().rstrip("/")
        parsed = urlsplit(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("PUBLIC_APP_URL must be an absolute HTTP(S) origin.")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("PUBLIC_APP_URL must be an origin without a path, query, or fragment.")
        return normalized

    @field_validator("nemoclaw_sandbox", "nemoclaw_credential_name")
    @classmethod
    def validate_runtime_name(cls, value: str) -> str:
        if not re.fullmatch(r"(?:[a-z]|[a-z][a-z0-9-]{0,61}[a-z0-9])", value):
            raise ValueError("NemoClaw names must be lowercase RFC 1123 labels.")
        return value

    @field_validator("nemoclaw_worker_path")
    @classmethod
    def validate_worker_path(cls, value: str) -> str:
        prefix = "/sandbox/.openclaw/workspace/arcflash/"
        if not value.startswith(prefix) or ".." in value or "\n" in value or "\r" in value:
            raise ValueError(f"NEMOCLAW_WORKER_PATH must stay below {prefix}")
        return value

    @property
    def h_api_host(self) -> str:
        return "agp.hcompany.ai" if self.hai_region == "us" else "agp.eu.hcompany.ai"

    @property
    def nemoclaw_policy_name(self) -> str:
        return f"arcflash-hcomputer-{self.hai_region}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
