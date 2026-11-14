"""WS10 known-answer tests (X8 data probe). Synthetic fixtures only; no network."""

from __future__ import annotations

import math

import pytest

from pipeline.navigation import vo_probe as vp

RULE_TEXT = ">= 2 drives with >= 10 consecutive stereo pairs at <= 2 m spacing, with camera models"
CMOD = (
    "(0.92,0.34,-1.88);(0.88,-0.003,0.47);(27.7,76.4,14.7);(-9.0,0.04,82.0);"
    "(0.88,-0.003,0.47);(0.0,0.0001,0.006)"
)


def _item(cam, sclk, drive, xyz, *, site=125, sample="downsampled", rect="(1,1,256,256)",
           cmod=CMOD, attitude="(0.28,-0.10,0.05,0.95)"):
    side = "L" if cam == "left" else "R"
    return {
        "imageid": f"N{side}B_{int(sclk)}EDR_D{site}{drive:04d}TRAV01529M_",
        "instrument": f"NAV_{cam.upper()}_B",
        "sol": 5070,
        "site": site,
        "drive": drive,
        "spacecraft_clock": float(sclk),
        "subframe_rect": rect,
        "scale_factor": 4,
        "camera_model_type": "CAHVOR" if cmod else None,
        "camera_model_component_list": cmod,
        "attitude": attitude,
        "xyz": f"({xyz[0]},{xyz[1]},{xyz[2]})",
        "camera_vector": "(0.87,0.007,0.49)",
        "https_url": f"https://example.invalid/{side}{int(sclk)}.JPG?api_key=SECRET",
        "extended": {"sample_type": sample},
    }


def _drive_items(n, spacing, *, start_drive=100, step=6, sclk0=1000.0, site=125, **kw):
    """n stereo poses along +x at a fixed spacing (m); returns (left, right)."""
    left, right = [], []
    for k in range(n):
        xyz = (k * spacing, 0.0, 0.0)
        d = start_drive + step * (k + 1)
        for cam, out in (("left", left), ("right", right)):
            out.append(_item(cam, sclk0 + 60 * k, d, xyz, site=site, **kw))
    return left, right


# --- go rule from config ---------------------------------------------------------------------

def test_parse_go_rule_from_config_text():
    r = vp.parse_go_rule(RULE_TEXT)
    assert r == vp.GoRule(min_drives=2, min_run_pairs=10, max_spacing_m=2.0,
                          need_camera_model=True)


def test_parse_go_rule_reads_real_config():
    cfg = vp.load_probe_config()
    assert cfg["drives"] == 5
    assert vp.parse_go_rule(cfg["go_rule"]).min_run_pairs == 10


def test_parse_go_rule_rejects_unknown_text():
    with pytest.raises(ValueError):
        vp.parse_go_rule("go if it looks fine")


# --- parsing helpers -------------------------------------------------------------------------

def test_camera_model_and_attitude_presence():
    assert vp.has_camera_model(_item("left", 1, 1, (0, 0, 0)))
    assert not vp.has_camera_model(_item("left", 1, 1, (0, 0, 0), cmod=None))
    assert not vp.has_camera_model(_item("left", 1, 1, (0, 0, 0), cmod="(1,2);(3)"))
    assert vp.has_attitude(_item("left", 1, 1, (0, 0, 0)))
    assert not vp.has_attitude(_item("left", 1, 1, (0, 0, 0), attitude=None))


def test_frame_px_from_subframe_rect():
    assert vp.frame_px(_item("left", 1, 1, (0, 0, 0))) == (256, 256)
    assert vp.frame_px(_item("left", 1, 1, (0, 0, 0), rect="(1,1,64,64)")) == (64, 64)


def test_strip_api_key():
    url = "https://mars.nasa.gov/api/v1/x/?a=1&api_key=SECRET&b=2"
    assert vp.strip_api_key(url) == "https://mars.nasa.gov/api/v1/x/?a=1&b=2"
    assert "SECRET" not in vp.strip_api_key("https://h/p.JPG?api_key=SECRET")


# --- during-drive selection and pairing ------------------------------------------------------

