"""tools/make_mission.py --official: the official plan's mission.json (D110, WP9c).

Known answers: the committed web/public/sim/official/mission.json validates against
contracts/bundle/mission.schema.json; origin precomputed with config labels.precomputed; scenario
= scenarios/index.json default; its waypoints are the official route's stations in visit order
(route legs, timeline arrive events); created_utc is the official data's build time (latest
manifest utc), not "now", so two builds give identical bytes and the committed file is up to
date; nothing in web/public/data is created, changed or removed (every file hashed before and
after; git sees no change against HEAD); the writer refuses an output inside web/public/data.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator

from tools import make_mission as mm

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "web" / "public" / "data"
OUT = REPO / "web" / "public" / "sim" / "official" / "mission.json"
SCHEMA = json.loads((REPO / "contracts/bundle/mission.schema.json").read_text(encoding="utf-8"))
LABELS = yaml.safe_load((REPO / "config/backend.yaml").read_text(encoding="utf-8"))["labels"]


def tree_digest(root: Path) -> dict[str, str]:
    """sha256 of every file under root (hidden ones too), by relative path."""
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() or p.is_symlink():
            out[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def _json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def official() -> dict:
    return _json(OUT)


@pytest.fixture(scope="module")
def scenario() -> str:
    return _json(DATA / "scenarios" / "index.json")["default"]


@pytest.fixture(scope="module")
def route_legs(scenario) -> list[dict]:
    route = _json(DATA / f"route_{scenario}.geojson")
    return sorted((f["properties"] | {"coords": f["geometry"]["coordinates"]}
                   for f in route["features"]), key=lambda p: p["leg"])


# --- the committed file -------------------------------------------------------------------------

def test_official_mission_validates(official):
    v = Draft202012Validator(SCHEMA)
    errs = [f"{e.json_path}: {e.message}" for e in v.iter_errors(official)]
    assert errs == []
    assert official["schema_version"] == "1.1.0" and official["kind"] == "homeline_mission"
    assert official["dummy"] is False


def test_origin_precomputed_with_the_config_label(official):
    assert official["origin"] == "precomputed"
    assert official["origin_label"] == LABELS["precomputed"] == "Precomputed · official plan"
    assert official["planner"]["routing_grid_res_m"] == 3
    assert official["planner"]["files"]["route"] == "route_nom_104.geojson"


def test_scenario_is_the_default(official, scenario):
    assert official["scenario"]["id"] == scenario == "nom_104"
    assert official["scenario"]["variant"] == "nominal" and official["scenario"]["suit_kg"] == 104


def test_waypoints_are_the_official_route_stations_in_order(official, scenario, route_legs):
    stations = [leg["to"] for leg in route_legs if leg["to"] != "pad"]
    assert stations == ["S7", "S6", "S1", "S4"]  # plan bundle fixture plan.json stations
    wps = official["waypoints"]
    assert [w["index"] for w in wps] == list(range(1, len(stations) + 1))
    # each waypoint sits where its route leg ends (the station's access cell on the 3 m route)
    for w, leg in zip(wps, route_legs, strict=False):
        assert w["lonlat"] == pytest.approx(leg["coords"][-1], abs=1e-6), leg["to"]
    timeline = _json(DATA / f"timeline_{scenario}.json")
    arrive = [e for e in timeline if e["event"] == "arrive"]
    assert [e["station"] for e in arrive] == stations
    assert [w["arrive_t_min"] for w in wps] == pytest.approx([e["t_min"] for e in arrive], abs=0.01)


def test_frame_is_the_official_pad(official):
    pad = _json(DATA / "pad.json")["pad"]
    f = official["frame"]
    assert f["kind"] == "pad-local" and f["axes"] == {"x": "east", "y": "north", "z": "up"}
    assert (f["pad"]["lon"], f["pad"]["lat"]) == (pad["lon"], pad["lat"])
    assert f["pad"]["kind"] == "official"


def test_created_utc_is_the_official_build_time(official):
    manifest = _json(DATA / "manifest.json")
    times = sorted(v["utc"] for v in manifest.values() if isinstance(v, dict) and v.get("utc"))
    assert official["created_utc"] == mm.build_time() == times[-1]


def test_sim_folder_is_outside_the_data_tree():
    assert OUT.is_file() and not OUT.resolve().is_relative_to(DATA.resolve())
    assert not (DATA / "mission.json").exists() and not (DATA / "sim").exists()


# --- generation: deterministic, up to date, data tree untouched ----------------------------------

def test_generating_twice_gives_identical_bytes_and_matches_the_committed_file():
    a = mm.official_bytes()
    b = mm.official_bytes()
    assert a == b
    assert a == OUT.read_bytes(), f"{OUT} is stale: run make mission-official"
    assert mm.main(["--official", "--check"]) == 0


def test_web_public_data_is_byte_identical_before_and_after(tmp_path):
    before = tree_digest(DATA)
    assert len(before) > 3000 and "manifest.json" in before and "scenarios/index.json" in before
    out = mm.write_official(DATA, tmp_path / "sim" / "official" / "mission.json")
    assert out.is_file()
    assert mm.main(["--official", "--out", str(tmp_path / "again.json")]) == 0
    assert (tmp_path / "again.json").read_bytes() == out.read_bytes()
    assert mm.main(["--official", "--check"]) == 0
    assert tree_digest(DATA) == before


def test_git_sees_no_change_in_web_public_data():
    diff = subprocess.run(["git", "status", "--porcelain", "--", "web/public/data"], cwd=REPO,
                          check=True, capture_output=True, text=True).stdout
    assert diff == ""


def test_writer_refuses_the_data_tree():
    before = tree_digest(DATA / "scenarios")
    with pytest.raises(ValueError, match="official tree"):
        mm.write_official(DATA, DATA / "mission.json")
    with pytest.raises(ValueError, match="official tree"):
        mm.write_official(DATA, DATA / "scenarios" / "mission.json")
    assert not (DATA / "mission.json").exists()
    assert tree_digest(DATA / "scenarios") == before


def test_check_reports_a_stale_file(tmp_path):
    stale = tmp_path / "mission.json"
    assert mm.main(["--official", "--check", "--out", str(stale)]) == 1  # missing
    stale.write_bytes(OUT.read_bytes().replace(b'"precomputed"', b'"computed_live"'))
    assert mm.main(["--official", "--check", "--out", str(stale)]) == 1
