"""Style constants for the tile export (T-2.2, ADR-0021).

STYLE CONSTANTS, NOT DATA. Nothing in this module is measured or taken from a source. The
widths and heights below are stylisation choices that make roads, rail and flat layers
readable in an isometric view. They must never be presented as surveyed values. An OSM
``width`` tag, where it parses, takes precedence over the class widths (see ``geom.py``).
"""

# Ribbon width in metres per OSM highway class (style, not data).
ROAD_WIDTH_M = {
    "cycleway": 2.0,
    "footway": 1.5,
    "path": 1.5,
    "pedestrian": 4.0,
    "platform": 3.0,
    "residential": 6.0,
    "service": 4.0,
    "steps": 1.5,
    "tertiary": 7.0,
    "unclassified": 6.0,
}

# Ribbon width in metres per OSM railway class (style, not data).
RAIL_WIDTH_M = {
    "subway": 2.5,
    "tram": 2.5,
}

# Largest OSM width tag (metres) accepted as plausible for a ribbon; larger or non-positive
# values fall back to the class width (style, not data).
MAX_TAG_WIDTH_M = 30.0

# Mitre limit for ribbon joins (style, not data).
MITRE_LIMIT = 2.0

# Y height in metres of each flat layer, ordered to avoid z-fighting, all below 0.3 m
# (style, not data). Buildings are not listed: they start at their own bottom_m.
LAYER_HEIGHT_M = {
    "landuse": 0.02,
    "green": 0.04,
    "water": 0.06,
    "road_areas": 0.08,
    "roads": 0.12,
    "rail": 0.16,
}
