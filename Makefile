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

data:
	@echo "make data: not implemented yet (Phase 1/2)"

tiles:
	@echo "make tiles: not implemented yet (Phase 1/2)"
