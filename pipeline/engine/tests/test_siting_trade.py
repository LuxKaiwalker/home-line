"""F8 siting and F11 trade-table logic on synthetic grids.

Rule values from site.yaml ``siting`` (block 20 m, max slope 5 deg, F8).
"""

import numpy as np
import pytest

from pipeline.engine import dijkstra, physio, siting, trade
from pipeline.engine.config import load
from pipeline.engine.geo import validate
from pipeline.engine.synthetic import make_grid, plane

RES = 3.0
BLOCK = load("site")["siting"]["block_m"]
MAX_SLOPE = load("site")["siting"]["max_slope_deg"]
P_CON = physio.params("conservative", suit_kg=104, v1_rmse_deg=1.0)  # RMSE stub (WS6)
TAB = physio.grade_table(P_CON)


@pytest.fixture(scope="module")
def world():
    z = plane(201, RES, 0.02)  # gentle 2 % rise to the north
    z[:, 150:] += np.linspace(0, 60, 51)[None, :]  # steep eastern strip (> 5 deg)
    g = make_grid(z, RES)
    stations = [(60, 60), (60, 120), (150, 90)]
    values = [1.0, 0.5, 0.5]
    t = [dijkstra.forward_field(g, TAB, s).t_min for s in stations]
    return g, stations, values, t


def test_candidates_exclude_steep(world):
    g, *_ = world
    b = siting.blocks(g, BLOCK, MAX_SLOPE)
    steep_cells = g.maxslope > MAX_SLOPE
    bad_blocks = np.unique(b.label[steep_cells & (b.label >= 0)])
    assert not b.candidate[bad_blocks].any()
    assert b.candidate.sum() > 50


def test_score_matches_direct(world):
    g, stations, values, t = world
    b = siting.blocks(g, BLOCK, MAX_SLOPE)
    s = siting.score(b, t, values, 3.0)
    for i in np.flatnonzero(b.candidate)[::17]:
        r, c = b.rep[i]
        direct = sum(v for tt, v in zip(t, values, strict=True) if tt[r, c] <= 3.0)
        assert s[i] == pytest.approx(direct)
    assert np.isnan(s[~b.candidate]).all()


def test_rank_prefers_value_then_lower(world):
    g, stations, values, t = world
    b = siting.blocks(g, BLOCK, MAX_SLOPE)
    s = siting.score(b, t, values, 3.0)
    elev = [g.elev[rc] for rc in stations]
    order = siting.rank(b, s, values, elev)
    assert s[order[0]] == np.nanmax(s)
    tied = order[s[order] == s[order[0]]]
    assert np.all(np.diff(b.elev[tied]) >= -1e-9)  # lower first among equal scores
    hm = siting.heatmap(b, s)
    assert hm.shape == g.shape and np.nanmax(hm) == np.nanmax(s)


def test_trade_table_contract():
    rows, cols = [30, 60], [80, 104, 120]
    cells = {(b, m): {"science_value": 1.0 + b / 60 - m / 200, "reachable_pct": 50.0,
                      "partner_area_km2": None} for b in rows for m in cols}  # fmt: skip
    tt = trade.table(rows, cols, cells)
    validate(tt, "trade_table.schema.json")
    assert tt["cells"][1][0]["science_value"] == pytest.approx(1 + 1 - 0.4)


def test_science_within_homeline():
    t_home_at_station = {"S1": 12.0, "S2": 31.0, "S3": 59.0, "S4": float("inf")}
    values = {"S1": 0.7, "S2": 0.5, "S3": 0.9, "S4": 1.0}
    assert trade.science_value(t_home_at_station, values, 30) == pytest.approx(0.7)
    assert trade.science_value(t_home_at_station, values, 60) == pytest.approx(2.1)


def test_rule_from_config():
    r = siting.rule_from_config()
    assert r.variant == "conservative" and r.budget_min == 30 and r.top_k == 3
    assert r.block_m == BLOCK and r.max_slope_deg == MAX_SLOPE


def test_pad_doc_contract_and_hop(world):
    g, stations, values, t = world
    rule = siting.rule_from_config()
    b = siting.blocks(g, BLOCK, MAX_SLOPE)
    s = siting.score(b, t, values, 3.0)
    order = siting.rank(b, s, values, [g.elev[rc] for rc in stations])
    cov = siting.coverage(b, t, 3.0)
    hop = siting.best_hop(b, cov, values, int(order[0]))
    doc = siting.pad_doc(g, b, s, order, rule, 100.0, 90, hop)
    validate(doc, "pad.schema.json")
    assert doc["dummy"] is False
    assert doc["alternatives"][0]["rank"] == 1 and len(doc["alternatives"]) == rule.top_k
    assert doc["pad"]["checks"]["max_slope_deg"] <= MAX_SLOPE
    assert doc["pad"]["checks"]["assessed_pct_30min"] == 100.0
    assert doc["pad"]["checks"]["rule_passed"] is True
    if hop is not None:
        assert hop[1] > doc["pad"]["score"]
        assert len(doc["hop_options"][0]["pads"]) == 2


def test_hop_adds_value_on_split_stations():
    """Two station clusters too far apart for one pad: the hop covers the other cluster."""
    z = plane(201, RES, 0.0)
    g = make_grid(z, RES)
    stations = [(30, 30), (170, 170)]
    t = [dijkstra.forward_field(g, TAB, rc).t_min for rc in stations]
    b = siting.blocks(g, BLOCK, MAX_SLOPE)
    budget = 3.0  # ~170 m: no block reaches both stations (~590 m apart)
    s = siting.score(b, t, [1.0, 0.8], budget)
    order = siting.rank(b, s, [1.0, 0.8], [0.0, 0.0])
    assert s[order[0]] == 1.0
    hop = siting.best_hop(b, siting.coverage(b, t, budget), [1.0, 0.8], int(order[0]))
    assert hop is not None and hop[1] == pytest.approx(1.8)
