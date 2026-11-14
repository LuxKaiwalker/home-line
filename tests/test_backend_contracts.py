"""Backend contract family (contracts/backend/, v1.0.1, frozen at P0; kit K1/K4, D50-D57).

Known answers: every schema is valid draft 2020-12 and versioned; every example validates against
its schema; the OpenAPI document covers every route of backend spec §5, its refs resolve, and it
passes the OpenAPI 3.1 meta-schema (openapi-spec-validator, skipped when not installed); the share
code is HL- + 6 Crockford base32 characters (D55); YAML 1.1 readers (PyYAML) see "on"/"off" as
strings, not booleans (v1.0.1).
"""

import json
import re
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

REPO = Path(__file__).resolve().parents[1]
B = REPO / "contracts" / "backend"
EX = B / "examples"
SCHEMAS = sorted(B.glob("*.schema.json"))
EXAMPLES = sorted(EX.glob("*.json"))
FAMILY = {"plan_inputs", "run_record", "job", "telemetry"}
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # D55 (kit K4)


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _api() -> dict:
    return yaml.safe_load((B / "openapi.yaml").read_text(encoding="utf-8"))


def _registry() -> Registry:
    pairs = []
    for p in SCHEMAS:
        res = Resource.from_contents(_load(p))
        pairs += [(p.name, res), (_load(p)["$id"], res)]
    return Registry().with_resources(pairs)


def validator(name: str, pointer: str = "") -> Draft202012Validator:
    schema = _load(B / name)
    if pointer:
        schema = {"$ref": f"{schema['$id']}#{pointer}"}
    return Draft202012Validator(schema, registry=_registry())


def _stem(p: Path) -> str:
    return p.name.split(".", 1)[0]


# --- schemas -------------------------------------------------------------------------------------

def test_family_present():
    assert {p.name.removesuffix(".schema.json") for p in SCHEMAS} == FAMILY
    assert (B / "openapi.yaml").is_file() and (B / "README.md").is_file()


@pytest.mark.parametrize("path", SCHEMAS, ids=lambda p: p.name)
def test_schema_valid_and_versioned(path):
    s = _load(path)
    Draft202012Validator.check_schema(s)
    assert s["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert s["$id"] == f"homeline/contracts/backend/{path.name}"
    assert s["x-contract-version"] == "1.0.0"
    for key in ("title", "description", "x-source"):
        assert s.get(key)


def test_backend_schemas_stay_out_of_the_web_family():
    # tests/test_contracts.py requires every top-level contracts/*.schema.json to map to web data
    top = {p.name for p in (REPO / "contracts").glob("*.schema.json")}
    assert not top & {p.name for p in SCHEMAS}


# --- examples ------------------------------------------------------------------------------------

def test_every_schema_has_an_example():
    assert {_stem(p) for p in EXAMPLES} == FAMILY


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.name)
def test_example_validates(path):
    validator(f"{_stem(path)}.schema.json").validate(_load(path))


@pytest.mark.parametrize("case,pointer", [("batch", "/$defs/batch"),
                                          ("state_event", "/$defs/state_event")])
def test_telemetry_examples_match_their_part(case, pointer):
    doc = _load(EX / f"telemetry.{case}.json")
    validator("telemetry.schema.json", pointer).validate(doc)
    other = "/$defs/state_event" if case == "batch" else "/$defs/batch"
    assert not validator("telemetry.schema.json", other).is_valid(doc)


def test_example_official_pad_is_the_published_official_pad():
    idx = REPO / "web" / "public" / "data" / "scenarios" / "pads" / "index.json"
    if not idx.is_file():
        pytest.skip("no published pads index")
    official = [p for p in _load(idx)["pads"] if p.get("official")]
    pad = _load(EX / "plan_inputs.official.json")["pad"]
    assert len(official) == 1
    assert (pad["id"], pad["lon"], pad["lat"]) == (official[0]["id"], official[0]["lon"],
                                                   official[0]["lat"])


# --- plan_inputs ---------------------------------------------------------------------------------

PAD = {"lon": 137.4, "lat": -4.78}


def _inputs(**kw) -> dict:
    return {"contract_version": "1.0.0", "pad": dict(PAD), **kw}


def test_plan_inputs_minimal_and_required():
    v = validator("plan_inputs.schema.json")
    assert v.is_valid(_inputs())
    assert not v.is_valid({"pad": PAD})
    assert not v.is_valid({"contract_version": "1.0.0"})
    assert not v.is_valid(_inputs(contract_version="2.0.0"))
    assert not v.is_valid({"contract_version": "1.0.0", "pad": {"lon": 137.4}})


def test_plan_inputs_rejects_unknown_fields():
    v = validator("plan_inputs.schema.json")
    assert not v.is_valid(_inputs(extra=1))
    assert not v.is_valid(_inputs(crew={"suit_kg": 104, "colour": "red"}))
    assert not v.is_valid({"contract_version": "1.0.0", "pad": {**PAD, "alt": 0}})


