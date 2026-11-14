# HOMELINE pipeline entry points. Stub targets print a message until the owning workstream
# adds its CLI (ownership: AGENTS.md "Folder ownership"; this file is owned by C).
.PHONY: all terrain engine horizons conditions conditions-fetch nav web dummy test lint validate kats h0 clean

PY := uv run --no-sync python

# Pipeline order (SPEC §4): WS1 terrain -> WS2 engine -> WS3 horizons -> WS4 conditions
# -> WS9 nav -> copy to web/public/data (C).
all: terrain engine horizons conditions nav web

terrain:     ## WS1
	@echo "terrain: stub (WS1 adds pipeline/terrain CLI)"
engine:      ## WS2: return fields, isochrones, bands, edges, partner, stations, route, trade
	$(PY) -m pipeline.engine.scenarios
horizons:    ## WS3
	@echo "horizons: stub (WS3 adds pipeline/horizon CLI)"
conditions:  ## WS4: rad, clock, rems, donki -> data/interim/conditions/ (cache: make conditions-fetch)
	$(PY) -m pipeline.conditions
conditions-fetch:  ## WS4: download/refresh data/raw/conditions/ (needs NASA_API_KEY for DONKI)
	$(PY) -m pipeline.conditions.fetch all
nav:         ## WS9
	@echo "nav: stub (WS9 adds pipeline/navigation CLI)"
web:         ## C: copy data/interim -> web/public/data, validate
	@echo "web: stub (C adds tools/make_web.py)"
dummy:       ## M0: tools/make_dummy.py -> web/public/data-dummy
	$(PY) tools/make_dummy.py --quiet

test:
	uv run --no-sync pytest
lint:
	uv run --no-sync ruff check .
validate:
	$(PY) tools/validate_contracts.py

kats:        ## WS6: test run -> data/interim/validation/kats.json (never fails the build)
	$(PY) -m pipeline.provenance.kats --exit-zero

h0:          ## WS6: no provenance time before H0
	$(PY) -m pipeline.provenance.check_h0

clean:
	rm -rf data/interim/* web/dist .pytest_cache .ruff_cache
