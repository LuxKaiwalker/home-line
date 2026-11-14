"""Config access for WS4 (AGENTS.md rule 2: every constant comes from config/)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

import yaml

REPO = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO / "config"
RAW = REPO / "data" / "raw" / "conditions"
INTERIM = REPO / "data" / "interim"

PENDING = "verify_at_h0"


class ConfigPending(RuntimeError):
    """A config value is still the ``verify_at_h0`` placeholder."""


@cache
def load(name: str) -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / f"{name}.yaml").read_text())


def load_conditions() -> dict[str, Any]:
    return load("conditions")


def h0_utc() -> datetime:
    return parse_utc(str(load("event")["h0_utc"]))


def site_latlon() -> tuple[float, float]:
    """(lat, lon_east) of the Gale site for the sun: config/site.yaml pad_default."""
    if load_conditions()["clock"]["site"] != "config/site.yaml pad_default":
        raise NotImplementedError("clock.site must be 'config/site.yaml pad_default'")
    pad = load("site")["pad_default"]
    return float(pad["lat"]), float(pad["lon"])


def eva_min() -> float:
    """Simulated EVA length in minutes (config/crew.yaml eva_h)."""
    return 60.0 * float(load("crew")["eva_h"])


def require(value: Any, what: str) -> Any:
    if value == PENDING:
        raise ConfigPending(f"config {what} is '{PENDING}'; fill it from docs/discovery.md")
    return value


def parse_utc(text: str) -> datetime:
    """ISO 8601 with Z or offset -> aware UTC datetime; naive input is refused."""
    t = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise ValueError(f"timestamp without timezone: {text!r}")
    return t.astimezone(UTC)


def fmt_utc(t: datetime) -> str:
    """Aware datetime -> ``YYYY-MM-DDTHH:MM:SSZ`` (rounded to the second)."""
    t = t.astimezone(UTC)
    if t.microsecond >= 500_000:
        t = t + timedelta(microseconds=1_000_000 - t.microsecond)
    return t.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
