"""plan_inputs ``route`` on the server (D97 waypoint block, packages WP3 and WP4;
contracts/backend/README.md "Route (v1.2.0, D97)", openapi.yaml ``Error.stop``).

A missing route and ``mode: auto`` are the same plan (the engine picks stations and order, F9):
nothing here applies to them. An ``ordered`` route is checked where plan_inputs are accepted
(POST /jobs, POST /plans/import) before a hash is taken, and a bad stop is a 422 whose
``Error.stop`` is its index in ``route.stops`` (``RouteError``; ``stop`` is None when the error
concerns the whole route). Checks, in this order (the first failing one answers):

1. ``route_mode_conflict`` (stop None): an ordered route together with ``stations.mode`` set/order
   or ``stations.custom`` (both stay cut, D69);
2. ``route_too_many_stops``: more than ``route.max_stops`` stops; stop = the first one over;
3. ``route_too_many_free_points``: more than ``route.max_free_points`` free points; stop = the
   first free point over;
4. per stop, in visiting order: ``route_label_too_long`` (a free point's label longer than
   ``limits.title_max_chars``), ``route_station_unknown`` (not in stations.json),
   ``route_station_duplicate`` (the same station again; stop = the repeat);
5. ``route_stop_spacing``: two stops, or a stop and the pad, closer than
   ``route.min_stop_spacing_m``: ``pipeline.engine.waypoints.stop_spacing_violations`` (great
   circle on the Mars sphere; a station at its stations.json position), and of several pairs the
   one the engine's own check picks (``traverse.check_spacing``, WP2b): the lowest later stop of
   a pair (the stop itself for a pad pair). stop = that later stop; the detail names both;
6. per free point, in visiting order, the cheap grid checks 1-3 of ``pipeline.engine.waypoints``
   under the DEFAULT scenario (variants.yaml ``scenarios.default``: the plan the user sees):
   ``route_point_outside_grid``, ``route_point_unassessed``, ``route_point_not_walkable``. They
   read only the cells within the D27 access radius of the server data routing grid
   (``routing_grid``: memory maps opened once per process; without server data
   ``pads.ServerDataMissing``, which the routes answer 503 ``server_data_missing``).

Every limit comes from config/backend.yaml (``settings()``), never a literal.

``route_point_unreachable`` (waypoints check 4: no walk from the pad; it runs the station Dijkstra
pair, as costly as the fields, ~7 s per point) is not checked at submit: the engine raises it in
the job (pipeline.engine.traverse.RouteStopError, for a station or a free point), and the job
ends ``error`` with the code and the stop in its message (server.engine.plan_job).
"""

from __future__ import annotations

import threading

from pipeline.engine.config import load as load_config
from server.engine import version
from server.engine.defaults import stations
from server.engine.hashing import canonical_inputs
from server.settings import BackendConfig, settings

AUTO, ORDERED = "auto", "ordered"
CUT_STATION_MODES = ("set", "order")  # stations.mode values an ordered route conflicts with


