"""Stylised landmark details (T-4.2, ADR-0028 decision 1): declarative specs and style constants.

EVERYTHING IN THIS MODULE IS STYLE, NOT DATA. No size, count, spacing, rise or inset below is a
measurement or a real-world figure, and none must be presented as one. The only data the specs
use is looked up at build time by ``landmark_details.py`` from the landmark's own rendered DBT
volumes (their footprints and their ``top_m``), and, for the Galleria, from the OSM
``building=roof`` footprint (ADR-0016). A detail never changes a footprint or a height taken from
data (ADR-0028); it is added on top and flagged ``stylised: true`` in the tile feature table.

A spec is a tuple of ``Item``: *which volumes* (``Select``), *where on them* (``place``) and
*what primitive* to put there. Placement modes:

* ``centre``: at the pole of inaccessibility of each selected volume's exposed top, resting on the
  highest rendered volume of the landmark that covers that point.
* ``edge``: along the outer edge of the union of the selected volumes, inset by ``inset_m``,
  evenly spaced (``spacing_m``, or ``count`` points), resting on the highest covering volume.
* ``cap``: a roof over the part of each selected volume that no higher volume covers.
* ``roof``: a roof over an external footprint (the Galleria's OSM ``building=roof``).

``style_constants()`` lists every constant of this module with its status; the T-4.2 report
prints that table.
"""

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------------------------
# Tessellation (style): how fine the generated roofs are.
# ---------------------------------------------------------------------------------------------
CAP_GRID_M = 2.0  # spacing of the interior points of a roof cap (style)
VAULT_GRID_M = 2.5  # spacing of the interior points of the Galleria vault (style)
BOUNDARY_STEP_M = 2.5  # roof boundaries are densified to at most this spacing (style)
MIN_CAP_AREA_M2 = 4.0  # an exposed roof part smaller than this gets no cap (style)
POSITION_TOLERANCE_M = 2.0  # a detail must lie within the landmark footprint buffered by this (style; card says <= 2 m)

# ---------------------------------------------------------------------------------------------
# Edge rows (style)
# ---------------------------------------------------------------------------------------------
EDGE_INSET_M = 0.6  # edge rows sit this far inside the outer edge of the volumes (style)

# ---------------------------------------------------------------------------------------------
# Duomo di Milano (style)
# ---------------------------------------------------------------------------------------------
DUOMO_MAIN_SPIRE_RADIUS_M = 1.6  # circumradius of the main spire's shaft (style)
DUOMO_MAIN_SPIRE_SHAFT_M = 3.0  # shaft height of the main spire (style)
DUOMO_MAIN_SPIRE_TIP_M = 9.0  # tip height of the main spire (style)
DUOMO_TURRET_RADIUS_M = 0.9  # circumradius of the turret spires (style)
DUOMO_TURRET_SHAFT_M = 2.0  # (style)
DUOMO_TURRET_TIP_M = 5.0  # (style)
DUOMO_TURRET_MAX_AREA_M2 = 25.0  # a DBT volume this small or smaller counts as a turret (style)
DUOMO_TURRET_MIN_TOP_FRAC = (
    0.35  # ... if its top is at least this fraction of the tallest top (style)
)
DUOMO_PINNACLE_RADIUS_M = 0.5  # (style)
DUOMO_PINNACLE_SHAFT_M = 2.0  # (style)
DUOMO_PINNACLE_TIP_M = 2.5  # (style)
DUOMO_PINNACLE_SPACING_M = 7.0  # spacing of the pinnacle row along the outer edge (style)

# ---------------------------------------------------------------------------------------------
# Torre Velasca (style)
# ---------------------------------------------------------------------------------------------
VELASCA_CROWN_MIN_TOP_FRAC = (
    0.85  # volumes whose top is >= this fraction of the tallest get the crown (style)
)
VELASCA_CROWN_MIN_AREA_M2 = 10.0  # ... and whose footprint is at least this large (style)
VELASCA_CROWN_RISE_M = 3.5  # height of the pitched crown above each volume top (style)