def test_plan_inputs_station_modes():
    v = validator("plan_inputs.schema.json")
    assert v.is_valid(_inputs(stations={"mode": "best"}))
    assert not v.is_valid(_inputs(stations={"mode": "fastest"}))
    for mode in ("set", "order"):  # a fixed set or order needs its ids
        assert not v.is_valid(_inputs(stations={"mode": mode}))
        assert not v.is_valid(_inputs(stations={"mode": mode, "ids": []}))
        assert v.is_valid(_inputs(stations={"mode": mode, "ids": ["S1", "S3"]}))
    assert not v.is_valid(_inputs(stations={"mode": "order", "ids": ["S1", "S1"]}))
    assert not v.is_valid(_inputs(stations={"mode": "best", "dwell_min": {"X9": 10}}))


def test_plan_inputs_user_points_u1_to_u3():
    v = validator("plan_inputs.schema.json")
    pts = [{"id": f"U{i}", **PAD} for i in (1, 2, 3)]
    assert v.is_valid(_inputs(stations={"mode": "best", "custom": pts}))
    assert not v.is_valid(_inputs(stations={"mode": "best", "custom": pts + [dict(pts[0])]}))
    assert not v.is_valid(_inputs(stations={"mode": "best", "custom": [{"id": "U4", **PAD}]}))


def test_plan_inputs_storm_and_tripwire():
    v = validator("plan_inputs.schema.json")
    storm = {"storm": "2024-05-20"}
    assert v.is_valid(_inputs(conditions={**storm, "tripwire_at": "route_max_t_home"}))
    assert v.is_valid(_inputs(conditions={"storm": "2024-05-20", "tripwire_at": 120}))
    assert not v.is_valid(_inputs(conditions={"storm": "2024-05-21"}))
    assert not v.is_valid(_inputs(conditions={"tripwire_at": -1}))
    assert not v.is_valid(_inputs(conditions={"tripwire_at": "station_max"}))


# --- run record, job, telemetry ------------------------------------------------------------------

def test_run_record_inputs_use_plan_inputs():
    v = validator("run_record.schema.json")
    rec = _load(EX / "run_record.live.json")
    assert v.is_valid(rec)
    rec["inputs"]["crew"]["colour"] = "red"
    assert not v.is_valid(rec)


def test_run_record_infeasible_leg():
    v = validator("run_record.schema.json")
    rec = _load(EX / "run_record.live.json")
    rec["infeasible"] = {"leg": 2, "from": "S1", "to": "S4", "margin_min": -3.5, "binding": "O2"}
    assert v.is_valid(rec)
    rec["infeasible"]["binding"] = "speed"
    assert not v.is_valid(rec)


@pytest.mark.parametrize("change", [{"hash": "0123456789ABCDEF"}, {"hash": "0123456789abcde"},
                                    {"origin": "live"}, {"terrain_hash": "0" * 64}])
def test_run_record_rejects(change):
    rec = {**_load(EX / "run_record.live.json"), **change}
    assert not validator("run_record.schema.json").is_valid(rec)


def test_job_status_values():
    v = validator("job.schema.json")
    job = _load(EX / "job.queued.json")
    for status in ("queued", "running", "done", "error", "timeout", "refused"):
        assert v.is_valid({**job, "status": status})
    assert not v.is_valid({**job, "status": "paused"})
    assert not v.is_valid({**job, "progress": 1.5})
    assert not v.is_valid({**job, "type": "export"})


def test_telemetry_sample_fields_are_spec_7():
    sample = _load(B / "telemetry.schema.json")["$defs"]["sample"]
    assert set(sample["required"]) == {"t_eva_s", "x_m", "y_m", "z_m", "speed_ms", "o2_left_L",
                                       "source"}
    v = validator("telemetry.schema.json", "/$defs/batch")
    assert not v.is_valid({"samples": []})
    s = _load(EX / "telemetry.batch.json")["samples"][0]
    assert not v.is_valid({"samples": [{**s, "heart_rate": 90}]})
    assert not v.is_valid({"samples": [{k: x for k, x in s.items() if k != "o2_left_L"}]})


# --- OpenAPI -------------------------------------------------------------------------------------

SPEC_5 = {  # backend spec §5: method and path, auth
    ("get", "/health"): "G", ("get", "/engine/version"): "G", ("get", "/defaults"): "G",
    ("post", "/pads/validate"): "G", ("post", "/pads/screen"): "G", ("post", "/jobs"): "G",
    ("get", "/jobs/{id}"): "G", ("get", "/results/{hash}/{path}"): "G",
    ("get", "/results/{hash}/provenance"): "G", ("post", "/plans/import"): "G",
    ("get", "/plans"): "U", ("post", "/plans"): "U", ("get", "/plans/{id}"): "U",
    ("patch", "/plans/{id}"): "U", ("delete", "/plans/{id}"): "U",
    ("get", "/plans/{id}/versions"): "U", ("get", "/plans/by-code/{code}"): "G",
    ("get", "/plans/{ref}/bundle"): "G", ("get", "/world/{version}/{path}"): "G",
    ("post", "/sessions"): "G", ("post", "/sessions/{id}/telemetry"): "K",
    ("get", "/sessions/{id}/stream"): "K", ("post", "/sessions/{id}/commands"): "K",
    ("post", "/sessions/{id}/end"): "K", ("get", "/runs/{id}"): "K",
    ("get", "/conditions/latest"): "G", ("delete", "/me"): "U", ("get", "/admin/status"): "T",
}
AUTH = {"U": "supabase", "K": "sessionKey", "T": "teamToken"}
METHODS = {"get", "put", "post", "delete", "patch"}


