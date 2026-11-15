# T-1.4: heights, OSM/DBT merge, render_volumes and buildings layers in processed/pilot.gpkg.
# Runs after data-normalise (ADR-0013).
.PHONY: data-heights
DATA_STEPS += data-heights

data-heights: data-normalise
	uv run python -m milano_iso.heights --extent pilot
