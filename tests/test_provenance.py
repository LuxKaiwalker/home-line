"""Known-answer tests for WS6 provenance (briefs/WS6.md "Tests", SPEC §9 "Provenance").

- H0 check fails on a planted pre-H0 timestamp and passes otherwise.
- Manifest merge keeps keys unique.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import yaml
from jsonschema import Draft202012Validator

from pipeline.provenance import check_h0, manifest

REPO = Path(__file__).resolve().parent.parent
EVENT = yaml.safe_load((REPO / "config/event.yaml").read_text())
H0 = check_h0.load_h0()
AFTER_H0 = H0 + timedelta(hours=4)
MANIFEST_SCHEMA = json.loads((REPO / "contracts/manifest.schema.json").read_text())


@pytest.fixture
def frag_dir(tmp_path, monkeypatch):
    d = tmp_path / "fragments"
    monkeypatch.setenv(manifest.FRAGMENT_DIR_ENV, str(d))
    monkeypatch.setattr(manifest, "_utcnow", lambda: AFTER_H0)
    return d


# --------------------------------------------------------------------------- manifest


def test_record_adds_commit_and_utc(frag_dir):
    entry = manifest.record(
        "reachable_pct.nom_104.30", 42.5, "%", "data/interim/x.tif", "pipeline/engine/x.py"
    )
    assert entry["value"] == 42.5
    assert entry["units"] == "%"
    assert entry["file"] == "data/interim/x.tif"
    assert entry["script"] == "pipeline/engine/x.py"
    assert entry["utc"] == AFTER_H0.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert entry["utc"].endswith("Z")
    assert isinstance(entry["commit"], str) and entry["commit"]
    frag = json.loads((frag_dir / "pipeline__engine__x.json").read_text())
    assert frag["reachable_pct.nom_104.30"] == entry


def test_record_relativises_absolute_repo_paths(frag_dir):
    entry = manifest.record(
        "k.abs", 1, "m", str(REPO / "web/public/data/a.json"), str(REPO / "pipeline/a.py")
    )
    assert entry["file"] == "web/public/data/a.json"
    assert entry["script"] == "pipeline/a.py"


def test_record_converts_numpy_and_rejects_nan(frag_dir):
    e = manifest.record("k.np", np.float32(1.5), "deg", "f", "s.py")
    assert e["value"] == 1.5 and type(e["value"]) is float
    e = manifest.record("k.arr", np.array([1, 2]), None, "f", "s.py")
    assert e["value"] == [1, 2] and e["units"] is None
    assert manifest.record("k.none", None, "deg", "f", "s.py")["value"] is None
    with pytest.raises(ValueError):
        manifest.record("k.nan", float("nan"), "deg", "f", "s.py")
    with pytest.raises(ValueError):
        manifest.record("k.inf", [1.0, math.inf], "deg", "f", "s.py")


def test_record_rejects_bad_keys_and_units(frag_dir):
    for bad in ["", "has space", "dummy", 3]:
        with pytest.raises(ValueError):
            manifest.record(bad, 1, "m", "f", "s.py")
    with pytest.raises(ValueError):
        manifest.record("k.u", 1, 5, "f", "s.py")


def test_record_refuses_pre_h0_clock(frag_dir, monkeypatch):
    monkeypatch.setattr(manifest, "_utcnow", lambda: H0 - timedelta(seconds=1))
    with pytest.raises(manifest.ManifestError, match="H0"):
        manifest.record("k.early", 1, "m", "f", "s.py")


def test_rerecord_same_script_overwrites(frag_dir):
    manifest.record("k.a", 1, "m", "f", "s.py")
    manifest.record("k.a", 2, "m", "f", "s.py")
    out = manifest.merge(out_path=frag_dir.parent / "manifest.json")
    assert out["k.a"]["value"] == 2


def test_merge_keeps_keys_unique(frag_dir, tmp_path):
    manifest.record("k.a", 1, "m", "f", "pipeline/one.py")
    manifest.record("k.b", 2, "m", "f", "pipeline/two.py")
    out_path = tmp_path / "public" / "manifest.json"
    merged = manifest.merge(out_path=out_path)
    assert set(merged) == {"dummy", "k.a", "k.b"}
    assert merged["dummy"] is False
    on_disk = json.loads(out_path.read_text())
    assert on_disk == merged

    # Same key from a second script: merge must refuse rather than silently pick one.
    manifest.record("k.a", 99, "m", "f", "pipeline/two.py")
    with pytest.raises(manifest.DuplicateKeyError) as exc:
        manifest.merge(out_path=out_path)
    assert "k.a" in str(exc.value)
    assert json.loads(out_path.read_text()) == merged  # untouched on failure


def test_merge_dummy_flag(frag_dir, tmp_path):
    manifest.record("k.a", 1, "m", "f", "tools/make_dummy.py")
    merged = manifest.merge(out_path=tmp_path / "m.json", dummy=True)
    assert merged["dummy"] is True


def test_merged_manifest_validates_against_contract(frag_dir, tmp_path):
    manifest.record("k.a", {"lo": 1, "hi": 2}, "min", "f", "s.py")
    manifest.record("k.b", "O2", None, "f", "s.py")
    merged = manifest.merge(out_path=tmp_path / "m.json")
    Draft202012Validator(MANIFEST_SCHEMA).validate(merged)


def test_merge_cli(frag_dir, tmp_path):
    manifest.record("k.a", 1, "m", "f", "s.py")
    out = tmp_path / "cli.json"
    assert manifest.main(["merge", "--out", str(out)]) == 0
    assert json.loads(out.read_text())["k.a"]["value"] == 1
    manifest.record("k.a", 2, "m", "f", "t.py")
    assert manifest.main(["merge", "--out", str(out)]) == 1


def test_git_commit_dirty_on_untracked_code_not_data(tmp_path, monkeypatch):
    def git(*a):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(tmp_path),
                        *a], check=True, capture_output=True)

    git("init", "-q")
    (tmp_path / "README").write_text("x\n")
    git("add", "README")
    git("commit", "-q", "-m", "init")
    monkeypatch.setattr(manifest, "REPO", tmp_path)
    manifest.git_commit.cache_clear()
    try:
        clean = manifest.git_commit()
        assert len(clean) == 40 and not clean.endswith("-dirty")
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "out.json").write_text("{}")
        manifest.git_commit.cache_clear()
        assert manifest.git_commit() == clean  # untracked outputs are not code
        (tmp_path / "pipeline").mkdir()
        (tmp_path / "pipeline" / "new_step.py").write_text("x = 1\n")
        manifest.git_commit.cache_clear()
        assert manifest.git_commit() == clean + "-dirty"  # uncommitted generating code
    finally:
        manifest.git_commit.cache_clear()


def test_fragment_files_are_world_readable(frag_dir):
    manifest.record("t.mode", 1, "1", "x.json", "pipeline/x.py")
    (frag,) = list(frag_dir.glob("*.json"))
    assert frag.stat().st_mode & 0o044 == 0o044


# --------------------------------------------------------------------------- H0 check


def _write_manifest(d: Path, utcs: list[str]) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    body: dict = {"dummy": False}
    for i, u in enumerate(utcs):
        body[f"k.{i}"] = {"value": i, "units": None, "file": "f", "script": "s", "commit": "c",
                          "utc": u}
    p = d / "manifest.json"
    p.write_text(json.dumps(body))
    return p


def _touch(p: Path, when: datetime) -> None:
    os.utime(p, (when.timestamp(), when.timestamp()))


def test_h0_comes_from_config_and_is_0900_local():
    assert H0 == datetime(2026, 11, 14, 8, 0, tzinfo=UTC)
    assert H0 == check_h0.parse_aware(EVENT["h0_utc"])
    assert H0 == check_h0.parse_aware(EVENT["h0_local"])  # 09:00 Europe/Zurich (UTC+1)


def test_load_h0_refuses_inconsistent_config(tmp_path):
    (tmp_path / "event.yaml").write_text(
        'h0_local: "2026-11-14T09:00:00+01:00"\nh0_utc: "2026-11-14T09:00:00Z"\n')
    with pytest.raises(ValueError, match="disagree"):
        check_h0.load_h0(tmp_path)


def test_h0_check_passes_after_h0(tmp_path):
    d = tmp_path / "data"
    p = _write_manifest(d, ["2026-11-14T08:00:00Z", "2026-11-14T10:30:00+01:00"])
    _touch(p, AFTER_H0)
    assert check_h0.check(d, H0) == []


def test_h0_check_fails_on_planted_pre_h0_manifest_time(tmp_path):
    d = tmp_path / "data"
    p = _write_manifest(d, ["2026-11-14T10:00:00Z", "2026-11-14T07:59:59Z"])
    _touch(p, AFTER_H0)
    problems = check_h0.check(d, H0)
    assert len(problems) == 1 and "k.1" in problems[0]


def test_h0_check_fails_on_nested_manifest(tmp_path):
    d = tmp_path / "data"
    p = _write_manifest(d / "sub", ["2026-11-13T23:00:00Z"])
    _touch(p, AFTER_H0)
    assert len(check_h0.check(d, H0)) == 1


def test_h0_check_fails_on_bad_or_naive_manifest_time(tmp_path):
    d = tmp_path / "data"
    p = _write_manifest(d, ["2026-11-14T10:00:00", "not a time"])
    _touch(p, AFTER_H0)
    assert len(check_h0.check(d, H0)) == 2


def test_h0_check_fails_on_planted_pre_h0_mtime(tmp_path):
    d = tmp_path / "data"
    (d / "scenarios").mkdir(parents=True)
    f = d / "scenarios" / "old.geojson"
    f.write_text("{}")
    _touch(f, H0 - timedelta(seconds=1))
    problems = check_h0.check(d, H0)
    assert len(problems) == 1 and "old.geojson" in problems[0]
    _touch(f, H0)
    assert check_h0.check(d, H0) == []


def test_h0_check_empty_or_missing_dir_passes(tmp_path):
    assert check_h0.check(tmp_path / "missing", H0) == []
    assert check_h0.check(tmp_path, H0) == []
    keep = tmp_path / ".gitkeep"  # git placeholder, not a data file
    keep.write_text("")
    _touch(keep, H0 - timedelta(days=1))
    assert check_h0.check(tmp_path, H0) == []


def test_h0_check_refuses_data_dummy(tmp_path):
    pub = tmp_path / "public"
    d = pub / "data"
    d.mkdir(parents=True)
    dummy = pub / "data-dummy"
    p = _write_manifest(dummy, ["2020-01-01T00:00:00Z"])
    _touch(p, H0 - timedelta(days=1))
    assert check_h0.check(d, H0) == []  # the sibling dummy tree is not scanned
    with pytest.raises(ValueError):
        check_h0.check(dummy, H0)


def test_h0_check_main_exit_codes(tmp_path):
    d = tmp_path / "data"
    p = _write_manifest(d, ["2026-11-13T22:00:00Z"])
    _touch(p, AFTER_H0)
    assert check_h0.main(["--data-dir", str(d)]) == 1
    p.unlink()
    assert check_h0.main(["--data-dir", str(d)]) == 0


def test_h0_check_extra_manifest_argument(tmp_path):
    """CI also checks the merged interim manifest/fragments when given."""
    frag = tmp_path / "frag"
    frag.mkdir()
    (frag / "pipeline__x.json").write_text(json.dumps(
        {"k.a": {"value": 1, "units": "m", "file": "f", "script": "s", "commit": "c",
                 "utc": "2026-11-14T07:00:00Z"}}))
    assert check_h0.main(["--data-dir", str(tmp_path / "none"), "--fragments", str(frag)]) == 1
