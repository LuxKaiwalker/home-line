"""HOMELINE live API (F23; WS11 plan rows 1.1, 1.3): GET /health, /engine/version, /defaults,
/results/{hash}/... (server.api.compute.results).

Run: ``uv run --no-sync uvicorn server.app:app`` (``make serve``), then
http://localhost:8000/api/v1/health. Contract: contracts/backend/openapi.yaml (v1.0.0); prefix,
CORS origins and the kill-switch variable come from config/backend.yaml (server.settings).

/health answers at once; ``engine_warm`` turns true only after the Numba warm-up of the engine
kernels (server.engine.warmup), which the lifespan starts in a background thread.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from server.api.compute import results_router
from server.engine import defaults as engine_defaults
from server.engine import version as engine_version
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
            "queue_length": 0,  # no job runner yet (plan row 2.3)
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


def create_app(warmup: Callable[[], object] = warm_engine) -> FastAPI:
    """The API app; ``warmup`` is injectable so tests need not wait for the Numba compiler."""
    cfg = settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:  # fixed for the life of the process; a missing git is reported by /engine/version
            engine_version.code_identity()
        except engine_version.Unavailable:
            pass
        app.state.engine.start()  # background: /health answers while the kernels compile
        yield

    # openapi.yaml is the API description (F35); FastAPI's generated one would diverge from it
    app = FastAPI(title="HOMELINE live API", lifespan=lifespan,
                  openapi_url=None, docs_url=None, redoc_url=None)
    app.state.engine = EngineState(warmup)
    app.add_middleware(CORSMiddleware, allow_origins=list(cfg.api.cors_origins),
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(meta, prefix=cfg.api.prefix)
    app.include_router(results_router, prefix=cfg.api.prefix)
    return app


app = create_app()
