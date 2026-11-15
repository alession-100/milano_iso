"""Frozen project constants."""

# Map origin (ADR-0004), EPSG:32632 metres: the centroid of OSM relation/18017026
# (Duomo di Milano, wikidata=Q18068), rounded to whole metres. Overpass
# timestamp_osm_base 2026-11-15T19:00:21Z. Produced by
# pipeline/scripts/origin_from_sources.py (see docs/DATA_SOURCES.md).
ORIGIN_E = 514979
ORIGIN_N = 5034536

AOI_HALF_SIZE_M = 500

# Pilot AOI (xmin, ymin, xmax, ymax), EPSG:32632.
PILOT_AOI_BBOX = (
    ORIGIN_E - AOI_HALF_SIZE_M,
    ORIGIN_N - AOI_HALF_SIZE_M,
    ORIGIN_E + AOI_HALF_SIZE_M,
    ORIGIN_N + AOI_HALF_SIZE_M,
)
