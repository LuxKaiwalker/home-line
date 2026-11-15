"""One heavy job at a time per visitor (WP11, D115; Notion "Planning UI - declutter and usability
plan" section 10.7 check 2; config/backend.yaml limits.guest_concurrent_heavy_jobs, assumed).

Known answers (written before the limit):
- the limit is the config value: 1 queued-or-running new heavy job per client address;
- while an address has a new job queued or running, its next submit that would start another new
  job is refused: 429, openapi Error ``job_in_progress`` with ``retry_after_s`` and a Retry-After
  header (the seconds until that job's job_timeout_s deadline at most; a full job_timeout_s while it
  still waits for a worker); another address is unaffected;
- when the job ends (done, error or timeout) the address may start the next one;
- submits that start no new job pass: attaching to a queued or running job (also the address's
  own), a cached result;
- a concurrent burst of distinct new jobs from one address starts exactly one;
- a refusal by this limit does not use the rate-limit quota (limits.guest_heavy_jobs);
- the 429 carries the CORS header for an allowed origin;
- the address is kept only as the limiter's salted hash.
"""

from __future__ import annotations

import math
import threading

import pytest

pytest.importorskip("fastapi")  # server dependency group (uv sync --group server)
pytest.importorskip("httpx")

from server.api.auth.limits import ActiveJobs  # noqa: E402
from server.settings import load, settings  # noqa: E402
from server.tests.test_jobs import (  # noqa: E402
    TIMEOUT_S,
    assert_valid,
    finished,
    inputs,
    submit,
    wait_job,
)
from server.tests.test_limits import IP_A, IP_B, LIMIT  # noqa: E402
from server.tests.test_limits import app_clients as _app_clients  # noqa: E402

PREFIX = settings().api.prefix
CONCURRENT = settings().limits.guest_concurrent_heavy_jobs


@pytest.fixture
def server_data(tmp_path, monkeypatch):
    sd = tmp_path / "server"
    sd.mkdir()
    monkeypatch.setenv("HL_SERVER_DATA", str(sd))
    monkeypatch.delenv(settings().deploy.kill_switch_env, raising=False)
    return sd


def app_clients(*clients, **kw):
    """test_limits.app_clients with the config's one-job-at-a-time limit (the other limit tests
    raise it, test_jobs.app_cfg)."""
    return _app_clients(*clients, concurrent=CONCURRENT, **kw)
SLOW = "sleep:0.8"  # a test job that stays queued or running long enough to be seen


# ----------------------------------------------------------------------------- config ----
def test_the_limit_is_the_config_value_and_marked_assumed():
    c = load()
    assert c.limits.guest_concurrent_heavy_jobs == 1
    assert "limits.guest_concurrent_heavy_jobs" in c.assumed


# ---------------------------------------------------------------------- the active set ----
def test_active_jobs_refuse_a_second_while_the_first_is_alive():
    alive = {"j1"}
    a = ActiveJobs(limit=1)
    ok, busy = a.reserve("k", alive.__contains__)
    assert (ok, busy) == (True, [])
    a.confirm("k", "j1")
    assert a.reserve("k", alive.__contains__) == (False, ["j1"])  # refused, names the job
    assert a.reserve("other", alive.__contains__)[0] is True  # another key is unaffected
    alive.clear()  # j1 ended
    assert a.reserve("k", alive.__contains__)[0] is True


def test_active_jobs_pending_reservations_never_pass_the_limit():
    a = ActiveJobs(limit=1)
    assert a.reserve("k", lambda j: True) == (True, [])
    assert a.reserve("k", lambda j: True) == (False, [])  # undecided: ask again
    a.release("k")  # the first started no job
    assert a.reserve("k", lambda j: True) == (True, [])


def test_active_jobs_record_counts_a_start_without_a_reservation():
    a = ActiveJobs(limit=1)
    a.record("k", "j9")
    assert a.reserve("k", lambda j: True) == (False, ["j9"])


def test_active_jobs_forget_idle_keys():
    a, alive = ActiveJobs(limit=1), set()
    for k in ("a", "b", "c"):
        assert a.reserve(k, alive.__contains__)[0]
        a.confirm(k, f"j-{k}")
        alive.add(f"j-{k}")
    assert a.keys() == 3
    alive.clear()
    assert a.reserve("d", alive.__contains__)[0]  # a, b, c have ended: pruned
    a.release("d")
    assert a.keys() == 0


def test_active_jobs_limit_must_be_positive():
    with pytest.raises(ValueError):
        ActiveJobs(limit=0)


