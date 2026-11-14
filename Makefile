# HOMELINE pipeline entry points. Stub targets print a message until the owning workstream
# adds its CLI (ownership: AGENTS.md "Folder ownership"; this file is owned by C).
.PHONY: all terrain engine horizons conditions nav web dummy test lint validate clean

PY := uv run --no-sync python

# Pipeline order (SPEC §4): WS1 terrain -> WS2 engine -> WS3 horizons -> WS4 conditions
# -> WS9 nav -> copy to web/public/data (C).
all: terrain engine horizons conditions nav web

terrain:     ## WS1
	@echo "terrain: stub (WS1 adds pipeline/terrain CLI)"
engine:      ## WS2
	@echo "engine: stub (WS2 adds pipeline/engine CLI)"
horizons:    ## WS3
	@echo "horizons: stub (WS3 adds pipeline/horizon CLI)"
conditions:  ## WS4
	@echo "conditions: stub (WS4 adds pipeline/conditions CLI)"
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

clean:
	rm -rf data/interim/* web/dist .pytest_cache .ruff_cache
