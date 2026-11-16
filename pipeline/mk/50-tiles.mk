# T-2.2: tile mesh export (ADR-0021). Reads processed/pilot.gpkg; does not rebuild data.
.PHONY: tiles-export
TILES_STEPS += tiles-export

tiles-export:
	uv run python -m milano_iso.tiles.export --extent pilot

# T-2.3: build twice into scratch dirs, compare every file byte for byte (VERIFICATION section 3).
.PHONY: check-tiles-determinism
check-tiles-determinism:
	uv run python -m milano_iso.tiles.check_determinism