# ------------------------------------------------------------------------- through the API ----
def test_a_second_new_job_from_one_address_is_429_while_the_first_runs(server_data):
    with app_clients(IP_A, IP_B, timeout_s=5.0) as (a, b):
        first = submit(a, inputs(140.0, SLOW))
        assert first.status_code == 202 and first.json()["attached"] is False
        r = submit(a, inputs(140.01))
        body = assert_valid(r, "post", "/jobs")
        assert r.status_code == 429
        assert body["error"] == "job_in_progress"
        retry = body["retry_after_s"]
        assert isinstance(retry, int) and 1 <= retry <= math.ceil(5.0)  # <= the job timeout
        assert r.headers["retry-after"] == str(body["retry_after_s"])
        assert r.headers["cache-control"] == "no-store"
        assert "203.0.113.7" not in r.text  # the address is never echoed
        rb = submit(b, inputs(140.02))  # another address is unaffected
        assert rb.status_code == 202 and rb.json()["attached"] is False
        wait_job(a, first.json()["id"], finished)
        r2 = submit(a, inputs(140.01))  # the first has ended: the next one starts
        assert r2.status_code == 202 and r2.json()["attached"] is False


def test_attach_and_cached_result_pass_while_the_address_has_a_job(server_data):
    with app_clients(IP_A, IP_B, timeout_s=5.0) as (a, b):
        cached = submit(b, inputs(141.0))  # b computes a result a will ask for later
        wait_job(b, cached.json()["id"], finished)
        mine = submit(a, inputs(141.01, SLOW))
        assert mine.status_code == 202
        again = submit(a, inputs(141.01, SLOW))  # a's own running job: attach
        assert again.status_code == 202 and again.json()["attached"] is True
        assert again.json()["id"] == mine.json()["id"]
        other = submit(b, inputs(141.02, SLOW))  # b's job, a attaches to it
        assert other.status_code == 202
        att = submit(a, inputs(141.02, SLOW))
        assert att.status_code == 202 and att.json()["attached"] is True
        done = submit(a, inputs(141.0))  # a cached result
        assert done.status_code == 202 and done.json()["status"] == "done"


def test_a_job_that_failed_frees_the_slot(server_data):
    with app_clients(IP_A, timeout_s=5.0) as (a,):
        r = submit(a, inputs(142.0, "fail:boom"))
        assert wait_job(a, r.json()["id"], finished)["status"] == "error"
        assert submit(a, inputs(142.01)).status_code == 202


def test_a_job_that_timed_out_frees_the_slot(server_data):
    with app_clients(IP_A, timeout_s=TIMEOUT_S) as (a,):
        r = submit(a, inputs(143.0, "hang"))
        assert wait_job(a, r.json()["id"], finished)["status"] == "timeout"
        assert submit(a, inputs(143.01)).status_code == 202


def test_a_concurrent_burst_of_new_jobs_starts_exactly_one(server_data):
    n = 6
    with app_clients(IP_A, timeout_s=5.0) as (a,):
        out, barrier = [], threading.Barrier(n)

        def go(i):
            barrier.wait()
            out.append(submit(a, inputs(144.0 + i / 100, SLOW)))

        threads = [threading.Thread(target=go, args=(i,)) for i in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        codes = sorted(r.status_code for r in out)
        assert codes == [202] + [429] * (n - 1)
        assert {r.json()["error"] for r in out if r.status_code == 429} == {"job_in_progress"}


def test_a_refusal_by_this_limit_does_not_use_the_rate_limit_quota(server_data):
    with app_clients(IP_A, timeout_s=5.0) as (a,):
        first = submit(a, inputs(145.0, SLOW))
        for i in range(LIMIT.count + 2):  # many refusals while the first runs
            assert submit(a, inputs(145.1 + i / 100)).status_code == 429
        wait_job(a, first.json()["id"], finished)
        for i in range(1, LIMIT.count):  # the first used one slot: count - 1 more, one at a time
            r = submit(a, inputs(145.5 + i / 100))
            assert r.status_code == 202, r.json()
            wait_job(a, r.json()["id"], finished)
        r = submit(a, inputs(145.9))
        assert r.status_code == 429 and r.json()["error"] == "rate_limited"


def test_the_429_is_readable_cross_origin(server_data):
    origin = settings().api.cors_origins[0]
    with app_clients(IP_A, timeout_s=5.0) as (a,):
        assert submit(a, inputs(146.0, SLOW)).status_code == 202
        r = a.post(f"{PREFIX}/jobs", headers={"Origin": origin},
                   json={"type": "plan", "inputs": inputs(146.01)})
        assert r.status_code == 429 and r.json()["error"] == "job_in_progress"
        assert r.headers.get("access-control-allow-origin") == origin
