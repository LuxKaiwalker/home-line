"""Contracts: every schema is valid draft 2020-12, and the validator enforces the repo rules."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from tools import validate_contracts as vc

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
SCHEMA_FILES = sorted(CONTRACTS.glob("*.schema.json"))
INDEX_SCHEMAS = {
    "scenarios_index.schema.json",
    "fields_index.schema.json",
    "fp3d_index.schema.json",
    "pad.schema.json",
}


def load(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def test_there_are_schemas():
    assert len(SCHEMA_FILES) >= 23  # SPEC §6, §6.1, §6.2


@pytest.mark.parametrize("path", SCHEMA_FILES, ids=lambda p: p.name)
def test_schema_is_valid_draft_2020_12(path):
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"] == f"homeline/contracts/{path.name}"
    assert schema["x-contract-version"] in ("1.0.0", "1.1.0", "1.1.1", "1.1.2")  # 1.1.x is additive
    for key in ("title", "description", "x-source"):
        assert schema.get(key)


def test_every_mapped_schema_exists():
    names = {p.name for p in SCHEMA_FILES}
    for _, name in vc.SCHEMA_MAP + vc.INTERIM_SCHEMA_MAP:
        assert name in names


def test_every_schema_is_mapped():
    mapped = {name for _, name in vc.SCHEMA_MAP + vc.INTERIM_SCHEMA_MAP}
    assert {p.name for p in SCHEMA_FILES} == mapped


@pytest.mark.parametrize("name", sorted(INDEX_SCHEMAS))
def test_index_schemas_require_boolean_dummy(name):
    schema = load(name)
    assert "dummy" in schema["required"]
    assert schema["properties"]["dummy"]["type"] == "boolean"


def test_spec_example_scenarios_index_validates():
    # SPEC §6 example, plus the required dummy flag.
    doc = {
        "dummy": False,
        "default": "nom_104",
        "scenarios": [{
            "id": "nom_104", "variant": "nominal", "suit_kg": 104,
            "files": {"isochrones": "scenarios/nom_104/isochrones.geojson",
                      "bands": "scenarios/bands_104.geojson",
                      "edges": "scenarios/nom_104/edges.geojson",
                      "partner": "scenarios/nom_104/partner.geojson"},
            "headline": {"budget_min": 30, "reachable_pct": None, "range_pct": [None, None]},
        }],
    }
    Draft202012Validator(load("scenarios_index.schema.json")).validate(doc)
    del doc["dummy"]
    assert not Draft202012Validator(load("scenarios_index.schema.json")).is_valid(doc)


def test_spec_example_stations_validates():
    doc = [{"id": "S1", "name": "Boxwork ridge–hollow transect", "lon": 137.38, "lat": -4.80,
            "value": None, "objective": "…", "tasks": ["…"], "dwell_min": 30,
            "t_home_min": {"nom_104": None}, "in_partner_line": None, "card": "cards/S1.json"}]
    Draft202012Validator(load("stations.schema.json")).validate(doc)


def test_fixes_skyline_needs_error_and_image():
    v = Draft202012Validator(load("fixes.schema.json"))
    base = {"t_eva_min": 10, "station": None, "sigma_m": 5}
    assert v.is_valid([{**base, "type": "rover"}])
    assert not v.is_valid([{**base, "type": "skyline"}])
    assert v.is_valid([{**base, "type": "skyline", "error_m": 12.0, "image_id": "NLB_x"}])


def test_edges_cause_enum():
    v = Draft202012Validator(load("edges.schema.json"))
    feat = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            "properties": {"budget": 30, "cause": "slope"}}
    assert v.is_valid({"type": "FeatureCollection", "features": [feat]})
    feat["properties"]["cause"] = "weather"
    assert not v.is_valid({"type": "FeatureCollection", "features": [feat]})


def _write(root: Path, rel: str, doc) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc), encoding="utf-8")


def test_empty_trees_pass(tmp_path):
    assert vc.run(tmp_path / "data", tmp_path / "data-dummy").ok


def test_dummy_true_in_public_fails(tmp_path):
    _write(tmp_path / "data", "vo/probe.json", {"dummy": True, "drives": [], "decision": "go"})
    report = vc.run(tmp_path / "data", tmp_path / "data-dummy")
    assert any('"dummy": true' in e for e in report.errors)


def test_index_in_dummy_tree_needs_dummy_true(tmp_path):
    doc = {"dummy": False, "bounds": [0, 0, 1, 1], "width": 1, "height": 1, "res_m": 5,
           "fields": {}}
    _write(tmp_path / "data-dummy", "fields/index.json", doc)
    assert not vc.run(tmp_path / "data", tmp_path / "data-dummy").ok
    doc["dummy"] = True
    _write(tmp_path / "data-dummy", "fields/index.json", doc)
    assert vc.run(tmp_path / "data", tmp_path / "data-dummy").ok


def test_invalid_file_fails_and_unmatched_warns(tmp_path):
    _write(tmp_path / "data", "vo/probe.json", {"drives": [], "decision": "maybe"})
    _write(tmp_path / "data", "unknown/thing.json", {})
    report = vc.run(tmp_path / "data", tmp_path / "data-dummy")
    assert any("vo_probe.schema.json" in e for e in report.errors)
    assert any("unknown/thing.json" in w for w in report.warnings)


def test_oversize_file_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(vc, "MAX_BYTES", 10)
    _write(tmp_path / "data", "big.bin", "x" * 100)
    assert not vc.run(tmp_path / "data", tmp_path / "data-dummy").ok


def test_interim_tree_validates(tmp_path):
    _write(tmp_path, "horizon/navcam_frames.json", {"frames": [{"image_id": "x"}]})
    report = vc.run(tmp_path / "d", tmp_path / "dd", interim_dir=tmp_path)
    assert any("navcam_frames.schema.json" in e for e in report.errors)


# --------------------------------------------------------------------------- v1.1.1


def errs(name: str, doc) -> list[str]:
    return [e.message for e in Draft202012Validator(load(name)).iter_errors(doc)]


def test_card_margin_binding_may_be_null():
    """v1.1.1: a station with no route or no access cell (S1) has a null binding."""
    doc = {"navcam": {"sol": None, "image_id": None, "url_local": None, "overlay_png": None},
           "skyline_error_deg": {"near": None, "mid": None, "far": None}, "panorama_png": None,
           "landmarks": [], "timeline": {"arrive": None, "leave": None, "turn_back": None},
           "margin_binding": None, "contingency": "No access cell within 50 m."}
    assert errs("card.schema.json", doc) == []
    assert errs("card.schema.json", doc | {"margin_binding": "none"})
    doc["access"] = {"lon": None, "lat": None, "dist_m": None, "reason": "sealed",
                     "walk_in": None, "radius_m": 50.0, "rule": "nearest walkable"}
    assert errs("card.schema.json", doc) == []
    doc["access"]["walk_in"] = {"dist_m": 2.1, "modelled": True}
    assert errs("card.schema.json", doc)  # the walk-in is never modelled


def test_stations_access_extras_validate():
    walk = {"dist_m": 2.1, "modelled": False, "rise_m": 0.59, "mean_slope_deg": 15.9,
            "max_slope_deg": 15.9, "max_terrain_slope_deg": 23.65}
    st = {"id": "S4", "name": "x", "lon": 137.408864, "lat": -4.785707, "value": 0.5,
          "objective": "", "tasks": [], "dwell_min": 30, "t_home_min": {"nom_104": 59.93},
          "in_partner_line": False, "card": "cards/S4.json", "access_radius_m": 50.0,
          "access_lon": 137.408842, "access_lat": -4.785679, "access_dist_m": 2.1,
          "access_reason": None,
          "access": {"nom_104": {"lon": 137.408842, "lat": -4.785679, "dist_m": 2.1,
                                 "t_home_min": 59.93, "o2_home_L": 77.72, "reason": None,
                                 "walk_in": walk}}}
    assert errs("stations.schema.json", [st]) == []
    st["access"]["nom_104"]["dist_m"] = "far"
    assert errs("stations.schema.json", [st])


def test_timeline_and_route_access_dist():
    row = {"t_min": 48.44, "event": "arrive", "station": "S4", "o2_left_L": 445.9,
           "t_home_min": 59.93, "margin_min": 25.97, "access_dist_m": 2.1}
    assert errs("timeline.schema.json", [row]) == []
    route = {"type": "FeatureCollection", "features": [{
        "type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        "properties": {"leg": 1, "from": "pad", "to": "S4", "to_access_dist_m": 2.1}}]}
    assert errs("route.schema.json", route) == []


def test_horizon_ring_ws3_layout_and_dummy():
    n = 4
    ws3 = {"observer": {"id": "pad", "lon": 137.382, "lat": -4.806, "x": -472.5, "y": -284874.2,
                        "eye_height_m": 1.7, "z_ground_m": -3627.7, "z_eye_m": -3626.0,
                        "source": "WS1 grid.json pad"},
           "az_step_deg": 90.0, "min_range_m": 3700.0, "max_range_m": 80000.0, "crs": "+proj=eqc",
           "azimuth_convention": "deg clockwise from grid north", "radius_m": 3396190.0,
           "notes": "null = unknown", "az_deg": [0.0, 90.0, 180.0, 270.0],
           "elev_deg": [1.09, None, 0.5, 2.0], "dist_m": [53200.0, None, 9000.0, 41000.0],
           "z_m": [-2194.1, None, -3500.0, -2200.0], "east_m": [0.0, None, 0.0, -41000.0],
           "north_m": [53200.0, None, -9000.0, 0.0],
           "source": ["mola_hrsc_200m", None, "ctx_20m", "mola_hrsc_200m"]}
    assert errs("horizon_ring.schema.json", ws3) == []
    assert all(len(ws3[k]) == n for k in ("elev_deg", "dist_m", "z_m", "east_m", "north_m"))
    dummy = Path(__file__).resolve().parents[1] / "web/public/data-dummy/fp3d/horizon_ring.json"
    assert errs("horizon_ring.schema.json", json.loads(dummy.read_text())) == []
    assert errs("horizon_ring.schema.json", [ws3])  # an array is no longer a ring
    assert errs("horizon_ring.schema.json", {k: v for k, v in ws3.items() if k != "elev_deg"})


def test_fields_index_pointer_entry_on_its_own_grid():
    """v1.1.1 (WS7 proposal): pointer.png on WS2's 3 m grid with its stencil; the 5 m entries
    keep using the top-level grid."""
    idx = {"dummy": False, "bounds": [137.319359, -4.868421, 137.444641, -4.743579],
           "width": 1480, "height": 1480, "res_m": 5.0, "fields": {
               "nom_104/t_home": {"file": "fields/nom_104/t_home.png", "scale": 0.1,
                                  "units": "min", "scenario": "nom_104"},
               "nom_104/pointer": {"file": "fields/nom_104/pointer.png", "scale": 1,
                                   "units": "move", "scenario": "nom_104",
                                   "bounds": [137.32, -4.86, 137.44, -4.75], "width": 2468,
                                   "height": 2468, "res_m": 3.0,
                                   "stencil": [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 1]]}}}
    assert errs("fields_index.schema.json", idx) == []
    idx["fields"]["nom_104/pointer"]["stencil"] = [[-1, 0, 1]]
    assert errs("fields_index.schema.json", idx)


# --------------------------------------------------------------------------- v1.1.2


def test_partner_d20_cart_only_properties():
    """v1.1.2 (D20, user 14:22): cart-only partner line with label/caption/drag_note per feature
    and the drag finding as a top-level member (WS2 haul.py)."""
    note = "One astronaut cannot drag a suited crewmate on Mars without a cart or sled."
    doc = {"type": "FeatureCollection",
           "drag_finding": {"case": "drag", "theta_deg": 0.0, "suit_kg": 104.0,
                            "casualty_kg": 179.0, "rescuer_system_kg": 189.0, "mu": 0.6,
                            "boot_mu": 0.5, "g_ms2": 3.71, "force_N": 398.454,
                            "traction_limit_N": 350.595, "max_mass_kg": 157.5,
                            "feasible": False, "reason": "traction", "note": note},
           "features": [{"type": "Feature",
                         "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1],
                                                                          [0, 0]]]},
                         "properties": {"case": "cart", "casualty_kg": 179.0, "contour_min": 60,
                                        "style": "dashed", "default_visible": False,
                                        "label": "Partner line (cart haul, 60 min)",
                                        "caption": "Design question.", "drag_note": note,
                                        "feasible": True, "area_km2": 1.233072}}]}
    assert errs("partner.schema.json", doc) == []
    bad = json.loads(json.dumps(doc))
    bad["drag_finding"]["force_N"] = "a lot"
    assert errs("partner.schema.json", bad)
    bad = json.loads(json.dumps(doc))
    bad["features"][0]["properties"]["label"] = 3
    assert errs("partner.schema.json", bad)


def test_card_drag_note_optional():
    doc = {"navcam": {"sol": None, "image_id": None, "url_local": None, "overlay_png": None},
           "skyline_error_deg": {"near": None, "mid": None, "far": None}, "panorama_png": None,
           "landmarks": [], "timeline": {"arrive": None, "leave": None, "turn_back": None},
           "margin_binding": None, "contingency": "x", "drag_note": "no drag on Mars"}
    assert errs("card.schema.json", doc) == []
    assert errs("card.schema.json", doc | {"drag_note": 1})


def test_conservative_cellstate_path_mapped():
    assert vc.match_schema("terrain/cellstate_conservative.json") == "cellstate.schema.json"