def test_during_drive_is_strictly_between_drive_ends():
    items = [_item("left", k, d, (0, 0, 0)) for k, d in enumerate([100, 101, 150, 199, 200])]
    got = vp.during_drive(items, prev=(125, 100), end=(125, 200))
    assert [i["drive"] for i in got] == [101, 150, 199]


def test_during_drive_across_site_change():
    a = [_item("left", 1, d, (0, 0, 0), site=124) for d in (2800, 2866, 2900)]
    b = [_item("left", 2, d, (0, 0, 0), site=125) for d in (0, 5, 36)]
    got = vp.during_drive(a + b, prev=(124, 2866), end=(125, 36))
    assert [(i["site"], i["drive"]) for i in got] == [(124, 2900), (125, 0), (125, 5)]


def test_pairing_needs_same_sclk_and_size():
    left, right = _drive_items(3, 1.0)
    right[1]["subframe_rect"] = "(1,1,64,64)"  # same time, different product
    left.append(_item("left", 9999, 999, (9, 9, 9)))  # no right partner
    pairs = vp.pair_frames(left, right)
    assert len(pairs) == 2
    assert all(p.left["spacecraft_clock"] == p.right["spacecraft_clock"] for p in pairs)


def test_resolution_class_uses_api_sample_type():
    th = _item("left", 1, 1, (0, 0, 0), sample="thumbnail", rect="(1,1,64,64)")
    assert vp.resolution_class(th) == "thumbnail"
    assert vp.resolution_class(_item("left", 1, 1, (0, 0, 0))) == "downsampled"


# --- spacing and runs ------------------------------------------------------------------------

def test_spacing_and_median():
    left, right = _drive_items(5, 0.95)
    poses = vp.poses(vp.pair_frames(left, right))
    sp = vp.spacings(poses)
    assert sp == pytest.approx([0.95] * 4)
    assert vp.median_or_none(sp) == pytest.approx(0.95)
    assert vp.median_or_none([]) is None


def test_spacing_is_3d_distance():
    a = vp.Pose(sclk=0, site=1, drive=1, xyz=(0.0, 0.0, 0.0), pairs=[])
    b = vp.Pose(sclk=1, site=1, drive=2, xyz=(1.0, 2.0, 2.0), pairs=[])
    assert vp.spacings([a, b]) == pytest.approx([3.0])


def test_spacing_across_site_change_is_unknown():
    a = vp.Pose(sclk=0, site=124, drive=9, xyz=(0.0, 0.0, 0.0), pairs=[])
    b = vp.Pose(sclk=1, site=125, drive=0, xyz=(0.0, 0.0, 0.0), pairs=[])
    sp = vp.spacings([a, b])
    assert len(sp) == 1 and math.isnan(sp[0])


def test_longest_run_counts_pairs_not_steps():
    assert vp.longest_run([1.0] * 9, 2.0) == 10            # 10 poses, 9 steps
    assert vp.longest_run([1.0, 3.0, 1.0, 1.0], 2.0) == 3   # break at the 3 m step
    assert vp.longest_run([1.0, float("nan"), 1.0], 2.0) == 2
    assert vp.longest_run([], 2.0) == 1                     # one pose is a run of one
    assert vp.longest_run([2.0], 2.0) == 2                  # <= is inclusive


def test_pose_without_camera_model_breaks_run():
    left, right = _drive_items(12, 1.0)
    for it in (left[5], right[5]):
        it["camera_model_component_list"] = None
        it["camera_model_type"] = None
    rule = vp.parse_go_rule(RULE_TEXT)
    s = vp.summarise_class(vp.pair_frames(left, right), rule)
    assert s["pairs"] == 12 and s["pairs_with_camera_model"] == 11
    assert s["longest_run_pairs"] == 6  # poses 6..11


# --- drive summary and decision --------------------------------------------------------------

def _drive(n, spacing, sample="downsampled", rect="(1,1,256,256)"):
    left, right = _drive_items(n, spacing, sample=sample, rect=rect)
    return vp.summarise_drive(left, right, prev=(125, 100), end=(125, 100 + 6 * (n + 1)),
                              sol=5070, rule=vp.parse_go_rule(RULE_TEXT))


