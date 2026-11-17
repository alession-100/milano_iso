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
    "markings": 0.14,
    "rail": 0.16,
}

# --- T-4.1: trees and road markings. Every value below is STYLE, not data. ---

# Height (m) given to a tree that has no parseable OSM height tag (height_source=style_default).
TREE_DEFAULT_HEIGHT_M = 8.0
# Largest OSM height tag (m) accepted for a tree; larger or non-positive values are style_default.
TREE_MAX_HEIGHT_M = 60.0
# Spacing (m) of the trees placed along an OSM natural=tree_row line. The line is data; the
# positions of the trees on it are style.
TREE_ROW_SPACING_M = 7.0

# Decorative fill trees, only inside green areas of these kinds.
FILL_GREEN_KINDS = ("garden", "park")
FILL_SEED = 4101
FILL_SPACING_M = 12.0  # cell size of the jittered grid (about one tree per 144 m2)
FILL_JITTER_M = 3.5  # maximum offset (m) of a tree from its cell centre, per axis
FILL_EDGE_INSET_M = 1.5  # keep fill trees at least this far inside the green area
FILL_HEIGHT_JITTER = 0.25  # fill tree height = default * (1 +/- this), seeded
# Minimum clearance (m) of a fill tree from each of these things.
FILL_CLEARANCE_M = {
    "building": 2.0,
    "road": 1.0,  # from the edge of the drawn ribbon
    "road_area": 1.0,
    "water": 1.5,
    "tree": 4.0,  # mapped trees, OSM-mapped rows included
}

# Dashed centre lines: classes that get one (style), and the dash pattern (m).
CENTRE_LINE_CLASSES = ("primary", "residential", "secondary", "tertiary", "trunk", "unclassified")
CENTRE_DASH_M = 3.0
CENTRE_GAP_M = 4.5
CENTRE_WIDTH_M = 0.2
CENTRE_END_TRIM_M = 5.0  # no dashes this close to either end of a road way (junctions)

# Zebra crossings, drawn on OSM footway=crossing ways whose crossing=* is one of these.
ZEBRA_CROSSING_VALUES = ("marked", "traffic_signals", "uncontrolled", "zebra")
ZEBRA_STRIPE_WIDTH_M = 0.5  # along the crossing way
ZEBRA_STRIPE_PITCH_M = 1.0
ZEBRA_STRIPE_LENGTH_M = 3.0  # across the crossing way, i.e. along the road
ZEBRA_END_TRIM_M = 0.5
