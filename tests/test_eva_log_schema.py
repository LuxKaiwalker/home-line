"""Known answers for contracts/bundle/eva_log.schema.json (draft 1.1.0).

A minimal complete log validates; wrong kind, a short track row and an unknown status are rejected.
"""
import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((REPO / "contracts/bundle/eva_log.schema.json").read_text())

DOC = {
    "schema_version": "1.1.0",
    "kind": "homeline_eva_log",
    "mission_id": "m-821c94883721",
    "title": "Mission · 1 waypoint · nom_104",
    "created_utc": "2026-11-15T10:00:00Z",
    "started_utc": "2026-11-15T09:00:00Z",
    "origin": "unity_simulator",
    "origin_label": "Simulated EVA in the Unity simulator, compared with a Mission Planer plan",
    "label": "Simulated EVA · real terrain and data",
    "dummy": False,
    "o2_model": "simulator suit model (SuitTelemetry), not the planner's budget rates",
    "pad": {"lon": 137.401783, "lat": -4.77748},
    "summary": {
        "complete": True, "eva_min": 12.5, "planned_eva_min": 12.0,
        "final_status": "EVA COMPLETE", "waypoints_done": 1, "waypoints_skipped": 0,
        "stops_left_early": 1, "lowest_margin_min": 250.1, "lowest_binding": "O2",
        "max_cross_track_m": 8.2, "max_behind_min": 0.5, "o2_used_l": 14.2,
        "planned_o2_used_l": 13.9,
    },
    "waypoints": [{"index": 1, "state": "done", "planned_arrive_min": 5.0,
                   "planned_leave_min": 7.0, "arrived_min": 5.2, "done_min": 6.0,
                   "left_early": True}],
    "events": [{"t_min": 0, "kind": "start", "wp": None, "detail": "Mission"},
               {"t_min": 5.2, "kind": "arrive", "wp": 1},
               {"t_min": 6.0, "kind": "done", "wp": 1, "detail": "left early"},
               {"t_min": 12.5, "kind": "complete", "wp": None}],
    "track": {
        "columns": ["t_min", "lon", "lat", "elev_m", "cross_track_m", "schedule_delta_min",
                    "o2_used_l", "o2_delta_l", "margin_min", "status"],
        "sample_every_min": 0.0833,
        "rows": [[0, 137.401783, -4.77748, -3742.4, 0.0, 0.0, 0.0, 0.0, 280.0, "ON PLAN"],
                 [0.0833, 137.4018, -4.7775, None, 1.2, None, 0.1, None, None, "ON PLAN"]],
    },
}


def errors(doc):
    return list(Draft202012Validator(SCHEMA).iter_errors(doc))


def test_schema_is_valid_2020_12():
    Draft202012Validator.check_schema(SCHEMA)


def test_minimal_log_validates():
    assert errors(DOC) == []


def test_wrong_kind_rejected():
    d = copy.deepcopy(DOC)
    d["kind"] = "homeline_mission"
    assert errors(d)


def test_short_track_row_rejected():
    d = copy.deepcopy(DOC)
    d["track"]["rows"].append([1.0, 137.4, -4.77])
    assert errors(d)


def test_unknown_status_rejected():
    d = copy.deepcopy(DOC)
    d["track"]["rows"][0][9] = "LOST"
    assert errors(d)
