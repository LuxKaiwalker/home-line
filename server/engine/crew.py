"""Custom crew (WS11 brief task 11, plan row 3.2; F26): engine overrides, crew hash, and the
on-demand station fields cache.

Every number comes from pipeline/engine (WS11 rule 1); nothing here computes physiology.

- **Overrides.** The plan_inputs crew fields that ``pipeline.engine.physio.CREW_KEYS`` names
  (body_mass_kg, tools_kg, vo2max_ml_kg_min, effort_cap_frac) reach the engine through the
  committed crew-as-parameter path: ``build_plan(crew=...)`` -> ``physio.params(crew=...)``
  (WS2 PR #4). ``overrides`` returns None for the default crew, so a default-crew plan makes
  exactly the build_plan call it made before this package (byte-identical trees, same hash).
- **Not overridable yet.** ``crew.suit_kg``: build_plan takes the suit only through scenario
  ids ({variant}_{suit}, an integer) and routes, partners and cards only the variants.yaml
  default scenario, so a suit other than crew.default_suit_kg has no build_plan path
  (``unsupported``; the job fails naming it, never silently ignoring it).
- **Crew hash.** sha256 over the four engine crew values (physio.crew_values: config values for
  the ones not given) and the engine identity (engine tree, config hash, terrain hash; D57), so
  a cache entry never outlives the engine or the data it was computed with.
- **Station fields** (F26: "a changed crew changes every edge cost, so station fields are
  recomputed (<= 2 searches per station), cached by hash"). make serverdata's ``fields/`` hold
  them for the default crew only. For another crew ``station_fields`` computes the pair through
  ``pipeline.engine.padpick.station_fields(..., crew=...)`` and caches it in
  ``$HL_SERVER_DATA/cache/station_fields/{crew_hash}/{scenario}/{S}.{forward,reverse}.npy``
  (float32 minutes, inf = unreached, the format of make serverdata's fields) with
  ``{S}.json`` (written last: its presence marks a complete entry; it also records a station
  without an access cell, so that is cached too). Every job with the same crew reuses them.
  LIMITATION: build_plan / traverse.plan take no precomputed station fields (E8 hand-off), so
  the route inside build_plan still runs its own station searches; the cache is what a WS2
  ``station_fields`` input to build_plan (or replan/siting) will read.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from server.engine import version
from server.engine.hashing import EngineIdentity, canonical_inputs, engine_identity, official_inputs

log = logging.getLogger(__name__)

CACHE_DIR = ("cache", "station_fields")  # under $HL_SERVER_DATA
KINDS = ("forward", "reverse")


# ------------------------------------------------------------------------ inputs ----
def _crew(inputs: dict) -> dict:
    return canonical_inputs(inputs)["crew"]


def _default_crew() -> dict:
    return canonical_inputs(official_inputs())["crew"]


def engine_keys() -> tuple[str, ...]:
    """The plan_inputs crew fields build_plan takes (physio.CREW_KEYS, same names)."""
    from pipeline.engine.physio import CREW_KEYS

    return tuple(CREW_KEYS)


def is_default(inputs: dict) -> bool:
    return _crew(inputs) == _default_crew()


def overrides(inputs: dict) -> dict | None:
    """build_plan's ``crew`` argument: None for the default crew (the call stays as it was),
    else every engine crew value of the canonical inputs."""
    c = _crew(inputs)
    if c == _default_crew():
        return None
    return {k: c[k] for k in engine_keys()}


def unsupported(inputs: dict) -> list[str]:
    """Dotted crew fields that differ from the defaults but have no build_plan path."""
    c, d = _crew(inputs), _default_crew()
    keys = set(engine_keys())
    return [f"crew.{k}" for k in sorted(set(c) | set(d)) if k not in keys and c.get(k) != d.get(k)]


def crew_hash(crew: dict | None, identity: EngineIdentity | None = None) -> str:
    """16 hex chars: the engine crew values (config values filled in) + the engine identity."""
    from pipeline.engine.physio import crew_values

    ident = EngineIdentity(*(identity or engine_identity()))
    values = {k: round(float(v), 6) + 0.0 for k, v in crew_values(crew).items()}
    doc = {"crew": values, **ident._asdict()}
    payload = json.dumps(doc, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


# ---------------------------------------------------------------- station fields ----
@dataclass
class StationFields:
    station: str
    scenario: str
    crew_hash: str
    hit: bool  # True: read from the cache; False: computed now
    access_rc: tuple[int, int] | None = None
    no_access: str | None = None  # physio.MissingInput message when the station has no cell
    forward: np.ndarray | None = None  # float32 minutes (memory map on a hit); None if not loaded
    reverse: np.ndarray | None = None


def cache_root() -> Path:
    return version.server_data_dir().joinpath(*CACHE_DIR)


def entry_dir(key: str, scenario: str, root: Path | None = None) -> Path:
    return (root or cache_root()) / key / scenario


def _atomic(path: Path, write) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(tmp, "wb") as fh:
        write(fh)
    os.replace(tmp, path)


def station_fields(grid, station: dict, scenario: str, crew: dict | None, *,
                   key: str | None = None, root: Path | None = None, settings=None,
                   load: bool = True) -> StationFields:
    """The (forward, reverse) station fields of ``station`` for ``scenario`` and ``crew``, from
    the cache or computed by padpick.station_fields and cached. ``load=False`` checks or fills
    the cache without returning the arrays."""
    from pipeline.engine import padpick
    from pipeline.engine.physio import MissingInput

    key = key or crew_hash(crew)
    d = entry_dir(key, scenario, root)
    sid = str(station["id"])
    meta_p = d / f"{sid}.json"
    if meta_p.is_file():
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        out = StationFields(sid, scenario, key, True, no_access=meta.get("no_access"))
        if meta.get("access_rc") is not None:
            out.access_rc = (int(meta["access_rc"][0]), int(meta["access_rc"][1]))
            if load:
                out.forward, out.reverse = (np.load(d / meta[k], mmap_mode="r") for k in KINDS)
        return out

    d.mkdir(parents=True, exist_ok=True)
    meta = {"station": sid, "scenario": scenario, "crew_hash": key,
            "crew": {k: float(v) for k, v in _crew_values(crew).items()},
            "dtype": "float32", "units": "min", "unreached": "inf"}
    try:
        fwd, rev = padpick.station_fields(grid, station, scenario, settings, crew=crew)
    except MissingInput as e:
        meta["no_access"] = str(e)
        _atomic(meta_p, lambda fh: fh.write(_dump(meta)))
        return StationFields(sid, scenario, key, False, no_access=str(e))
    arrays = {"forward": fwd.t_min.astype(np.float32), "reverse": rev.t_min.astype(np.float32)}
    for kind, arr in arrays.items():
        meta[kind] = f"{sid}.{kind}.npy"
        _atomic(d / meta[kind], lambda fh, a=arr: np.save(fh, np.ascontiguousarray(a),
                                                          allow_pickle=False))
    meta["access_rc"] = [int(v) for v in fwd.seeds[0]]
    _atomic(meta_p, lambda fh: fh.write(_dump(meta)))
    out = StationFields(sid, scenario, key, False, access_rc=tuple(meta["access_rc"]))
    if load:
        out.forward, out.reverse = arrays["forward"], arrays["reverse"]
    return out


def _crew_values(crew: dict | None) -> dict:
    from pipeline.engine.physio import crew_values

    return crew_values(crew)


def _dump(doc: dict) -> bytes:
    return (json.dumps(doc, indent=1, sort_keys=True) + "\n").encode("utf-8")


def ensure_station_fields(grid, stations_json: Path, scenarios: list[str], crew: dict | None, *,
                          root: Path | None = None) -> dict:
    """Fill the cache for every positioned station of ``stations_json`` and every scenario;
    returns {crew_hash, hits, computed, no_access: {scenario: [S]}} (nothing is kept in memory)."""
    from pipeline.engine import padpick
    from pipeline.engine.stations import load_ws1_stations

    key = crew_hash(crew)
    settings = padpick.settings_from_config()
    st_list, _ = load_ws1_stations(stations_json)
    stats: dict = {"crew_hash": key, "hits": 0, "computed": 0, "no_access": {}}
    for sc in scenarios:
        for st in st_list:
            r = station_fields(grid, st, sc, crew, key=key, root=root, settings=settings,
                               load=False)
            stats["hits" if r.hit else "computed"] += 1
            if r.no_access is not None:
                stats["no_access"].setdefault(sc, []).append(r.station)
    log.info("station fields crew %s %s: %d cached, %d computed, no access %s", key,
             scenarios, stats["hits"], stats["computed"], stats["no_access"])
    return stats
