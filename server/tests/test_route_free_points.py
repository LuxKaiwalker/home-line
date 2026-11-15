"""Free points ({lon, lat, label?}) in an ordered route on the server (D97 waypoint block, WP4).

Known answers (written before the code):
- a free point is checked at submit against the server data routing grid under the DEFAULT
  scenario with the cheap checks 1-3 of pipeline.engine.waypoints: route_point_outside_grid,
  route_point_unassessed, route_point_not_walkable, each a 422 whose Error.stop is the free
  point's index and whose detail names it (W<k> and its label); the answer equals
  waypoints.point_validity's code for the same point and scenario (no copy of the rule);
- route_point_unreachable is NOT a submit check (a sealed pocket passes; the job answers it);
- spacing is the engine's great circle (waypoints.stop_spacing_violations, Mars sphere), the pad
  included: the 422 names both stops and the stop is the later one, the stop the engine's
  traverse.check_spacing names (WP2b) for the same route;
- 5 free points (route.max_free_points 4) -> route_too_many_free_points naming the 5th;
- a valid mixed route is accepted (POST /jobs 202, /plans/import 200) and goes to build_plan as
  station ids and {lon, lat} dicts in visiting order, labels stripped, with route_min_spacing_m
  from config; the labels come back in the run record's inputs, and a record whose feasibility
  names W ids validates;
- the grid is opened once per process; a route of stations never opens it; without server data a
  free point is 503 server_data_missing;
- auto and missing routes make today's call
  (test_route_job.test_auto_or_missing_route_is_todays_call).
"""

from __future__ import annotations

import json

import numpy as np
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from pipeline.engine import waypoints  # noqa: E402
from pipeline.engine.geo import lonlat_of_xy  # noqa: E402
from pipeline.engine.graph import BLOCKED, UNKNOWN  # noqa: E402
from pipeline.engine.stations import bearing_dist  # noqa: E402
from pipeline.engine.synthetic import dummy_world, pad_xy  # noqa: E402
from server.engine import pads, plan_job  # noqa: E402
from server.engine import route as route_mod  # noqa: E402
from server.engine.hashing import canonical_inputs, result_hash  # noqa: E402
from server.settings import settings  # noqa: E402
from server.tests import test_route_job as RJ  # noqa: E402
from server.tests.test_jobs import assert_valid  # noqa: E402
from server.tests.test_limits import IP_A, app_clients  # noqa: E402
from server.tests.test_plan_job import IDENT, custom_inputs  # noqa: E402
from server.tests.test_route_job import (  # noqa: E402
    FEASIBLE,
    Recorder,
    _record,
    st,
    station,
)

world = RJ.world  # the synthetic job world and the empty server data, by name (fixtures)
api_data = RJ.api_data

PREFIX = settings().api.prefix
# dummy_world(3.0, half_m=700): 467 x 467 cells, the pad at the centre (pipeline/engine/tests
# /test_waypoints.py geometry)
HOLE = (351, 351)  # docs/dummy.md nodata hole (r 80 m): no measured terrain within 50 m
CLIFF = (100, 120)  # 70 m disc of known terrain, all blocked and 40 deg
SEALED = (380, 80)  # assessed pocket sealed by a blocked ring wider than the access radius
OPEN = ((60, 60), (300, 120), (400, 100))  # open terrain, far from the pad and each other


def pad_of(g) -> tuple[int, int]:
    """The pad cell (dummy_world centres the grid on the default pad)."""
    return g.rc_of_xy(*pad_xy())


def _disc(g, center, radius_cells):
    rr, cc = np.mgrid[0 : g.shape[0], 0 : g.shape[1]]
    return np.hypot(rr - center[0], cc - center[1]) <= radius_cells


@pytest.fixture(scope="module")
def grid():
    g, pad_rc, _ = dummy_world(3.0, half_m=700.0)
    g.cellstate = g.cellstate.copy()
    g.maxslope = g.maxslope.copy()
    cliff = _disc(g, CLIFF, 70.0 / 3.0)
    g.cellstate[cliff] = BLOCKED
    g.maxslope[cliff] = 40.0
    ring = _disc(g, SEALED, 20.0) & ~_disc(g, SEALED, 18.0)
    g.cellstate[ring] = BLOCKED
    g.maxslope[ring] = 60.0
    assert g.cellstate[HOLE] == UNKNOWN
    assert pad_rc == pad_of(g)
    return g


