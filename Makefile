# HOMELINE pipeline entry points. Stub targets print a message until the owning workstream
# adds its CLI (ownership: AGENTS.md "Folder ownership"; this file is owned by C).
.PHONY: all terrain engine horizons conditions conditions-fetch nav fields fp3d fp3d-check web web-plan dummy test lint validate kats h0 clean

PY := uv run --no-sync python

# Pipeline order (SPEC §4): WS1 terrain -> WS2 engine -> WS3 horizons -> WS4 conditions
# -> WS9 nav -> copy to web/public/data (C).
all: terrain engine horizons conditions nav fields fp3d web

terrain:     ## WS1: fetch raw (cached) then build data/interim/terrain/
	$(PY) -m pipeline.terrain.fetch dem
	$(PY) -m pipeline.terrain.fetch hirise
	$(PY) -m pipeline.terrain.fetch crism
	$(PY) -m pipeline.terrain.fetch lrgb
	$(PY) -m pipeline.terrain.build all
	$(PY) -m pipeline.terrain.build farfield_v2
engine:      ## WS2: return fields, isochrones, bands, edges, partner, stations, route, trade
	$(PY) -m pipeline.engine.scenarios
horizons:    ## WS3: band check, Navcam frames + stop horizons, V2 + manual-check sheet, pad/station horizons, ring, cards (needs WS1 bands, WS2 stations.json)
	$(PY) -m pipeline.horizon.bands
	$(PY) -m pipeline.horizon.navcam fetch
	$(PY) -m pipeline.validation.v2_skyline
	$(PY) -m pipeline.horizon.cards
conditions:  ## WS4: rad, clock, rems, donki -> data/interim/conditions/ (cache: make conditions-fetch)
	$(PY) -m pipeline.conditions
conditions-fetch:  ## WS4: download/refresh data/raw/conditions/ (needs NASA_API_KEY for DONKI)
	$(PY) -m pipeline.conditions.fetch all
nav:         ## WS9: F21 Monte Carlo + fix-interval map, F22 skyline fixes -> data/interim/navigation/
	$(PY) -m pipeline.navigation.run real $(NAV_ARGS)
fields:      ## WS7: HUD field PNGs + worst-case fields -> data/interim/export/fields/ (WS1 grid/slope, WS2 rasters; merges WS9 fields_index_nav.json)
	$(PY) -m pipeline.export.fields_png
fp3d:        ## WS8: 3D near chunks, ortho textures, far mesh, index -> data/interim/export/fp3d/ (needs WS1 terrain, WS2 route, WS3 horizons)
	$(PY) -m pipeline.export.terrain_chunks $(FP3D_ARGS)
fp3d-check:  ## WS8: F20 data checks on the export (eye height on the route, rendered skyline vs WS3 horizons)
	cd web && FP3D_REAL_CHECK=1 npx vitest run src/fp3d --silent=false
web:         ## C: copy/transform data/interim -> web/public/data, merge manifest, validate, H0 check
	$(PY) tools/make_web.py
web-plan:    ## C: what make web would copy, and what is missing per owner (no writes)
	$(PY) tools/make_web.py --plan
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