def test_openapi_covers_spec_5_exactly_with_auth():
    api = _api()
    assert api["openapi"].startswith("3.1")
    assert api["info"]["version"] == "1.0.1"
    assert api["servers"][0]["url"] == "/api/v1"
    ops = {(m, path): op for path, item in api["paths"].items()
           for m, op in item.items() if m in METHODS}
    assert set(ops) == set(SPEC_5)
    for key, auth in SPEC_5.items():
        names = {n for req in ops[key].get("security", []) for n in req}
        if auth == "G":
            assert ops[key].get("security") in (None, [{}], [{}, {"supabase": []}]), key
        else:
            assert names == {AUTH[auth]}, key
    ids = [op["operationId"] for op in ops.values()]
    assert len(ids) == len(set(ids))


def test_openapi_on_off_are_strings_under_yaml_1_1():
    # v1.0.1: PyYAML follows YAML 1.1, where a bare on/off/yes/no is a boolean.
    schemas = _api()["components"]["schemas"]
    assert schemas["Health"]["properties"]["heavy_jobs"]["enum"] == ["on", "off"]
    assert schemas["AdminStatus"]["properties"]["heavy_jobs"]["enum"] == ["on", "off"]


def _enums(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "enum":
                yield path, v
            yield from _enums(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _enums(v, f"{path}/{i}")


def test_openapi_no_enum_holds_a_bool_under_yaml_1_1():
    found = list(_enums(_api()))
    assert found  # the walk reaches the enums
    bad = [(path, e) for path, e in found if any(isinstance(x, bool) for x in e)]
    assert not bad, bad


def _resolve_pointer(doc, pointer: str):
    node = doc
    for part in pointer.lstrip("/").split("/"):
        if part:
            node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def test_openapi_refs_and_examples_resolve():
    api = _api()
    refs, externals = [], []

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("$ref"), str):
                refs.append(n["$ref"])
            if isinstance(n.get("externalValue"), str):
                externals.append(n["externalValue"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(api)
    assert refs and externals
    for r in refs:
        file, _, frag = r.partition("#")
        doc = api if not file else _load(B / file)
        _resolve_pointer(doc, frag)  # KeyError if the target is missing
    for e in externals:
        assert (B / e).is_file(), e


def test_openapi_examples_validate_against_their_schemas():
    api = _api()
    checked = 0
    for item in api["paths"].values():
        for m, op in item.items():
            if m not in METHODS:
                continue
            bodies = [op.get("requestBody", {})] + list(op.get("responses", {}).values())
            for body in bodies:
                media = body.get("content", {}).get("application/json", {})
                for ex in media.get("examples", {}).values():
                    ref = media["schema"]["$ref"]
                    target = _resolve_pointer(api, ref.partition("#")[2])["$ref"]
                    file, _, frag = target.partition("#")
                    validator(file, frag).validate(_load(B / ex["externalValue"]))
                    checked += 1
    assert checked >= 6


def test_openapi_passes_the_3_1_meta_schema():
    osv = pytest.importorskip("openapi_spec_validator")
    path = B / "openapi.yaml"
    osv.validate(_api(), base_uri=path.resolve().as_uri())


# --- share code (D55) ----------------------------------------------------------------------------

def test_share_code_known_answers():
    rx = re.compile(_api()["components"]["schemas"]["ShareCode"]["pattern"])
    assert len(CROCKFORD) == 32 and not set("ILOU") & set(CROCKFORD)
    assert rx.fullmatch("HL-7K2Q9M")  # spec F28 example
    assert all(rx.fullmatch("HL-" + c * 6) for c in CROCKFORD)
    for bad in ("HL-7K2Q9", "HL-7K2Q9MM", "hl-7K2Q9M", "HL-7k2q9m", "HL7K2Q9M", "XX-7K2Q9M"):
        assert not rx.fullmatch(bad), bad
    for c in "ILOU":
        assert not rx.fullmatch("HL-" + c + "00000"), c
    assert len("HL-7K2Q9M") == 9
    by_code = _api()["paths"]["/plans/by-code/{code}"]["get"]["parameters"][0]["schema"]
    assert by_code == {"$ref": "#/components/schemas/ShareCode"}


def test_share_code_matches_backend_config():
    cfg_path = REPO / "config" / "backend.yaml"
    if not cfg_path.is_file():
        pytest.skip("config/backend.yaml not on this branch yet (S2)")
    pytest.importorskip("pydantic")  # server dependency group: the loader resolves alphabet names
    from server import settings as st

    sc = st.load().plans.share_code  # backend.yaml names the alphabet; the loader resolves it
    assert sc.alphabet == CROCKFORD
    assert sc.prefix == "HL-" and sc.chars == 6