def ll(g, rc) -> dict:
    lon, lat = lonlat_of_xy(*g.xy_of_rc(*rc), g.crs)
    return {"lon": round(float(lon), 7), "lat": round(float(lat), 7)}


def body(g, stops) -> dict:
    return {"contract_version": settings().contract_version, "pad": ll(g, pad_of(g)),
            "route": {"mode": "ordered", "stops": stops}}


def refused(plan_inputs, grid, cfg=None) -> route_mod.RouteError:
    with pytest.raises(route_mod.RouteError) as e:
        route_mod.validate(plan_inputs, cfg, grid)
    return e.value


def outside(g) -> dict:
    lon, lat = lonlat_of_xy(g.x0 - 10.0, g.y0 - 300.0, g.crs)  # 10 m west of the west edge
    return {"lon": round(float(lon), 7), "lat": round(float(lat), 7)}


def _where(g, name):
    return {"outside": outside(g), "hole": ll(g, HOLE), "cliff": ll(g, CLIFF)}[name]


GRID_CASES = [("outside", "route_point_outside_grid"), ("hole", "route_point_unassessed"),
              ("cliff", "route_point_not_walkable")]


# -------------------------------------------------------------------- the grid checks ----
@pytest.mark.parametrize(("where", "code"), GRID_CASES)
def test_each_grid_code_names_the_free_point(grid, where, code):
    bad = {**_where(grid, where), "label": "rock"}
    e = refused(body(grid, [ll(grid, OPEN[0]), {"station": "S4"}, bad]), grid)
    assert (e.code, e.stop) == (code, 2)
    assert e.detail.startswith("stop 2 (W2 'rock'):")
    assert "nom_104, the default scenario" in e.detail


@pytest.mark.parametrize(("where", "code"), GRID_CASES)
def test_the_code_is_the_engines_for_the_default_scenario(grid, where, code):
    p = _where(grid, where)
    v = waypoints.point_validity(grid, p["lon"], p["lat"], scenario=route_mod.default_scenario())
    assert v["code"] == code
    assert route_mod.point_problem(grid, p["lon"], p["lat"], "nom_104")[0] == code


def test_the_default_scenario_is_the_plans():
    from pipeline.engine.config import load

    assert route_mod.default_scenario() == load("variants")["scenarios"]["default"] == "nom_104"


def test_the_first_bad_free_point_answers(grid):
    stops = [ll(grid, OPEN[0]), _where(grid, "cliff"), _where(grid, "hole")]
    e = refused(body(grid, stops), grid)
    assert (e.code, e.stop) == ("route_point_not_walkable", 1)


def test_unreachable_is_not_a_submit_check(grid):
    """A sealed pocket passes checks 1-3 (cheap); point_validity's Dijkstra says unreachable."""
    p = ll(grid, SEALED)
    route_mod.validate(body(grid, [p]), None, grid)
    v = waypoints.point_validity(grid, p["lon"], p["lat"], scenario="nom_104")
    assert v["code"] == "route_point_unreachable"


def test_valid_free_points_pass(grid):
    route_mod.validate(body(grid, [ll(grid, rc) for rc in OPEN] + st("S4")), None, grid)
    for rc in OPEN:
        p = ll(grid, rc)
        assert waypoints.point_validity(grid, p["lon"], p["lat"], scenario="nom_104")["ok"]


# --------------------------------------------------------------------------- spacing ----
def _east(g, rc, dx_m) -> dict:
    x, y = g.xy_of_rc(*rc)
    lon, lat = lonlat_of_xy(x + dx_m, y, g.crs)
    return {"lon": round(float(lon), 7), "lat": round(float(lat), 7)}


