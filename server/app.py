"""HOMELINE live API (F23; WS11 plan rows 1.1, 1.3, 2.3): GET /health, /engine/version, /defaults,
/results/{hash}/... (server.api.compute.results), POST /jobs, GET /jobs/{id}
(server.api.compute.jobs).

Run: ``uv run --no-sync uvicorn server.app:app`` (``make serve``), then
http://localhost:8000/api/v1/health. Contract: contracts/backend/openapi.yaml (v1.0.0); prefix,
CORS origins and the kill-switch variable come from config/backend.yaml (server.settings).

/health answers at once; ``engine_warm`` turns true only after the Numba warm-up of the engine
kernels (server.engine.warmup), which the lifespan starts in a background thread. The lifespan also
starts the job runner (server.engine.jobs: compute.workers processes, started once the warm-up has
finished) and stops it at shutdown.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from server.api.compute import jobs_router, results_router
from server.engine import defaults as engine_defaults
from server.engine import version as engine_version
from server.engine.jobs import JobRunner
from server.engine.warmup import EngineState, warm_engine
from server.settings import settings


def heavy_jobs() -> str:
    """'off' while the kill switch (config deploy.kill_switch_env) is set to a non-empty value."""
    return "off" if os.environ.get(settings().deploy.kill_switch_env) else "on"


def error(status: int, code: str, detail: str) -> JSONResponse:
    """openapi.yaml Error body."""
    return JSONResponse({"error": code, "detail": detail}, status_code=status)


meta = APIRouter(tags=["meta"])


@meta.get("/health", operation_id="getHealth")
def get_health(request: Request) -> dict:
    state: EngineState = request.app.state.engine
    return {"ok": state.ok, "engine_warm": state.warm,
            "queue_length": request.app.state.jobs.queue_length,
            "heavy_jobs": heavy_jobs()}


@meta.get("/engine/version", operation_id="getEngineVersion")
def get_engine_version():
    try:
        return engine_version.engine_version()
    except engine_version.Unavailable as e:
        msg = str(e)
        code = "server_data_missing" if "manifest" in msg else "engine_identity_unavailable"
        return error(503, code, msg)


@meta.get("/defaults", operation_id="getDefaults")
def get_defaults() -> dict:
    return engine_defaults.defaults()


def create_app(warmup: Callable[[], object] = warm_engine,
               jobs: JobRunner | None = None) -> FastAPI:
    """The API app; ``warmup`` is injectable so tests need not wait for the Numba compiler, and
    ``jobs`` so tests can run the runner with test job types and small limits (default: the
    config's compute limits and the registered job types)."""
    cfg = settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:  # fixed for the life of the process; a missing git is reported by /engine/version
            engine_version.code_identity()
        except engine_version.Unavailable:
            pass
        app.state.engine.start()  # background: /health answers while the kernels compile
        app.state.jobs.start(ready=app.state.engine.wait)  # workers start after the warm-up
        try:
            yield
        finally:
            app.state.jobs.stop()

    # openapi.yaml is the API description (F35); FastAPI's generated one would diverge from it
    app = FastAPI(title="HOMELINE live API", lifespan=lifespan,
                  openapi_url=None, docs_url=None, redoc_url=None)
    app.state.engine = EngineState(warmup)
    app.state.jobs = jobs if jobs is not None else JobRunner.from_config(cfg)
    app.add_middleware(CORSMiddleware, allow_origins=list(cfg.api.cors_origins),
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(meta, prefix=cfg.api.prefix)
    app.include_router(results_router, prefix=cfg.api.prefix)
    app.include_router(jobs_router, prefix=cfg.api.prefix)
    return app


app = create_app()
