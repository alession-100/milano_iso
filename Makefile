.PHONY: setup lint test data tiles

setup:
	uv sync --locked
	npm --prefix web ci

lint:
	uv run ruff check pipeline tests
	uv run ruff format --check pipeline tests

test: lint
	uv run pytest -v
	npm --prefix web run typecheck
	npm --prefix web run lint
	npm --prefix web run test

# Processing extent (ADR-0035): `make data tiles validate` builds the pilot exactly as before;
# `make data tiles validate EXTENT=city` builds the whole comune. Per-extent paths are derived in
# milano_iso/extent.py. For any extent other than the pilot each step is run through the measuring
# wrapper (wall time, peak memory -> reports/artifacts/T-6.1/measurements.json); MEASURE=1 forces it.
EXTENT ?= pilot
MEASURE ?= $(if $(filter-out pilot,$(EXTENT)),1,)
# $(call M,<step name>): the wrapper arguments, empty when not measuring.
M = $(if $(MEASURE),-m milano_iso.measure --step $(1) --extent $(EXTENT) --)
# $(call ART,<pilot artefact dir name>): where a step writes its report artefacts.
ART = reports/artifacts/$(if $(filter-out pilot,$(EXTENT)),T-6.1/$(EXTENT)/)$(1)

# Pipeline steps register themselves in pipeline/mk/*.mk (ADR-0013).
DATA_STEPS :=
TILES_STEPS :=
-include $(sort $(wildcard pipeline/mk/*.mk))

data: $(DATA_STEPS)
	@echo "make data: done ($(DATA_STEPS))"

# Tile steps register themselves in pipeline/mk/*.mk via TILES_STEPS (ADR-0021).
tiles: $(TILES_STEPS)
	@echo "make tiles: done ($(TILES_STEPS))"