def test_a_free_point_near_the_pad_names_the_pad(grid):
    near = _east(grid, pad_of(grid), 30.0)
    e = refused(body(grid, [ll(grid, OPEN[0]), near]), grid)
    pad = ll(grid, pad_of(grid))
    d = bearing_dist(near["lon"], near["lat"], pad["lon"], pad["lat"])[1]
    assert (e.code, e.stop) == ("route_stop_spacing", 1)
    assert e.detail.startswith("stop 1 (W2):") and f"{d:.1f} m from the pad" in e.detail
    assert "great circle" in e.detail and 25 < d < 35


def test_two_stops_too_close_name_both(grid):
    a = ll(grid, OPEN[0])
    b = _east(grid, OPEN[0], 40.0)
    e = refused(body(grid, [{**a, "label": "first"}, ll(grid, OPEN[2]), b]), grid)
    d = bearing_dist(b["lon"], b["lat"], a["lon"], a["lat"])[1]
    assert (e.code, e.stop) == ("route_stop_spacing", 2)
    assert e.detail.startswith("stop 2 (W3):")
    assert f"{d:.1f} m from stop 0 (W1 'first')" in e.detail


def test_spacing_is_the_great_circle(grid):
    """At the limit the great circle decides: a pair 50 m apart on the sphere passes, a pair
    just under is refused (the check is strictly closer than route.min_stop_spacing_m)."""
    a = ll(grid, OPEN[0])
    lim = settings().route.min_stop_spacing_m
    for dx, ok in ((lim + 1.0, True), (lim - 1.0, False)):
        b = _east(grid, OPEN[0], dx)
        d = bearing_dist(a["lon"], a["lat"], b["lon"], b["lat"])[1]
        assert (d >= lim) == ok
        if ok:
            route_mod.validate(body(grid, [a, b]), None, grid)
        else:
            assert refused(body(grid, [a, b]), grid).code == "route_stop_spacing"


def test_a_free_point_on_a_station(grid):
    s4 = station("S4")
    on = {"lon": s4["lon"] + 0.0003, "lat": s4["lat"]}  # ~18 m east of S4
    e = refused(body(grid, st("S1", "S4") + [on]), grid)
    assert (e.code, e.stop) == ("route_stop_spacing", 2)
    assert e.detail.startswith("stop 2 (W1):") and "from stop 1 (S4)" in e.detail


def test_spacing_runs_before_the_grid_checks(grid):
    """Spacing reads no grid: a close pair is refused without opening it."""
    a = _where(grid, "hole")
    e = refused(body(grid, [a, a]), grid=None)  # grid None + no server data: never opened
    assert (e.code, e.stop) == ("route_stop_spacing", 1)


def _engine_spacing():
    from pipeline.engine import traverse

    return getattr(traverse, "check_spacing", None)


@pytest.mark.skipif(_engine_spacing() is None, reason="traverse.check_spacing is WP2b's")
@pytest.mark.parametrize("case", ["pad_and_pair", "two_pairs", "pad_only"])
def test_the_server_names_the_stop_the_engine_names(grid, case):
    from pipeline.engine import traverse

    a, far = ll(grid, OPEN[0]), ll(grid, OPEN[2])
    near_a, near_pad = _east(grid, OPEN[0], 30.0), _east(grid, pad_of(grid), 20.0)
    stops = {"pad_and_pair": [a, near_pad, near_a], "two_pairs": [a, far, near_a, near_pad],
             "pad_only": [far, near_pad]}[case]
    e = refused(body(grid, stops), grid)
    pad = ll(grid, pad_of(grid))
    eng = traverse.resolve_route(route_mod.engine_route(canonical_inputs(body(grid, stops))), [])
    with pytest.raises(traverse.RouteStopError) as ee:
        traverse.check_spacing(eng, (pad["lon"], pad["lat"]), settings().route.min_stop_spacing_m)
    assert (e.code, e.stop) == (ee.value.code, ee.value.index)


# ------------------------------------------------------------------------ the limits ----
def test_five_free_points_are_too_many(grid):
    n = settings().route.max_free_points
    assert n == 4
    pts = [_east(grid, OPEN[0], 100.0 * k) for k in range(n + 1)]
    e = refused(body(grid, st("S4") + pts), grid)
    assert (e.code, e.stop) == ("route_too_many_free_points", n + 1)
    assert e.detail.startswith(f"stop {n + 1} (W{n + 1}):") and "route.max_free_points" in e.detail
    route_mod.validate(body(grid, st("S4") + pts[:n]), None, grid)


