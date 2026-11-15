"""Job type ``plan`` (WS11 plan row 2.4, brief tasks 8-9; F23, F24, F35; D76, D81).

A plan for one pad with the default crew is ONE call of ``pipeline.engine.plan.build_plan``
(WS11 rule 1: no engine code here). ``build`` maps canonical plan_inputs to that call; the parity
harness (server/tests/parity_harness.py ``server_build``) calls the same function, so parity
tests exactly what the server runs.

Scenario set (D81): the official pad keeps the full official set (variants.yaml scenarios.ids);
any other pad computes only the three variants at the default scenario's suit mass (104 kg).

Supported inputs (brief task 8): the pad. Every other plan_inputs field must equal its default
(route inputs are task 10, custom crew task 11); otherwise the job fails with
``UnsupportedInputs`` naming the fields, never silently ignoring them. Inputs outside the config
ranges (config/backend.yaml ``ranges``) are reported as run-record ``range_flags``; nothing is
clamped.

Stages (D81: the map fills in early; job.schema.json ``stages_done``):
1. ``nominal``: a preview build_plan call with the default scenario only (partner line on, so the
   route is the final one), into a hidden scratch dir. Published: that scenario's isochrones,
   edges and partner line, its band file (nominal only, replaced in stage 2), route and
   timeline.
2. ``bands``: the full call's web products (every variant's isochrones and edges, the bands).
3. ``partner``: partner lines.
4. ``route``: stations.json, route, timeline, trade table, station cards (WS2's card part merged
   with the server data's WS3 horizon part by make web's merge_card; the parts themselves are
   not published).
5. ``summary``: scenarios/index.json and manifest.json (written once, here), exporter files
   (server.engine.exporters, D76), then the runner writes run_record.json last.
A file is copied into the job tree only when its bytes changed, so a file of stage 1 that the full
call reproduces byte for byte is published once. Files of a tree without run_record.json are
served with ``Cache-Control: no-store`` (server.api.compute.results), so a rewritten band file is
never cached.

World: ``$HL_SERVER_DATA/terrain`` (make serverdata's copy of the WS1 grids and stations.json).
WS4 margin inputs are on when ``$HL_SERVER_DATA/conditions`` exists; the engine reads them from
data/interim/conditions (scenarios.conditions_inputs has no root parameter), so the job checks
those files are byte-identical to the server data copies (covered by the terrain hash) and that
both margin terms resolved; otherwise it fails.
"""

from __future__ import annotations

import filecmp
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from server.engine import exporters, version
from server.engine.defaults import ranges as config_ranges
from server.engine.hashing import canonical_inputs, official_inputs
from server.engine.jobs import JobContext, JobType, register_job_type

STAGES = ("nominal", "bands", "partner", "route", "summary")
# build_plan stage (pipeline/engine/plan.py on_stage) after which a job stage is published
AT_BUILD_STAGE = {"web_products": "bands", "partner": "partner", "trade": "route"}
CARD_PART = "cards/{S}.timeline.json"  # WS2's card part (cards.write); merged, never published
HELD = ("scenarios/index.json",)  # written once, in the summary stage (with manifest.json)
MANIFEST = "manifest.json"
WORK = ".work"  # hidden scratch dir inside the job's temp dir (never published or served)
CONDITION_FILES = ("clock.json", "rad.json")  # what scenarios.conditions_inputs/storm_timing read

# plan_inputs dotted key -> config/backend.yaml ranges key (F26, F25)
RANGE_KEYS = {
    "crew.body_mass_kg": "body_mass_kg",
    "crew.suit_kg": "suit_kg",
    "crew.tools_kg": "tools_kg",
    "crew.vo2max_ml_kg_min": "vo2max_ml_kg_min",
    "crew.effort_cap_frac": "effort_cap_frac",
    "eva.duration_h": "eva_duration_h",
    "eva.reserve_min": "reserve_min",
    "eva.start_lmst_h": "start_lmst_h",
    "eva.walkback_budgets_min": "walkback_budget_min",
    "conditions.d_allow_mgy": "d_allow_mgy",
    "stations.dwell_min": "dwell_min",
}


class UnsupportedInputs(ValueError):
    """plan_inputs fields this server cannot plan yet (not silently ignored)."""


# ------------------------------------------------------------------------ inputs ----
def _official() -> dict:
    return canonical_inputs(official_inputs())


def is_official_pad(inputs: dict) -> bool:
    pad, off = canonical_inputs(inputs)["pad"], _official()["pad"]
    return (pad["lon"], pad["lat"]) == (off["lon"], off["lat"])


def unsupported(inputs: dict) -> list[str]:
    """Top-level plan_inputs blocks (other than the pad) that differ from the defaults."""
    c, d = canonical_inputs(inputs), _official()
    return sorted(k for k in set(c) | set(d) if k not in ("pad", "contract_version")
                  and c.get(k) != d.get(k))