# ---------------------------------------------------------------------------------------------
# Galleria Vittorio Emanuele II (style)
# ---------------------------------------------------------------------------------------------
GALLERIA_EAVE_BUFFER_M = (
    1.0  # adjacent volumes = rendered volumes within this of the roof footprint (style)
)
GALLERIA_EAVE_MIN_OVERLAP_M2 = (
    10.0  # ... with at least this much area inside that buffer (style, ignores slivers)
)
GALLERIA_VAULT_RISE_FRAC = (
    0.6  # vault rise as a fraction of the half-span A/P of the roof footprint (style)
)

# ---------------------------------------------------------------------------------------------
# Out-of-pilot landmarks (style; placed and verified in Phase 6, ADR-0028 decision 2)
# ---------------------------------------------------------------------------------------------
SANSIRO_TOWER_RADIUS_M = 3.0  # (style)
SANSIRO_TOWER_SHAFT_M = 14.0  # (style)
SANSIRO_TOWER_TIP_M = 2.0  # (style)
SANSIRO_TOWER_COUNT = 8  # evenly spaced along the outer edge (style, not the real number of towers)
SANSIRO_EDGE_INSET_M = 4.0  # (style)
MAST_RADIUS_M = 0.5  # radius of the thin mast on a tower roof (style)
MAST_SHAFT_M = 10.0  # (style)
MAST_TIP_M = 4.0  # (style)
CROWN_RISE_M = 4.0  # rise of the low crown on a tower (style)
CROWN_MIN_AREA_M2 = 20.0  # (style)
PIRELLI_SLAB_THICKNESS_M = 2.5  # (style)
PIRELLI_SLAB_INSET_M = 0.0  # (style)
BOSCO_TREE_RADIUS_M = 1.2  # (style)
BOSCO_TREE_SHAFT_M = 1.0  # (style)
BOSCO_TREE_TIP_M = 3.5  # (style)
BOSCO_TREE_SPACING_M = 5.0  # (style)
CENTRALE_VAULT_RISE_FRAC = 0.5  # (style)
CENTRALE_VAULT_MIN_AREA_M2 = 500.0  # a volume at least this large gets the shed vault (style)
CASTELLO_SPIRE_RADIUS_M = 1.4  # (style)
CASTELLO_SPIRE_SHAFT_M = 4.0  # (style)
CASTELLO_SPIRE_TIP_M = 8.0  # (style)
CASTELLO_MERLON_RADIUS_M = 0.45  # (style)
CASTELLO_MERLON_SHAFT_M = 1.2  # (style)
CASTELLO_MERLON_TIP_M = 0.8  # (style)
CASTELLO_MERLON_SPACING_M = 4.0  # (style)

# ---------------------------------------------------------------------------------------------
# Fixture landmark (style; the synthetic e2e fixture, not a real landmark)
# ---------------------------------------------------------------------------------------------
FIXTURE_SPIRE_RADIUS_M = 1.4  # (style)
FIXTURE_SPIRE_SHAFT_M = 2.0  # (style)
FIXTURE_SPIRE_TIP_M = 6.0  # (style)
FIXTURE_PINNACLE_RADIUS_M = 0.6  # (style)
FIXTURE_PINNACLE_SHAFT_M = 1.5  # (style)
FIXTURE_PINNACLE_TIP_M = 2.0  # (style)
FIXTURE_PINNACLE_SPACING_M = 6.0  # (style)


# ---------------------------------------------------------------------------------------------
# Spec language
# ---------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Prism:
    """A prism shaft of ``sides`` sides topped by a pyramid tip, on a point (all style)."""

    kind: str
    sides: int
    radius_m: float
    shaft_m: float
    tip_m: float


@dataclass(frozen=True)
class HipCap:
    """A pitched (hip) roof over a polygon: height grows linearly with the distance to the edge."""

    kind: str
    rise_m: float


@dataclass(frozen=True)
class SlabCap:
    """A flat slab on a polygon, inset by ``inset_m``."""

    kind: str
    thickness_m: float
    inset_m: float


@dataclass(frozen=True)
class VaultCap:
    """A barrel/arch vault over a polygon: rise = rise_frac * (A / P) of the polygon (style)."""

    kind: str
    rise_frac: float


Primitive = Prism | HipCap | SlabCap | VaultCap