# --------------------------------------------------------------------- the grid, once ----
def test_the_grid_is_opened_once_per_process(monkeypatch, tmp_path, grid):
    sd = tmp_path / "server"
    sd.mkdir()
    (sd / "manifest.json").write_text("{}\n")
    monkeypatch.setenv("HL_SERVER_DATA", str(sd))
    monkeypatch.setattr(route_mod, "_GRID", None)
    opened = []
    monkeypatch.setattr(pads, "open_grid", lambda root: opened.append(root) or grid)
    stops = [ll(grid, OPEN[0])]
    route_mod.validate(body(grid, stops))
    route_mod.validate(body(grid, stops))
    assert len(opened) == 1
    (sd / "manifest.json").write_text('{"changed": true}\n')  # new server data: reopened
    route_mod.validate(body(grid, stops))
    assert len(opened) == 2


def test_stations_only_never_open_the_grid(monkeypatch, grid):
    monkeypatch.setattr(route_mod, "routing_grid", lambda: pytest.fail("grid opened"))
    route_mod.validate(body(grid, st("S4", "S1", "S6", "S7")))


# ------------------------------------------------------------------------- the API ----
@pytest.fixture
def api_grid(api_data, monkeypatch, grid):
    monkeypatch.setattr(route_mod, "routing_grid", lambda: grid)
    return grid


def _post_both(c, doc):
    r = c.post(f"{PREFIX}/jobs", json={"type": "plan", "inputs": doc})
    imp = c.post(f"{PREFIX}/plans/import", content=json.dumps(doc).encode(),
                 headers={"content-type": "application/json"})
    return r, imp


@pytest.mark.parametrize(("where", "code"), GRID_CASES)
def test_jobs_and_import_answer_the_grid_codes(api_grid, where, code):
    doc = body(api_grid, st("S4") + [_where(api_grid, where)])
    with app_clients(IP_A) as (c,):
        r, imp = _post_both(c, doc)
        assert r.status_code == 422 and imp.status_code == 422
        err = assert_valid(r, "post", "/jobs")
        assert (err["error"], err["stop"]) == (code, 1)
        assert err["detail"].startswith("stop 1 (W1):")
        assert assert_valid(imp, "post", "/plans/import") == err
        assert c.runner.jobs_started == 0


def test_jobs_and_import_answer_spacing_and_too_many(api_grid):
    a = ll(api_grid, OPEN[0])
    with app_clients(IP_A) as (c,):
        for doc, code, stop in (
                (body(api_grid, [a, _east(api_grid, OPEN[0], 20.0)]), "route_stop_spacing", 1),
                (body(api_grid, [_east(api_grid, OPEN[0], 100.0 * k) for k in range(5)]),
                 "route_too_many_free_points", 4)):
            r, imp = _post_both(c, doc)
            err = assert_valid(r, "post", "/jobs")
            assert r.status_code == 422 and (err["error"], err["stop"]) == (code, stop)
            assert assert_valid(imp, "post", "/plans/import") == err


def test_a_valid_mixed_route_is_accepted(api_grid):
    doc = body(api_grid, [{**ll(api_grid, OPEN[0]), "label": "dune crest"}, {"station": "S4"},
                          ll(api_grid, OPEN[1])])
    doc["title"] = "two waypoints"
    with app_clients(IP_A) as (c,):
        r, imp = _post_both(c, doc)
        assert r.status_code == 202, r.text
        assert imp.status_code == 200, imp.text
        out = assert_valid(imp, "post", "/plans/import")
    assert out["hash"] == result_hash(doc, IDENT) == r.json()["hash"]
    assert out["inputs"]["route"]["stops"][0]["label"] == "dune crest"
    assert "label" not in out["inputs"]["route"]["stops"][2]


def test_no_server_data_is_503_for_a_free_point(api_data, grid):
    doc = body(grid, [ll(grid, OPEN[0])])
    with app_clients(IP_A) as (c,):
        r, imp = _post_both(c, doc)
    assert r.status_code == 503 and r.json()["error"] == "server_data_missing"
    assert imp.status_code == 503 and imp.json()["error"] == "server_data_missing"


