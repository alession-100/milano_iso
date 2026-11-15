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

# Pipeline steps register themselves in pipeline/mk/*.mk (ADR-0013).
DATA_STEPS :=
TILES_STEPS :=
-include $(sort $(wildcard pipeline/mk/*.mk))

data: $(DATA_STEPS)
	@echo "make data: done ($(DATA_STEPS))"

# Tile steps register themselves in pipeline/mk/*.mk via TILES_STEPS (ADR-0021).
tiles: $(TILES_STEPS)
	@echo "make tiles: done ($(TILES_STEPS))"
