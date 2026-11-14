# HOMELINE pipeline entry points. Stub targets print a message until the owning workstream
# adds its CLI (ownership: AGENTS.md "Folder ownership"; this file is owned by C).
.PHONY: all terrain engine horizons conditions nav web dummy test lint validate kats h0 clean

PY := uv run --no-sync python

# Pipeline order (SPEC §4): WS1 terrain -> WS2 engine -> WS3 horizons -> WS4 conditions
# -> WS9 nav -> copy to web/public/data (C).
all: terrain engine horizons conditions nav web

terrain:     ## WS1: fetch raw (cached) then build data/interim/terrain/
	$(PY) -m pipeline.terrain.fetch dem
	$(PY) -m pipeline.terrain.fetch hirise
	$(PY) -m pipeline.terrain.fetch crism
	$(PY) -m pipeline.terrain.fetch lrgb
	$(PY) -m pipeline.terrain.build all
engine:      ## WS2: return fields, isochrones, bands, edges, partner, stations, route, trade
	$(PY) -m pipeline.engine.scenarios
horizons:    ## WS3
	@echo "horizons: stub (WS3 adds pipeline/horizon CLI)"
conditions:  ## WS4
	@echo "conditions: stub (WS4 adds pipeline/conditions CLI)"
nav:         ## WS9: F21 Monte Carlo + fix-interval map, F22 skyline fixes -> data/interim/navigation/
	$(PY) -m pipeline.navigation.run real $(NAV_ARGS)
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
