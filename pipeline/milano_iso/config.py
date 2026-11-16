"""Frozen project constants."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Data root (ADR-0013). Override with MILANO_ISO_DATA so that worktrees can share one
# download cache. Layout: raw/<source>/, interim/, processed/.
DATA_DIR = Path(os.environ.get("MILANO_ISO_DATA", REPO_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"

# Map origin (ADR-0004), EPSG:32632 metres: the centroid of OSM relation/18017026
# (Duomo di Milano, wikidata=Q18068), rounded to whole metres. Overpass
# timestamp_osm_base 2026-11-15T19:00:21Z. Produced by
# pipeline/scripts/origin_from_sources.py (see docs/DATA_SOURCES.md).
ORIGIN_E = 514979
ORIGIN_N = 5034536

AOI_HALF_SIZE_M = 500

# Tile edge length in metres (ADR-0023, amends ADR-0021). The only definition; grid, export and
# manifest read it from here.
TILE_SIZE_M = 250

# Pilot AOI (xmin, ymin, xmax, ymax), EPSG:32632.
PILOT_AOI_BBOX = (
    ORIGIN_E - AOI_HALF_SIZE_M,
    ORIGIN_N - AOI_HALF_SIZE_M,
    ORIGIN_E + AOI_HALF_SIZE_M,
    ORIGIN_N + AOI_HALF_SIZE_M,
)
