# T-2.2: tile mesh export (ADR-0021). Reads processed/pilot.gpkg; does not rebuild data.
.PHONY: tiles-export
TILES_STEPS += tiles-export

tiles-export:
	uv run python -m milano_iso.tiles.export --extent pilot
