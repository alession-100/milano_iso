# T-1.3: normalise OSM and DBT into data/processed/pilot.gpkg (EPSG:32632). Runs after the
# extract steps (ADR-0013).
.PHONY: data-normalise
DATA_STEPS += data-normalise

data-normalise: data-boundary data-osm data-dbt
	uv run python -m milano_iso.normalise --extent pilot
