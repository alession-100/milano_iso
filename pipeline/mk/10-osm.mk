# T-1.1: OSM snapshot + comune boundary (ADR-0013). Both steps are idempotent: they skip
# downloads whose sha256 matches pipeline/manifests/*.json.
.PHONY: data-osm data-boundary
DATA_STEPS += data-boundary data-osm

data-boundary:
	uv run python -m milano_iso.fetch comune_boundary

data-osm:
	uv run python $(call M,data-osm) -m milano_iso.osm_extract --extent $(EXTENT) --summary $(call ART,T-1.1)/summary.json
