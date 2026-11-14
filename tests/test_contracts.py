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
    assert schema["x-contract-version"] in ("1.0.0", "1.1.0")  # v1.1.0 is additive
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
