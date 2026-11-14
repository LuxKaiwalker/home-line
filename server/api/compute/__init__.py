"""WS11 compute routes (backend spec §4.2): GET /results/{hash}/... (plan row 1.3), POST /jobs and
GET /jobs/{id} (plan row 2.3)."""

from server.api.compute.jobs import router as jobs_router
from server.api.compute.results import identity_provider
from server.api.compute.results import router as results_router

__all__ = ["identity_provider", "jobs_router", "results_router"]