@dataclass(frozen=True)
class Select:
    """Which of the landmark's rendered volumes an item applies to (all criteria are ANDed)."""

    min_top_frac: float = 0.0  # top_m >= this fraction of the landmark's tallest top_m
    min_area_m2: float = 0.0
    max_area_m2: float = float("inf")
    tallest_only: bool = False  # only the volume with the greatest top_m
    skip_tallest: bool = False  # all but the volume with the greatest top_m


@dataclass(frozen=True)
class Item:
    select: Select
    place: str  # "centre" | "edge" | "cap" | "roof"
    primitive: Primitive
    spacing_m: float | None = None  # edge: distance between details
    count: int | None = None  # edge: number of details (instead of spacing)
    inset_m: float = EDGE_INSET_M  # edge: inset from the outer edge


@dataclass(frozen=True)
class RoofSource:
    """The Galleria case: a rendered-nowhere OSM footprint that the vault covers (ADR-0016)."""

    osm_type: str  # "w" | "r"
    osm_id: int
    eave_buffer_m: float = GALLERIA_EAVE_BUFFER_M
    eave_min_overlap_m2: float = GALLERIA_EAVE_MIN_OVERLAP_M2


@dataclass(frozen=True)
class LandmarkSpec:
    landmark_id: str
    in_pilot: bool
    items: tuple[Item, ...]
    roof: RoofSource | None = None
    notes: str = field(default="", compare=False)


_ALL = Select()
_TALLEST = Select(tallest_only=True)

SPECS: dict[str, LandmarkSpec] = {}


def _add(spec: LandmarkSpec) -> None:
    SPECS[spec.landmark_id] = spec


_add(
    LandmarkSpec(
        "duomo",
        True,
        (
            Item(
                _TALLEST,
                "centre",
                Prism(
                    "spire",
                    4,
                    DUOMO_MAIN_SPIRE_RADIUS_M,
                    DUOMO_MAIN_SPIRE_SHAFT_M,
                    DUOMO_MAIN_SPIRE_TIP_M,
                ),
            ),
            Item(
                Select(
                    min_top_frac=DUOMO_TURRET_MIN_TOP_FRAC,
                    max_area_m2=DUOMO_TURRET_MAX_AREA_M2,
                    skip_tallest=True,
                ),
                "centre",
                Prism("spire", 4, DUOMO_TURRET_RADIUS_M, DUOMO_TURRET_SHAFT_M, DUOMO_TURRET_TIP_M),
            ),
            Item(
                _ALL,
                "edge",
                Prism(
                    "pinnacle",
                    4,
                    DUOMO_PINNACLE_RADIUS_M,
                    DUOMO_PINNACLE_SHAFT_M,
                    DUOMO_PINNACLE_TIP_M,
                ),
                spacing_m=DUOMO_PINNACLE_SPACING_M,
            ),
        ),
        notes="Spires on the tallest and on the slender tall DBT volumes; pinnacle row on the "
        "outer edge of the rendered massing.",
    )
)

_add(
    LandmarkSpec(
        "torre_velasca",
        True,
        (
            Item(
                Select(
                    min_top_frac=VELASCA_CROWN_MIN_TOP_FRAC, min_area_m2=VELASCA_CROWN_MIN_AREA_M2
                ),
                "cap",
                HipCap("crown", VELASCA_CROWN_RISE_M),
            ),
        ),
        notes="Pitched crown over the exposed tops of the highest DBT volumes.",
    )
)

_add(
    LandmarkSpec(
        "galleria_vittorio_emanuele_ii",
        True,
        (Item(_ALL, "roof", VaultCap("roof_vault", GALLERIA_VAULT_RISE_FRAC)),),
        roof=RoofSource("w", 166623705),
        notes="Glass vault over the OSM building=roof footprint (not rendered, ADR-0016). Base "
        "height = the lowest top_m of the adjacent rendered DBT volumes (the eave).",
    )
)

