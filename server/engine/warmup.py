"""Numba warm-up of the real engine kernels (plan row 1.1, spec §4.1: "Numba compiled at start-up,
before /health reports warm").

The kernels are imported from pipeline/engine (never copied, WS11 rule 1). The warm-up runs one
return-field and one forward-field search on a tiny synthetic grid, which compiles the jitted
Dijkstra (``dijkstra._dijkstra`` with its heap helpers) for the argument types every real search
uses. With ``cache=True`` later starts load the compiled code from Numba's cache.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable

log = logging.getLogger("homeline.engine")

# A grid just big enough for every one of the 16 moves to have an in-grid neighbour. A warm-up
# shape, not a limit: the compiled code does not depend on the grid size.
WARMUP_CELLS = 7
WARMUP_VARIANT = "nominal"  # variants.yaml variant every precomputed scenario uses as "nom"


def warm_engine() -> None:
    """Compile the engine's Numba kernels with one tiny search in each direction."""
    from pipeline.engine import dijkstra, physio, synthetic

    grid = synthetic.make_grid(synthetic.plane(n=WARMUP_CELLS))
    table = physio.grade_table(physio.params(WARMUP_VARIANT))
    mid = (WARMUP_CELLS // 2, WARMUP_CELLS // 2)
    dijkstra.return_field(grid, table, mid)
    dijkstra.forward_field(grid, table, mid)


class EngineState:
    """Warm-up status of this server process; the warm-up runs once, in a background thread."""

    def __init__(self, warmup: Callable[[], object] = warm_engine):
        self._warmup = warmup
        self._done = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.warm = False
        self.error: str | None = None
        self.seconds: float | None = None

    @property
    def ok(self) -> bool:
        """False only when the warm-up failed (the server is up but cannot plan)."""
        return self.error is None

    def start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            # daemon: a shutdown during the warm-up must not wait for the compiler
            self._thread = threading.Thread(target=self._run, name="engine-warmup", daemon=True)
            self._thread.start()

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the warm-up has finished (or failed); True if it finished in time."""
        return self._done.wait(timeout)

    def _run(self) -> None:
        t0 = time.perf_counter()
        try:
            self._warmup()
        except Exception as e:  # reported by /health (ok: false), never swallowed silently
            self.error = f"{type(e).__name__}: {e}"
            log.exception("engine warm-up failed")
        else:
            self.warm = True
        finally:
            self.seconds = time.perf_counter() - t0
            if self.warm:
                log.info("engine warm after %.1f s", self.seconds)
            self._done.set()