def test_drive_summary_contract_fields():
    d = _drive(12, 0.95)
    assert d["stereo_pairs"] == 12
    assert d["median_spacing_m"] == pytest.approx(0.95)
    assert d["has_camera_model"] is True
    assert d["meets_go_rule"] is True
    assert d["by_resolution"]["downsampled"]["frame_px"] == [256, 256]


def test_short_or_sparse_drives_fail():
    assert _drive(9, 0.95)["meets_go_rule"] is False   # 9 pairs < 10
    assert _drive(12, 2.5)["meets_go_rule"] is False   # spacing > 2 m


def test_thumbnails_do_not_count():
    d = _drive(20, 0.95, sample="thumbnail", rect="(1,1,64,64)")
    assert d["stereo_pairs"] == 0
    assert d["median_spacing_m"] is None
    assert d["has_camera_model"] is False
    assert d["meets_go_rule"] is False
    assert d["by_resolution"]["thumbnail"]["longest_run_pairs"] == 20


def test_no_frames_gives_unknown_not_zero_spacing():
    d = vp.summarise_drive([], [], prev=(125, 0), end=(125, 50), sol=5000,
                           rule=vp.parse_go_rule(RULE_TEXT))
    assert d["stereo_pairs"] == 0 and d["median_spacing_m"] is None
    assert d["meets_go_rule"] is False


def test_decision_needs_min_drives():
    rule = vp.parse_go_rule(RULE_TEXT)
    ok, bad = _drive(12, 0.95), _drive(5, 0.95)
    assert vp.decide([ok, bad, bad], rule) == "no-go"
    assert vp.decide([ok, ok, bad], rule) == "go"
    assert vp.decide([], rule) == "no-go"


def test_probe_document_validates_against_contract():
    rule = vp.parse_go_rule(RULE_TEXT)
    doc = vp.build_probe([_drive(12, 0.95), _drive(12, 0.95)], rule, RULE_TEXT, meta={})
    vp.validate_probe(doc)
    assert doc["decision"] == "go"
    assert doc["drives"][0]["drive"] == 100 + 6 * 13




# --- go rule boundaries (nav.yaml vo_probe.go_rule), fresh-run KATs ---------------------------

def test_rule_boundary_exactly_ten_pairs_at_exactly_two_metres_meets():
    assert _drive(10, 2.0)["meets_go_rule"] is True


def test_rule_one_step_over_two_metres_splits_the_run():
    left, right = _drive_items(12, 1.0)
    # Move poses 5.. by +1.01 m: step 4->5 becomes 2.01 m, runs are 5 and 7 poses.
    for it in left[5:] + right[5:]:
        x = float(it["xyz"].strip("()").split(",")[0]) + 1.01
        it["xyz"] = f"({x},0.0,0.0)"
    d = vp.summarise_drive(left, right, prev=(125, 100), end=(125, 100 + 6 * 13), sol=5070,
                           rule=vp.parse_go_rule(RULE_TEXT))
    assert d["by_resolution"]["downsampled"]["longest_run_pairs"] == 7
    assert d["meets_go_rule"] is False


def test_rule_needs_camera_models():
    left, right = _drive_items(12, 0.95, cmod=None)
    d = vp.summarise_drive(left, right, prev=(125, 100), end=(125, 100 + 6 * 13), sol=5070,
                           rule=vp.parse_go_rule(RULE_TEXT))
    assert d["has_camera_model"] is False and d["meets_go_rule"] is False


def test_full_res_pairs_alone_do_not_meet_rule():
    """Discovery: 1-2 full-resolution pairs per drive; far below a 10-pair run."""
    d = _drive(2, 0.95, sample="full", rect="(1,1,1024,1024)")
    assert d["stereo_pairs"] == 2 and d["meets_go_rule"] is False


def test_decision_counts_drives_meeting_the_rule_from_real_config():
    rule = vp.parse_go_rule(vp.load_probe_config()["go_rule"])
    ok, bad = _drive(12, 0.95), _drive(12, 2.5)
    assert vp.decide([ok, bad, bad, bad, bad], rule) == "no-go"
    assert vp.decide([ok, ok, bad, bad, bad], rule) == "go"
    assert vp.decide([ok] * 5, rule) == "go"