# -------------------------------------------------------------------- the build_plan call ----
def _call(monkeypatch, world, tmp_path, inputs, preview):
    import pipeline.engine.plan as plan_mod

    rec = Recorder()
    monkeypatch.setattr(plan_mod, "build_plan", rec)
    plan_job.build(inputs, terrain_dir=world / "terrain", out_dir=tmp_path / "o",
                   manifest_dir=tmp_path / "m", conditions=False, rad_json=tmp_path / "r",
                   grid=object(), preview=preview)
    return rec.calls[0]


@pytest.mark.parametrize("preview", [True, False])
def test_free_points_go_to_build_plan_in_order_without_labels(monkeypatch, world, tmp_path,
                                                              preview):
    base = custom_inputs(world / "terrain")
    plain = _call(monkeypatch, world, tmp_path, base, preview)
    stops = [{"lon": 137.39, "lat": -4.79, "label": "a"}, {"station": "S4"},
             {"lon": 137.395, "lat": -4.785}]
    inputs = {**base, "route": {"mode": "ordered", "stops": stops}}
    assert plan_job.unsupported(inputs) == []
    call = _call(monkeypatch, world, tmp_path, inputs, preview)
    assert call.pop("route") == [{"lon": 137.39, "lat": -4.79}, "S4",
                                 {"lon": 137.395, "lat": -4.785}]
    assert call.pop("route_min_spacing_m") == settings().route.min_stop_spacing_m == 50
    assert call == plain  # everything else is today's call


def test_spacing_kwarg_only_when_build_plan_takes_it():
    doc = {"contract_version": settings().contract_version,
           "pad": {"lon": 137.393301, "lat": -4.776468},
           "route": {"mode": "ordered", "stops": st("S4")}}

    def wp1(grid, *, route=None):  # build_plan before WP2b
        return {}

    def wp2b(grid, *, route=None, route_min_spacing_m=None):
        return {}

    c = canonical_inputs(doc)
    assert plan_job._route_kwargs(c, wp1) == {"route": ["S4"]}
    assert plan_job._route_kwargs(c, wp2b) == {"route": ["S4"], "route_min_spacing_m": 50.0}
    assert plan_job._route_kwargs(canonical_inputs({**doc, "route": {"mode": "auto"}}), wp2b) == {}


def test_the_real_build_plan_takes_the_route():
    import inspect

    from pipeline.engine.plan import build_plan

    params = inspect.signature(build_plan).parameters
    assert "route" in params
    if "route_min_spacing_m" not in params:
        pytest.skip("build_plan has no route_min_spacing_m yet (WP2b)")


# ------------------------------------------------------------------------- the run record ----
def test_labels_come_back_in_the_record_and_w_ids_validate(tmp_path):
    raw = {"contract_version": settings().contract_version,
           "pad": {"lon": 137.393301, "lat": -4.776468}, "title": "loop",
           "route": {"mode": "ordered", "stops": [
               {"lon": 137.39, "lat": -4.79, "label": "dune crest"}, {"station": "S4"},
               {"lon": 137.395, "lat": -4.785}]}}
    inputs = route_mod.record_inputs(raw, canonical_inputs(raw))
    infeasible = {"feasible": False, "leg": 1, "from": "W1", "to": "S4", "limit": "O2",
                  "shortfall_min": 3.5, "legs_planned": 1}
    for feas in (FEASIBLE, infeasible):
        summ = {"route": {"mode": "ordered", "scenario": "nom_104",
                          "stops": [{"lon": 137.39, "lat": -4.79}, "S4",
                                    {"lon": 137.395, "lat": -4.785}],
                          "feasibility": {"nom_104": feas},
                          "skipped": {"con_104": {"stop": 0, "id": "W1",
                                                  "code": "route_point_not_walkable"}}}}
        extra = plan_job.route_answer(inputs, summ)
        out = tmp_path / ("f" if feas["feasible"] else "i")
        out.mkdir()
        rec = _record(out, inputs, {"range_flags": [], **extra})
        assert rec["feasibility"] == feas and rec["route_mode"] == "ordered"
        assert rec["inputs"]["route"]["stops"][0]["label"] == "dune crest"
        assert rec["inputs"]["title"] == "loop"
        if not feas["feasible"]:
            assert rec["infeasible"]["from"] == "W1"


