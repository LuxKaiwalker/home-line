"""WP8c (D110): validate one exported mission.json for the route harness (drive-route.mjs h, i).

    uv run --no-sync python tests/e2e/route/check_mission.py <mission.json> [--schema <mission.schema.json>]

Prints one JSON object: the schema errors (contracts/bundle/mission.schema.json, draft 2020-12),
the mission_id the README rule gives (tests/test_mission_contract.py `mission_id`: 'm-' + 12 hex of
the sha256 of the compact JSON with mission_id and created_utc set to ''), and the fields the
harness compares (origin, waypoints, summary.feasible). Exit 0 = it ran (the verdict is in the
JSON), 2 = the file is not JSON or the schema cannot be read. No new dependency: jsonschema and
the test helper are the repo's.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tests"))
from test_mission_contract import mission_id  # noqa: E402  (the contract test's id rule)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mission")
    ap.add_argument("--schema", default=str(REPO / "contracts" / "bundle" / "mission.schema.json"))
    a = ap.parse_args()
    try:
        schema = json.loads(Path(a.schema).read_text(encoding="utf-8"))
        doc = json.loads(Path(a.mission).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(json.dumps({"fatal": str(e)}))
        return 2
    errs = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.absolute_path))
    out = {
        "schema": a.schema,
        "schema_version": schema.get("x-contract-version"),
        "valid": not errs,
        "errors": [{"path": "/".join(map(str, e.absolute_path)), "message": e.message[:300]} for e in errs[:20]],
        "n_errors": len(errs),
        "mission_id": doc.get("mission_id") if isinstance(doc, dict) else None,
        "mission_id_rule": mission_id(doc) if isinstance(doc, dict) else None,
    }
    out["mission_id_ok"] = out["mission_id"] is not None and out["mission_id"] == out["mission_id_rule"]
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
