"""OSM tag classification rules (T-1.3), as data.

``RULES`` is the only place that decides which layer an OSM object belongs to. An object can
belong to several layers (a building that also has ``name`` is in ``osm_buildings`` and in
``named_features``) or to none. ``classify`` interprets the table; nothing else in the pipeline
looks at tag values to choose a layer.

Rule fields (all optional except ``layer``, ``kinds``, ``key``):

- ``kinds``: geometry kinds the rule applies to, from ``point``, ``line``, ``area``.
- ``key``: tag that must be present.
- ``values``: if given, the tag value must be one of these.
- ``not_values``: the tag value must not be one of these.
- ``when``: extra tags that must have one of the listed values.
- ``unless``: extra tags that must NOT have one of the listed values.
- ``kind``: how the ``kind`` of the assignment is derived: ``"value"`` (the matched tag value),
  or a literal string. The first matching rule of a layer decides the kind.
"""

from dataclasses import dataclass

POINT, LINE, AREA = "point", "line", "area"
ALL_KINDS = (POINT, LINE, AREA)

LAYERS = (
    "osm_buildings",
    "osm_building_parts",
    "roads",
    "road_areas",
    "rail",
    "water",
    "green",
    "landuse",
    "named_features",
)

RAIL_CLASSES = ("rail", "light_rail", "subway", "tram", "narrow_gauge", "monorail")

# Normalised highway classes (the ``class`` column of ``roads`` and ``road_areas``).
# ``*_link`` values map to their base class. Values not listed map to "other".
HIGHWAY_CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "pedestrian",
    "footway",
    "steps",
    "path",
    "cycleway",
    "track",
    "platform",
    "traffic_island",
)

# Green areas: tag key -> values. Everything else with landuse=* goes to ``landuse``.
GREEN_VALUES = {
    "leisure": (
        "park",
        "garden",
        "playground",
        "pitch",
        "recreation_ground",
        "nature_reserve",
        "golf_course",
        "dog_park",
        "common",
    ),
    "landuse": (
        "grass",
        "forest",
        "meadow",
        "flowerbed",
        "orchard",
        "vineyard",
        "cemetery",
        "village_green",
        "recreation_ground",
        "allotments",
        "plant_nursery",
    ),
    "natural": ("wood", "scrub", "grassland", "heath"),
    "amenity": ("grave_yard",),
}


@dataclass(frozen=True)
class Rule:
    layer: str
    kinds: tuple
    key: str
    values: tuple | None = None
    not_values: tuple = ()
    when: tuple = ()  # ((key, (values...)), ...)
    unless: tuple = ()
    kind: str | None = None


def _green_rules():
    return [
        Rule("green", (AREA,), key, values=values, kind="value")
        for key, values in GREEN_VALUES.items()
    ]


RULES = [
    Rule("osm_buildings", (AREA,), "building", not_values=("no",), kind="value"),
    Rule("osm_building_parts", (AREA,), "building:part", not_values=("no",), kind="value"),
    # Highway lines. A closed highway way that is not area=yes arrives as an area from the
    # OSM extract (osmium assembles it); it becomes its boundary line in ``roads``.
    Rule("roads", (LINE,), "highway", kind="value"),
    Rule("roads", (AREA,), "highway", unless=(("area", ("yes",)),), kind="value"),
    Rule("road_areas", (AREA,), "area:highway", kind="value"),
    Rule("road_areas", (AREA,), "highway", when=(("area", ("yes",)),), kind="value"),
    Rule("rail", (LINE,), "railway", values=RAIL_CLASSES, kind="value"),
    # Water. The first matching rule gives the kind: water=* (lake, pond, ...) beats the
    # generic natural=water / waterway=riverbank.
    Rule("water", (AREA,), "water", kind="value"),
    Rule("water", (AREA,), "natural", values=("water",), kind="water"),
    Rule("water", (AREA,), "waterway", values=("riverbank",), kind="riverbank"),
    Rule("water", (LINE,), "waterway", kind="value"),
    *_green_rules(),
    Rule(
        "landuse",
        (AREA,),
        "landuse",
        not_values=GREEN_VALUES["landuse"],
        kind="value",
    ),
    Rule("named_features", ALL_KINDS, "name"),
]

# Order in which keys name a feature's category (``named_features.category``) and its
# "top tag key" in the unassigned report. First key present wins.
FEATURE_KEYS = (
    "building",
    "building:part",
    "highway",
    "area:highway",
    "railway",
    "waterway",
    "natural",
    "water",
    "landuse",
    "leisure",
    "amenity",
    "shop",
    "tourism",
    "historic",
    "man_made",
    "public_transport",
    "office",
    "place",
    "boundary",
    "barrier",
    "craft",
    "emergency",
    "power",
    "entrance",
)


def _match(rule: Rule, kind: str, tags: dict) -> str | None | bool:
    """False if the rule does not match, else the assignment kind (str or None)."""
    if kind not in rule.kinds or rule.key not in tags:
        return False
    value = tags[rule.key]
    if rule.values is not None and value not in rule.values:
        return False
    if value in rule.not_values:
        return False
    for k, vals in rule.when:
        if tags.get(k) not in vals:
            return False
    for k, vals in rule.unless:
        if tags.get(k) in vals:
            return False
    if rule.kind == "value":
        return value
    return rule.kind


def classify(kind: str, tags: dict) -> dict[str, str | None]:
    """Layers an object belongs to, as ``{layer: kind}``. Empty if it belongs to none."""
    out: dict[str, str | None] = {}
    for rule in RULES:
        if rule.layer in out:
            continue
        got = _match(rule, kind, tags)
        if got is not False:
            out[rule.layer] = got
    return out


def highway_class(value: str | None) -> str:
    """Normalised highway class: ``*_link`` -> base class, unknown -> ``other``."""
    if not value:
        return "other"
    base = value.removesuffix("_link")
    return base if base in HIGHWAY_CLASSES else "other"


def top_tag_key(tags: dict) -> str:
    """The key that best names an object: first of FEATURE_KEYS, else the first other key."""
    for k in FEATURE_KEYS:
        if k in tags:
            return k
    for k in sorted(tags):
        if k != "name" and not k.startswith(("addr:", "source", "check_date")):
            return k
    return "(none)"


def named_category(tags: dict) -> str:
    """``key=value`` of the first FEATURE_KEYS key present, else ``other``."""
    for k in FEATURE_KEYS:
        if k in tags:
            return f"{k}={tags[k]}"
    return "other"


def is_platform(tags: dict) -> bool:
    """True for a public-transport platform way (ADR-0033): any of the three OSM platform tags.

    ``footway=sidewalk`` ways that carry ``public_transport=platform`` are platforms too.
    """
    return (
        tags.get("public_transport") == "platform"
        or tags.get("highway") == "platform"
        or tags.get("railway") == "platform"
    )


def is_underground(tags: dict) -> bool:
    """tunnel=yes, location=underground, or a negative ``layer`` (all values negative)."""
    if tags.get("tunnel") == "yes" or tags.get("location") == "underground":
        return True
    raw = tags.get("layer")
    if raw is None:
        return False
    nums = []
    for part in str(raw).split(";"):
        try:
            nums.append(float(part))
        except ValueError:
            return False
    return bool(nums) and all(n < 0 for n in nums)