def test_a_job_error_names_the_free_point(monkeypatch):
    class RouteStopError(ValueError):
        def __init__(self, index, code, message):
            super().__init__(message)
            self.index, self.code, self.message = index, code, message

    raw = {"contract_version": settings().contract_version,
           "pad": {"lon": 137.393301, "lat": -4.776468},
           "route": {"mode": "ordered", "stops": [{"station": "S4"}, {"lon": 137.39,
                                                                      "lat": -4.79}]}}

    def boom(*a, **k):
        raise RouteStopError(1, "route_point_unreachable", "W1: sealed pocket")

    monkeypatch.setattr(plan_job, "_route_stop_error", lambda: RouteStopError)
    monkeypatch.setattr(plan_job, "build", boom)
    with pytest.raises(plan_job.RouteStopFailed) as e:
        plan_job._build_job(canonical_inputs(raw))
    assert (e.value.code, e.value.stop) == ("route_point_unreachable", 1)
    assert str(e.value) == "route_point_unreachable: stop 1 (W1): W1: sealed pocket"


# ------------------------------------------------- the real engine (synthetic world, WP2b) ----
def _engine_has_free_points() -> bool:
    import inspect

    from pipeline.engine.plan import build_plan

    return "route_min_spacing_m" in inspect.signature(build_plan).parameters


@pytest.mark.skipif(not _engine_has_free_points(), reason="build_plan takes no free points yet "
                    "(WP2b)")
def test_free_point_job_on_the_synthetic_world(world, tmp_path, monkeypatch):
    from pipeline.engine import provenance
    from pipeline.engine.geo import xy_of_lonlat
    from pipeline.engine.graph import load_ws1_grid
    from server.engine import jobs
    from server.tests.test_plan_job import Conn
    from tools.validate_contracts import CONTRACTS_DIR, Report, check_tree, load_schemas

    monkeypatch.setenv("HL_SERVER_DATA", str(world))
    monkeypatch.setenv(provenance.FRAGMENT_DIR_ENV, str(tmp_path / "stray_manifest"))
    raw = custom_inputs(world / "terrain")
    g = load_ws1_grid(world / "terrain")
    x, y = xy_of_lonlat(raw["pad"]["lon"], raw["pad"]["lat"], g.crs)

    def at(dx, dy):
        lon, lat = lonlat_of_xy(float(x) + dx, float(y) + dy, g.crs)
        return {"lon": round(float(lon), 6), "lat": round(float(lat), 6)}

    raw["route"] = {"mode": "ordered", "stops": [{**at(150.0, 0.0), "label": "east"},
                                                 {"station": "S1"}, at(0.0, 150.0)]}
    route_mod.validate(raw, None, g)
    inp = route_mod.record_inputs(raw, canonical_inputs(raw))
    out, pub = tmp_path / ".job-w", tmp_path / "public"
    out.mkdir()
    conn = Conn(pub)
    ctx = jobs.JobContext(conn, "j_free", out, pub, plan_job.STAGES)
    extra = plan_job.run_plan_job(inp, ctx)
    assert [e[0] for e in conn.events] == list(plan_job.STAGES)
    assert extra["route_mode"] == "ordered" and "feasible" in extra["feasibility"]
    if extra["feasibility"]["feasible"] is False:
        assert {extra["feasibility"]["from"], extra["feasibility"]["to"]} & {"W1", "W2", "S1",
                                                                             "pad"}
    report = Report()
    n = check_tree(pub, load_schemas(CONTRACTS_DIR, report), report, public=True)
    assert n > 5 and report.ok, report.errors[:10]
    legs = sorted(pub.rglob("route_*.geojson"))
    assert legs, sorted(p.relative_to(pub).as_posix() for p in pub.rglob("*"))
    text = "".join(f.read_text() for f in legs + sorted(pub.rglob("timeline_*.json")))
    assert '"W1"' in text and '"east"' not in text  # W ids in the legs, the label never