def scenario_set(inputs: dict) -> list[str]:
    """D81: the official pad keeps the official set; other pads the default suit's variants."""
    from pipeline.engine import physio
    from pipeline.engine.config import load

    sc = load("variants")["scenarios"]
    if is_official_pad(inputs):
        return list(sc["ids"])
    suit = physio.parse_scenario(sc["default"])[1]
    return [s for s in sc["ids"] if physio.parse_scenario(s)[1] == suit]


def range_flags(inputs: dict) -> list[dict]:
    """F26: every numeric input outside its config range, flagged (never clamped)."""
    r = config_ranges()
    note = r["anchored_flag_note"]
    c = canonical_inputs(inputs)
    flags = []
    for dotted, rkey in RANGE_KEYS.items():
        block, field = dotted.split(".")
        v = c.get(block, {}).get(field)
        lim = r.get(rkey)
        if v is None or not isinstance(lim, dict):
            continue
        items = (sorted(v.items()) if isinstance(v, dict)
                 else enumerate(v) if isinstance(v, list) else [(None, v)])
        for sub, x in items:
            if not isinstance(x, (int, float)):
                continue
            if ("min" in lim and x < lim["min"]) or ("max" in lim and x > lim["max"]):
                key = dotted if sub is None else f"{dotted}.{sub}"
                flags.append({"key": key, "value": float(x), "note": str(note)})
    return flags


# ------------------------------------------------------------------ build_plan call ----
def build(inputs: dict, *, terrain_dir: Path, out_dir: Path, public_dir: Path | None = None,
          manifest_dir: Path, conditions: bool, rad_json: Path, grid=None, preview: bool = False,
          on_stage=None) -> dict:
    """Canonical plan_inputs -> one build_plan call (the server path; parity calls this).

    ``preview``: only the default scenario (the job's nominal stage). Returns the run summary."""
    from pipeline.engine import scenarios
    from pipeline.engine.config import load
    from pipeline.engine.graph import load_ws1_grid
    from pipeline.engine.physio import MissingInput
    from pipeline.engine.plan import build_plan

    bad = unsupported(inputs)
    if bad:
        raise UnsupportedInputs(f"plan_inputs {bad} differ from the defaults; this server plans "
                                "a custom pad with the default crew and route only")
    pad = canonical_inputs(inputs)["pad"]
    grid = load_ws1_grid(terrain_dir) if grid is None else grid
    ids = [load("variants")["scenarios"]["default"]] if preview else scenario_set(inputs)
    sids, skipped = scenarios.runnable(ids, None)
    # plan_inputs conditions.storm "2024-05-20" = the D39 timed storm replay (--dose storm)
    cond = scenarios.conditions_inputs(None, None, "storm", conditions)
    if conditions and (cond.get("t_dark_min") is None or cond.get("tau_dose_min") is None):
        raise MissingInput(f"WS4 margin inputs did not resolve: {cond}")
    dose_fn = scenarios.storm_timing(cond, rad_json)
    return build_plan(grid, pad_lonlat=(pad["lon"], pad["lat"]), scenario_ids=sids,
                      settings=scenarios.settings_from_config(None), out_dir=out_dir,
                      public_dir=public_dir if public_dir is not None else out_dir / "public",
                      terrain_dir=terrain_dir, cond=cond, dose_fn=dose_fn, partner=True,
                      siting=False, d21=None, skipped=skipped, rmse=None,
                      manifest_dir=manifest_dir, on_stage=on_stage, verbose=False)


def nominal_files(public: Path) -> list[str]:
    """The default scenario's own files in a preview tree (stage ``nominal``)."""
    from pipeline.engine import physio
    from pipeline.engine.config import load

    default = load("variants")["scenarios"]["default"]
    suit = physio.parse_scenario(default)[1]
    keep = (f"scenarios/{default}/", f"scenarios/bands_{suit}.", f"route_{default}.",
            f"timeline_{default}.")
    return sorted(rel for rel in _files(public) if rel.startswith(keep))


def _files(root: Path) -> list[str]:
    """Every file under ``root`` except WS2's card parts (published as merged cards)."""
    part = re.compile(re.escape(CARD_PART).replace(re.escape("{S}"), "[^/]+") + "$")
    return sorted(rel for p in root.rglob("*") if p.is_file()
                  and not part.match(rel := p.relative_to(root).as_posix()))