# Out-of-pilot landmarks: specs only; placed and verified in Phase 6 (ADR-0028 decision 2).
_add(
    LandmarkSpec(
        "stadio_meazza",
        False,
        (
            Item(
                _ALL,
                "edge",
                Prism(
                    "tower",
                    8,
                    SANSIRO_TOWER_RADIUS_M,
                    SANSIRO_TOWER_SHAFT_M,
                    SANSIRO_TOWER_TIP_M,
                ),
                count=SANSIRO_TOWER_COUNT,
                inset_m=SANSIRO_EDGE_INSET_M,
            ),
        ),
    )
)
for _lid in ("citylife_allianz", "citylife_pwc"):
    _add(
        LandmarkSpec(
            _lid,
            False,
            (
                Item(
                    _TALLEST,
                    "centre",
                    Prism("mast", 4, MAST_RADIUS_M, MAST_SHAFT_M, MAST_TIP_M),
                ),
            ),
        )
    )
_add(
    LandmarkSpec(
        "citylife_generali",
        False,
        (
            Item(
                Select(min_top_frac=0.9, min_area_m2=CROWN_MIN_AREA_M2),
                "cap",
                HipCap("crown", CROWN_RISE_M),
            ),
        ),
    )
)
for _lid in ("bosco_verticale_torre_confalonieri", "bosco_verticale_torre_de_castillia"):
    _add(
        LandmarkSpec(
            _lid,
            False,
            (
                Item(
                    Select(min_top_frac=0.9),
                    "edge",
                    Prism(
                        "rooftop_tree", 6, BOSCO_TREE_RADIUS_M, BOSCO_TREE_SHAFT_M, BOSCO_TREE_TIP_M
                    ),
                    spacing_m=BOSCO_TREE_SPACING_M,
                ),
            ),
        )
    )
_add(
    LandmarkSpec(
        "grattacielo_pirelli",
        False,
        (
            Item(
                Select(min_top_frac=0.9),
                "cap",
                SlabCap("roof_slab", PIRELLI_SLAB_THICKNESS_M, PIRELLI_SLAB_INSET_M),
            ),
        ),
    )
)
_add(
    LandmarkSpec(
        "stazione_centrale",
        False,
        (
            Item(
                Select(min_area_m2=CENTRALE_VAULT_MIN_AREA_M2),
                "cap",
                VaultCap("shed_vault", CENTRALE_VAULT_RISE_FRAC),
            ),
        ),
    )
)
_add(
    LandmarkSpec(
        "castello_sforzesco",
        False,
        (
            Item(
                _TALLEST,
                "centre",
                Prism(
                    "spire",
                    4,
                    CASTELLO_SPIRE_RADIUS_M,
                    CASTELLO_SPIRE_SHAFT_M,
                    CASTELLO_SPIRE_TIP_M,
                ),
            ),
            Item(
                _ALL,
                "edge",
                Prism(
                    "merlon",
                    4,
                    CASTELLO_MERLON_RADIUS_M,
                    CASTELLO_MERLON_SHAFT_M,
                    CASTELLO_MERLON_TIP_M,
                ),
                spacing_m=CASTELLO_MERLON_SPACING_M,
            ),
        ),
    )
)

# The synthetic fixture landmark's spec (used only by pipeline/scripts/make_fixture_tiles.py).
FIXTURE_SPEC = LandmarkSpec(
    "fixture_landmark",
    True,
    (
        Item(
            _TALLEST,
            "centre",
            Prism("spire", 4, FIXTURE_SPIRE_RADIUS_M, FIXTURE_SPIRE_SHAFT_M, FIXTURE_SPIRE_TIP_M),
        ),
        Item(
            _ALL,
            "edge",
            Prism(
                "pinnacle",
                4,
                FIXTURE_PINNACLE_RADIUS_M,
                FIXTURE_PINNACLE_SHAFT_M,
                FIXTURE_PINNACLE_TIP_M,
            ),
            spacing_m=FIXTURE_PINNACLE_SPACING_M,
        ),
    ),
)

# Every constant of this module is a style constant. None is sourced from data or a URL.
STYLE_ONLY_CONSTANT_PREFIXES = ()


def style_constants() -> list[tuple[str, object, str]]:
    """(name, value, status) of every module-level constant, in file order."""
    out = []
    for name, value in globals().items():
        if name.isupper() and isinstance(value, int | float) and not name.startswith("_"):
            out.append((name, value, "style (no source; not a real-world figure)"))
    return out
