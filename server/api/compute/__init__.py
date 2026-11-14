"""WS11 compute routes (backend spec §4.2). So far: GET /results/{hash}/... (plan row 1.3)."""

from server.api.compute.results import identity_provider
from server.api.compute.results import router as results_router

__all__ = ["identity_provider", "results_router"]