def _cards(ctx: JobContext, public: Path, horizon_dir: Path) -> list[str]:
    """cards/{S}.json = WS2's card part (this pad's route) merged with WS3's horizon part from
    the server data (make serverdata's cards/), by make web's own merge (tools.make_web
    .merge_card: nothing computed). A station without a horizon part gets no card."""
    from tools.make_web import merge_card

    written = []
    for part in sorted(public.glob(CARD_PART.format(S="*"))):
        st = part.name.split(".")[0]
        hz = horizon_dir / f"{st}.json"
        if not hz.is_file():
            continue
        doc = merge_card(st, json.loads(hz.read_text(encoding="utf-8")),
                         json.loads(part.read_text(encoding="utf-8")))
        rel = f"cards/{st}.json"
        data = (json.dumps(doc, indent=1, ensure_ascii=False) + "\n").encode("utf-8")
        if not (ctx.path(rel).is_file() and ctx.path(rel).read_bytes() == data):
            ctx.write_bytes(rel, data)
        written.append(rel)
    return written


def _copy(ctx: JobContext, src_root: Path, rels) -> None:
    """Copy files into the job tree, skipping any whose bytes are already there."""
    for rel in rels:
        src, dst = src_root / rel, ctx.path(rel)
        if dst.is_file() and filecmp.cmp(src, dst, shallow=False):
            continue
        ctx.write_bytes(rel, src.read_bytes())


def _check_conditions(cond_dir: Path) -> Path:
    """The engine reads WS4 margins from data/interim/conditions: they must be the server data's
    copies (which the terrain hash covers). Returns the rad.json the dose timing reads."""
    from pipeline.engine.scenarios import INTERIM_DIR

    for name in CONDITION_FILES:
        a, b = INTERIM_DIR / "conditions" / name, cond_dir / name
        if not (a.is_file() and b.is_file() and filecmp.cmp(a, b, shallow=False)):
            raise RuntimeError(f"WS4 {name}: {a} and {b} must exist and be identical (the "
                               "engine reads the first, the result hash covers the second)")
    return cond_dir / "rad.json"


def _utc() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# ------------------------------------------------------------------------- the job ----
def run_plan_job(inputs: dict, ctx: JobContext) -> dict:
    """Job handler (server.engine.jobs JobType.run; runs in a worker process)."""
    from pipeline.engine.graph import load_ws1_grid
    from pipeline.provenance import manifest

    sd = version.server_data_dir()
    terrain = sd / "terrain"
    cond_dir = sd / "conditions"
    conditions = cond_dir.is_dir()
    rad = _check_conditions(cond_dir) if conditions else cond_dir / "rad.json"
    flags = range_flags(inputs)
    work = ctx.out_dir / WORK
    grid = load_ws1_grid(terrain)
    common = dict(terrain_dir=terrain, conditions=conditions, rad_json=rad, grid=grid)

    # 1. nominal: the default scenario alone (preview call), published at once
    pre = work / "preview"
    build(inputs, out_dir=pre, public_dir=pre / "public", manifest_dir=work / "preview_manifest",
          preview=True, **common)
    _copy(ctx, pre / "public", nominal_files(pre / "public"))
    ctx.stage("nominal")

    # 2-4. the full call, published as build_plan's stages finish
    full, pub = work / "full", work / "full" / "public"

    def flush(upto: str) -> None:
        _copy(ctx, pub, [f for f in _files(pub) if f not in HELD])
        _cards(ctx, pub, sd / "cards")
        for name in STAGES[len(ctx.done):STAGES.index(upto) + 1]:
            ctx.stage(name)

    def on_stage(name: str, _files_changed) -> None:
        if name in AT_BUILD_STAGE and AT_BUILD_STAGE[name] not in ctx.done:
            flush(AT_BUILD_STAGE[name])

    build(inputs, out_dir=full, public_dir=pub, manifest_dir=work / "manifest",
          on_stage=on_stage, **common)
    if len(ctx.done) < STAGES.index("summary"):  # a build_plan stage was skipped (no stations)
        flush(STAGES[STAGES.index("summary") - 1])

    # 5. summary: the held files, exporters (D76), manifest.json, then the runner's run record
    _copy(ctx, pub, _files(pub))
    _cards(ctx, pub, sd / "cards")
    extra = exporters.run_exporters(ctx.out_dir, manifest.git_commit(), _utc())
    merged = manifest.merge(work / "manifest", out_path=work / MANIFEST)
    if extra:
        dup = sorted(set(extra) & set(merged))
        if dup:
            raise RuntimeError(f"exporter manifest keys clash with the engine's: {dup}")
        merged = {**merged, **extra}
        manifest.validate(merged)
    ctx.write_json(MANIFEST, merged)
    ctx.stage("summary")
    shutil.rmtree(work, ignore_errors=True)
    return {"range_flags": flags}


PLAN_JOB = JobType(run=run_plan_job, stages=STAGES)
register_job_type("plan", PLAN_JOB)