class RouteError(ValueError):
    """A 422 on a route: ``code`` (openapi Error.stop codes), ``stop`` (index or None)."""

    def __init__(self, code: str, stop: int | None, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code, self.stop, self.detail = code, stop, detail


# ------------------------------------------------------------------------------ reading ----
def mode(plan_inputs: dict) -> str:
    """``auto`` or ``ordered`` (a missing route is auto)."""
    return (plan_inputs.get("route") or {}).get("mode", AUTO)


def is_free(stop: dict) -> bool:
    return "station" not in stop


def engine_route(plan_inputs: dict) -> list | None:
    """The ordered route as build_plan's ``route`` takes it, or None for auto: the stops in
    visiting order, a station as its id (``"S4"``), a free point as ``{"lon", "lat"}`` (its
    label stays out of the engine; ``record_inputs`` puts it back in the run record)."""
    if mode(plan_inputs) != ORDERED:
        return None
    return [{"lon": s["lon"], "lat": s["lat"]} if is_free(s) else s["station"]
            for s in plan_inputs["route"]["stops"]]


def stop_name(stops: list[dict], i: int) -> str:
    """How a detail names stop ``i``: its station id, or W<k> (its order among the free stops,
    contracts README) with its label if any."""
    s = stops[i]
    if not is_free(s):
        return s["station"]
    k = sum(is_free(t) for t in stops[:i + 1])
    return f"W{k} {s['label']!r}" if s.get("label") else f"W{k}"


def _say(stops: list[dict], i: int, what: str) -> str:
    return f"stop {i} ({stop_name(stops, i)}): {what}"


# ------------------------------------------------------------------------- the grid ----
_GRID_LOCK = threading.Lock()
_GRID: tuple | None = None  # (server data key, Grid)


def routing_grid():
    """The server data routing grid (pads.open_grid: read-only memory maps), opened once per
    process and again only when the server data manifest changes (the pad tool's rule).
    Raises pads.ServerDataMissing without server data."""
    from server.engine import pads

    global _GRID
    root = version.server_data_dir()
    key = pads._key(root)
    with _GRID_LOCK:
        if _GRID is None or _GRID[0] != key:
            _GRID = None
            _GRID = (key, pads.open_grid(root))
        return _GRID[1]


def default_scenario() -> str:
    return str(load_config("variants")["scenarios"]["default"])


def point_problem(grid, lon: float, lat: float, scenario: str) -> tuple[str, str] | None:
    """(code, message) of the cheap free-point checks 1-3 under ``scenario``, or None:
    ``waypoints.point_precheck`` (no Dijkstra, only the cells within the access radius; ~1 ms per
    point on the real grid, where point_validity's check 4 costs ~10 s)."""
    from pipeline.engine import waypoints

    return waypoints.point_precheck(grid, float(lon), float(lat), scenario=scenario)


# ----------------------------------------------------------------------------- checking ----
def _spacing(stops: list[dict], where: list[tuple[float, float]], pad: tuple[float, float],
             min_m: float) -> RouteError | None:
    """The route_stop_spacing refusal (module doc, check 5), or None."""
    from pipeline.engine.stations import bearing_dist
    from pipeline.engine.waypoints import stop_spacing_violations

    pairs = stop_spacing_violations(where, pad, min_m)
    if not pairs:
        return None
    # traverse.check_spacing's pick (WP2b), so the server and the engine name the same stop
    i, j = min(pairs, key=lambda ij: (ij[1] if ij[1] >= 0 else ij[0], ij[0]))
    if j < 0:
        at, other, q = i, "the pad", pad
    else:
        at, other, q = j, f"stop {i} ({stop_name(stops, i)})", where[i]
    d = bearing_dist(*where[at], *q)[1]
    return RouteError("route_stop_spacing", at, _say(
        stops, at, f"{d:.1f} m from {other}; stops are at least {min_m:g} m apart "
        "(route.min_stop_spacing_m, great circle)"))


def check(plan_inputs: dict, cfg: BackendConfig | None = None, grid=None) -> None:
    """Raise RouteError for the first bad stop of an ordered route (module doc). ``plan_inputs``
    must already validate against plan_inputs.schema.json (canonical_inputs). Auto: no check.
    ``grid``: the routing grid for the free-point checks (default ``routing_grid()``, opened only
    when the route has a free point and every earlier check passed)."""
    route = plan_inputs.get("route")
    if not route or route.get("mode", AUTO) != ORDERED:
        return
    cfg = cfg or settings()
    lim = cfg.route
    c = canonical_inputs(plan_inputs, cfg)
    st = c["stations"]
    if st.get("mode") in CUT_STATION_MODES or st.get("custom"):
        what = (f"stations.mode {st['mode']!r}" if st.get("mode") in CUT_STATION_MODES
                else "stations.custom")
        raise RouteError("route_mode_conflict", None,
                         f"an ordered route sets the stops and their order; {what} cannot be "
                         "combined with it (stations.mode set/order and stations.custom are cut, "
                         "D69)")
    stops = route["stops"]
    if len(stops) > lim.max_stops:
        raise RouteError("route_too_many_stops", lim.max_stops,
                         _say(stops, lim.max_stops, f"a route has at most {lim.max_stops} stops "
                              f"(route.max_stops); this one has {len(stops)}"))
    free = [i for i, s in enumerate(stops) if is_free(s)]
    if len(free) > lim.max_free_points:
        i = free[lim.max_free_points]
        raise RouteError("route_too_many_free_points", i,
                         _say(stops, i, f"a route has at most {lim.max_free_points} free points "
                              f"(route.max_free_points); this one has {len(free)}"))

    known = {s["id"]: s for s in stations()}
    seen: dict[str, int] = {}
    where: list[tuple[float, float]] = []
    for i, s in enumerate(stops):
        if is_free(s):
            label = s.get("label")
            if isinstance(label, str) and len(label) > cfg.limits.title_max_chars:
                raise RouteError("route_label_too_long", i, _say(
                    stops, i, f"the label has {len(label)} characters; at most "
                    f"{cfg.limits.title_max_chars} (limits.title_max_chars)"))
            where.append((float(s["lon"]), float(s["lat"])))
            continue
        sid = s["station"]
        if sid not in known:
            raise RouteError("route_station_unknown", i, _say(
                stops, i, f"unknown station (stations.json has {sorted(known)})"))
        if sid in seen:
            raise RouteError("route_station_duplicate", i, _say(
                stops, i, f"station {sid} is already stop {seen[sid]}; a route visits each "
                "station once"))
        seen[sid] = i
        where.append((float(known[sid]["lon"]), float(known[sid]["lat"])))

    pad = (float(c["pad"]["lon"]), float(c["pad"]["lat"]))
    err = _spacing(stops, where, pad, float(lim.min_stop_spacing_m))
    if err is not None:
        raise err

    if not free:
        return
    grid = routing_grid() if grid is None else grid
    scenario = default_scenario()
    for i in free:
        bad = point_problem(grid, stops[i]["lon"], stops[i]["lat"], scenario)
        if bad is not None:
            raise RouteError(bad[0], i, _say(stops, i, f"{bad[1]} ({scenario}, the default "
                                                        "scenario)"))


def validate(plan_inputs: dict, cfg: BackendConfig | None = None, grid=None) -> None:
    """What POST /jobs and POST /plans/import run (``check``; free points are planned, D97)."""
    check(plan_inputs, cfg, grid)


def record_inputs(plan_inputs: dict, canonical: dict) -> dict:
    """Run-record / ImportResult inputs: the canonical inputs (what was hashed) plus what the UI
    shows but the hash leaves out: the title and each free point's label, put back on its stop."""
    out = {**canonical}
    if "title" in plan_inputs:
        out["title"] = plan_inputs["title"]
    given = (plan_inputs.get("route") or {}).get("stops") or []
    if "route" in out and any(isinstance(s, dict) and "label" in s for s in given):
        stops = [dict(s) for s in out["route"]["stops"]]
        for s, g in zip(stops, given, strict=True):
            if "label" in g:
                s["label"] = g["label"]
        out["route"] = {**out["route"], "stops": stops}
    return out
