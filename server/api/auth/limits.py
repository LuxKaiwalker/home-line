"""Per-IP rate limit on heavy jobs (WS12 plan row 2.5, brief task 4; spec §8; F36).

Rule: a guest may start ``limits.guest_heavy_jobs.count`` new heavy jobs per
``limits.guest_heavy_jobs.window_min`` minutes (6 per 10 min); the next one is refused with
429, the openapi Error body (``rate_limited``, ``retry_after_s``) and a Retry-After header. It is a
sliding window over the start times (exact for "the seventh in 10 minutes"), kept in this process
(no dependency, no database: D69).

- **Key.** The ASGI client host only (``scope["client"]``, which is ``request.client.host``).
  uvicorn rewrites it from the trusted proxy's X-Forwarded-For (``--proxy-headers`` with
  FORWARDED_ALLOW_IPS = Caddy, server/ops O1); this code never reads a forwarding header, so a
  client cannot pick its own key. The host is kept only as a salted SHA-256 (spec §8: IPs stored
  hashed); the salt is random per process, so nothing outlives the process.
- **What counts.** Only a submit that starts a new job: POST /jobs answered 202 with
  ``attached: false``. Attaching to a running job, a cached result (``done`` at once), a refusal
  (422, 503 kill switch, 429 queue cap) cost nothing. To stay exact under concurrent submits the
  slot is reserved before the request runs, then confirmed or given back (SlidingWindow).
- **What passes without a slot (H1-2, O3b).** Before reserving, the limiter takes the submit's
  result hash exactly as POST /jobs does (``result_hash`` with the route's identity provider) and
  asks the runner (``JobRunner.lookup``). A hash that is running, queued or done passes at once,
  even at the limit, and is not counted: it costs nothing, and all local clients share one key.
  Anything else (no match, invalid inputs, no engine identity) takes the reserve path as before,
  so a new heavy job is never let through the limit by this check. If a passed submit starts a
  new job after all (its job ended between the check and the route), that job is counted.
- **Where.** An ASGI middleware around the app (WS11's route stays untouched: the hook is the
  route's own answer). It is installed inside the CORS middleware, so a browser can read the 429.
- **Queue-cap hook.** The queue cap itself is the runner's (compute.queue_max_waiting,
  server.engine.jobs: 429 ``queue_full``); this limiter does not count those refusals, and both
  429s share the Error shape with ``retry_after_s``, which the web client honours.
- After each accepted new job, ``on_new_job`` runs (cache eviction with pinning, see
  server.api.plans.pinning).
- **One job at a time (D115).** Besides the rate, an address may have at most
  ``limits.guest_concurrent_heavy_jobs`` (1, assumed) new jobs queued or running at once
  (``ActiveJobs``; section 10.7 check 2: "ONE heavy job at a time per visitor"). A submit that would
  start another is refused with 429 ``job_in_progress``, ``retry_after_s`` and a Retry-After header:
  the seconds until that job's job_timeout_s deadline (it is done or killed by then), or a full
  job_timeout_s while it still waits for a worker. It is checked before the rate, so such a refusal
  does not use the rate quota; the same passes as for the rate apply (attaches and cached results,
  also to the address's own job). Without the rule, one address could fill both workers and most of
  the queue with its six new jobs.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
import secrets
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable

import anyio
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from server.engine.hashing import EngineIdentity, canonical_inputs, result_hash
from server.settings import BackendConfig, settings

UNKNOWN_CLIENT = "unknown"  # no client address in the scope (never with uvicorn)
# How often a submit re-checks while other submits from its address settle (process timing, not a
# product limit: POST /jobs answers at once, server.engine.jobs)
SETTLE_POLL_S = 0.005
# JobRunner.lookup answers that mean a submit attaches or gets a cached result (no new job)
NO_NEW_JOB = frozenset({"running", "queued", "done"})


class SlidingWindow:
    """At most ``count`` confirmed starts per key within ``window_s`` seconds.

    A request first reserves a slot (pending), then confirms it (a job started) or releases it.
    While the confirmed starts alone fill the window, ``reserve`` refuses with the seconds until the
    oldest leaves it. While only pending reservations fill it, the outcome is not known yet:
    ``reserve`` answers "wait" and the caller asks again once those have settled. So concurrent
    submits that only attach to one job are never refused, and a burst of new jobs never passes
    the limit."""

    def __init__(self, count: int, window_s: float, clock: Callable[[], float] = time.monotonic):
        if count < 1 or window_s <= 0:
            raise ValueError("count >= 1 and window_s > 0")
        self.count = count
        self.window_s = window_s
        self._clock = clock
        self._lock = threading.Lock()
        # key -> [confirmed start times (oldest first), pending tokens]; keys by last use
        self._hits: OrderedDict[str, tuple[deque[float], set[int]]] = OrderedDict()
        self._salt = secrets.token_bytes(16)
        self._next = itertools.count(1)

    def key(self, host: str) -> str:
        """The stored key of a client address: a salted hash, never the address."""
        return hashlib.sha256(self._salt + host.encode("utf-8", "surrogateescape")).hexdigest()[:32]

    def _prune(self, now: float) -> None:
        """Forget keys idle for a whole window (memory stays bounded by the active keys)."""
        cutoff = now - self.window_s
        while self._hits:
            k, (q, pending) = next(iter(self._hits.items()))  # least recently used first
            if pending or (q and q[-1] > cutoff):
                break
            del self._hits[k]

    def reserve(self, key: str) -> tuple[int | None, int | None]:
        """(token, None): a slot is reserved; (None, seconds): refused, retry after that many
        seconds; (None, None): undecided while other reservations settle, ask again."""
        with self._lock:
            now = self._clock()
            self._prune(now)
            q, pending = self._hits.setdefault(key, (deque(), set()))
            self._hits.move_to_end(key)
            cutoff = now - self.window_s
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= self.count:
                return None, max(1, math.ceil(q[0] + self.window_s - now))
            if len(q) + len(pending) >= self.count:
                return None, None
            token = next(self._next)
            pending.add(token)
            return token, None

    def confirm(self, key: str, token: int) -> None:
        """The reservation started a job: it counts from now for ``window_s``."""
        with self._lock:
            q, pending = self._hits.setdefault(key, (deque(), set()))
            pending.discard(token)
            q.append(self._clock())
            self._hits.move_to_end(key)

    def release(self, key: str, token: int) -> None:
        """Give back a reserved slot (the request started no job)."""
        with self._lock:
            entry = self._hits.get(key)
            if entry is not None:
                entry[1].discard(token)

    def record(self, key: str) -> None:
        """Count a job start that held no reservation (a submit that passed as an attach or a
        cached result but started a job after all)."""
        with self._lock:
            q, _ = self._hits.setdefault(key, (deque(), set()))
            q.append(self._clock())
            self._hits.move_to_end(key)

    def keys(self) -> int:
        with self._lock:
            return len(self._hits)


class ActiveJobs:
    """At most ``limit`` alive (queued or running) new jobs per key, the jobs this limiter saw
    start. ``alive(job_id)`` is asked at each reserve, so a finished job frees its key's slot
    without a callback. Like ``SlidingWindow``, a request reserves first, then confirms (with the
    id of the job it started) or releases; while only pending reservations fill the limit the answer
    is "ask again", so a burst of new jobs never passes it."""

    def __init__(self, limit: int):
        if limit < 1:
            raise ValueError("limit >= 1")
        self.limit = limit
        self._lock = threading.Lock()
        self._jobs: dict[str, list[str]] = {}  # key -> job ids started from it (maybe ended)
        self._pending: dict[str, int] = {}  # key -> reservations not settled yet

    def reserve(self, key: str, alive: Callable[[str], bool]) -> tuple[bool, list[str]]:
        """(True, []): reserved; (False, ids): refused, ``ids`` = the key's alive jobs;
        (False, []): undecided while other reservations of the key settle, ask again."""
        with self._lock:
            for k in list(self._jobs):  # prune ended jobs, and keys left with none
                live = [j for j in self._jobs[k] if alive(j)]
                if live:
                    self._jobs[k] = live
                else:
                    del self._jobs[k]
            live = self._jobs.get(key, [])
            if len(live) >= self.limit:
                return False, list(live)
            if len(live) + self._pending.get(key, 0) >= self.limit:
                return False, []
            self._pending[key] = self._pending.get(key, 0) + 1
            return True, []

    def _settle(self, key: str) -> None:
        n = self._pending.get(key, 0) - 1
        if n > 0:
            self._pending[key] = n
        else:
            self._pending.pop(key, None)

    def confirm(self, key: str, job_id: str | None) -> None:
        """The reservation started job ``job_id`` (None: a job whose id could not be read)."""
        with self._lock:
            self._settle(key)
            if job_id is not None:
                self._jobs.setdefault(key, []).append(job_id)

    def release(self, key: str) -> None:
        """Give back a reservation (the request started no job)."""
        with self._lock:
            self._settle(key)

    def record(self, key: str, job_id: str | None) -> None:
        """A job start that held no reservation (passed as an attach or a cached result)."""
        if job_id is not None:
            with self._lock:
                self._jobs.setdefault(key, []).append(job_id)

    def keys(self) -> int:
        with self._lock:
            return len(set(self._jobs) | set(self._pending))


def started_new_job(status: int | None, body: bytes) -> bool:
    """True when a POST /jobs answer says a new job was queued (202, attached false)."""
    if status != 202:
        return False
    try:
        doc = json.loads(body)
    except ValueError:
        return True  # a 202 we cannot read: count it (never under-count)
    return not (isinstance(doc, dict) and doc.get("attached") is True)


async def read_body(receive: Receive) -> tuple[bytes, Receive]:
    """The whole request body, and a ``receive`` that replays it to the app (then defers to the
    server's own ``receive``, e.g. for http.disconnect)."""
    chunks: list[bytes] = []
    while True:
        message = await receive()
        if message["type"] != "http.request":  # the client went away: hand that on as is
            return b"".join(chunks), _replay(None, receive, message)
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break
    body = b"".join(chunks)
    return body, _replay(body, receive, None)


def _replay(body: bytes | None, receive: Receive, last: Message | None) -> Receive:
    pending: list[Message] = ([{"type": "http.request", "body": body, "more_body": False}]
                              if body is not None else [last])

    async def replay() -> Message:
        if pending:
            return pending.pop(0)
        return await receive()

    return replay


def submit_lookup(scope: Scope, body: bytes) -> str | None:
    """What POST /jobs would find for this body: ``JobRunner.lookup`` of its result hash, taken
    the same way as the route (server.api.compute.jobs.create_job), or None when the hash cannot
    be taken (not JSON, invalid inputs, no engine identity, no runner). Read-only."""
    from server.api.compute.results import identity_provider  # the route's dependency

    app = scope.get("app")
    runner = getattr(getattr(app, "state", None), "jobs", None)
    if runner is None or not hasattr(runner, "lookup"):
        return None
    try:
        doc = json.loads(body)
        if not isinstance(doc, dict) or not isinstance(doc.get("inputs"), dict):
            return None
        raw = doc["inputs"]
        canonical_inputs(raw)  # the route answers 422 for invalid inputs: not ours to decide
        overrides = getattr(app, "dependency_overrides", {})
        ident = EngineIdentity(*overrides.get(identity_provider, identity_provider)()())
        h = result_hash(raw, ident)
        return runner.lookup(h, lambda: ident)
    except Exception:  # noqa: BLE001  any doubt takes the reserve path (the limit applies)
        return None


def rate_limited(retry_after_s: int, count: int, window_min: float) -> tuple[int, dict, bytes]:
    body = {"error": "rate_limited",
            "detail": f"at most {count} new heavy jobs per {window_min:g} min from one address; "
                      f"retry in {retry_after_s} s",
            "retry_after_s": retry_after_s}
    headers = {"content-type": "application/json", "cache-control": "no-store",
               "retry-after": str(retry_after_s)}
    return 429, headers, json.dumps(body).encode("utf-8")


def job_id(body: bytes) -> str | None:
    """The ``id`` of a POST /jobs 202 body, or None when it cannot be read."""
    try:
        doc = json.loads(body)
    except ValueError:
        return None
    jid = doc.get("id") if isinstance(doc, dict) else None
    return jid if isinstance(jid, str) else None


def job_in_progress(retry_after_s: int, limit: int, status: str) -> tuple[int, dict, bytes]:
    jobs_word = "job" if limit == 1 else "jobs"
    body = {"error": "job_in_progress",
            "detail": f"at most {limit} heavy {jobs_word} at a time from one address; yours is "
                      f"{status}; retry in {retry_after_s} s",
            "retry_after_s": retry_after_s}
    headers = {"content-type": "application/json", "cache-control": "no-store",
               "retry-after": str(retry_after_s)}
    return 429, headers, json.dumps(body).encode("utf-8")


ALIVE = frozenset({"queued", "running"})


def _runner(scope: Scope):
    return getattr(getattr(scope.get("app"), "state", None), "jobs", None)


def _status(runner, jid: str) -> str | None:
    view = runner.status(jid) if runner is not None else None
    return view.get("status") if isinstance(view, dict) else None


class HeavyJobLimiter:
    """ASGI middleware: the guest heavy-job limit on POST {prefix}/jobs (see the module doc)."""

    def __init__(self, app: ASGIApp, cfg: BackendConfig | None = None,
                 on_new_job: Callable[[Scope], None] | None = None,
                 clock: Callable[[], float] = time.monotonic):
        cfg = cfg or settings()
        lim = cfg.limits.guest_heavy_jobs
        self.app = app
        self.path = f"{cfg.api.prefix}/jobs"
        self.count, self.window_min = lim.count, lim.window_min
        self.window = SlidingWindow(lim.count, lim.window_min * 60, clock)
        self.active = ActiveJobs(cfg.limits.guest_concurrent_heavy_jobs)
        self.on_new_job = on_new_job

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (scope["type"] != "http" or scope["method"] != "POST"
                or scope["path"].rstrip("/") != self.path):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        key = self.window.key(client[0] if client else UNKNOWN_CLIENT)
        body, receive = await read_body(receive)
        if submit_lookup(scope, body) in NO_NEW_JOB:  # attach or cached result: no slot (H1-2)
            await self._run(scope, receive, send, key, None)
            return
        runner = _runner(scope)

        def alive(jid: str) -> bool:
            return _status(runner, jid) in ALIVE

        while True:  # one job at a time (D115), before the rate: a refusal here costs no quota
            ok, busy = self.active.reserve(key, alive)
            if ok or busy:
                break
            await anyio.sleep(SETTLE_POLL_S)  # another submit from this address is in flight
        if not ok:
            await self._refuse(send, *self._busy(runner, busy))
            return
        while True:
            token, retry = self.window.reserve(key)
            if token is not None or retry is not None:
                break
            await anyio.sleep(SETTLE_POLL_S)  # other submits from this address are in flight
        if token is None:
            self.active.release(key)
            await self._refuse(send, *rate_limited(retry, self.count, self.window_min))
            return
        await self._run(scope, receive, send, key, token)

    def _busy(self, runner, busy: list[str]) -> tuple[int, dict, bytes]:
        """The job_in_progress answer: retry when the address's running job closest to its
        deadline has ended, or after a full job timeout while its jobs still wait."""
        running = [d for d in (runner.deadline_in(j) for j in busy) if d is not None] \
            if runner is not None and hasattr(runner, "deadline_in") else []
        timeout = getattr(runner, "job_timeout_s", None) or settings().compute.job_timeout_s
        retry = max(1, math.ceil(min(running) if running else timeout))
        status = "running" if running else "queued"
        return job_in_progress(retry, self.active.limit, status)

    @staticmethod
    async def _refuse(send: Send, status: int, headers: dict, body: bytes) -> None:
        await send({"type": "http.response.start", "status": status,
                    "headers": [(k.encode(), v.encode()) for k, v in headers.items()]})
        await send({"type": "http.response.body", "body": body})

    async def _run(self, scope: Scope, receive: Receive, send: Send, key: str,
                   token: int | None) -> None:
        """Run the route; count the submit when it started a new job (with its reservation, or
        without one when it passed as an attach or a cached result), else give the slot back.
        The same for the one-job-at-a-time reservation (held exactly when ``token`` is)."""
        seen: dict = {"status": None, "body": bytearray()}

        async def watch(message: Message) -> None:
            if message["type"] == "http.response.start":
                seen["status"] = message["status"]
            elif message["type"] == "http.response.body":
                seen["body"] += message.get("body", b"")
            await send(message)

        new = False
        try:
            await self.app(scope, receive, watch)
            new = started_new_job(seen["status"], bytes(seen["body"]))
        finally:
            jid = job_id(bytes(seen["body"])) if new else None
            if token is None:
                if new:
                    self.window.record(key)
                    self.active.record(key, jid)
            elif new:
                self.window.confirm(key, token)
                self.active.confirm(key, jid)
            else:
                self.window.release(key, token)
                self.active.release(key)
        if new and self.on_new_job is not None:
            self.on_new_job(scope)
