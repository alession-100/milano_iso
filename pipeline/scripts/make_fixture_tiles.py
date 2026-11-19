"""Build the synthetic e2e fixture tileset (T-3.2) through the real exporter.

Run: ``uv run python pipeline/scripts/make_fixture_tiles.py [--out web/e2e/fixtures/tiles]``

A tiny processed GeoPackage (invented geometry, NOT real Milan data) is written to a temp
directory and ``milano_iso.tiles.export.build`` is run on it, so the output has exactly the format
of the real tiles. Everything is deterministic: fixed coordinates, no randomness, no timestamps.

Layout (local metres, x east, y north; tile size 250 m, so tiles 0_0, -1_0, 0_-1 and -1_-1):
  six buildings with known heights, one per colour group (residential, commercial, civic,
  industrial, other, landmark), one of them (B3) with a courtyard, a few roads (major, minor,
  pedestrian), one green
  area, plus one tiny water, landuse, road-area and rail feature so that every layer exists.

T-4.1 additions, produced by the real ``milano_iso.decor`` code from invented OSM-like rows:
  three mapped trees (one with a height tag), one tree_row, fill trees in the park, dashed centre
  lines on the residential and tertiary roads, and two crossings (a marked zebra on the tertiary
  road, one more on the residential road, plus an ``unmarked`` one that must be dropped).

T-4.2 addition: the landmark building (B6, ``fixture_landmark``) gets a small STYLISED detail spec
(``landmark_style.FIXTURE_SPEC``: a spire on its roof and a pinnacle row along its edge), built
by the real exporter into the ``landmark_details`` layer.

T-5.3a addition: names for the search index (invented, fixture only). Roads 3001 and 3003 are two
ways of one street ("Via Fixture"), the green area 2001 is "Parco Fixture", the landmark gets the
name in ``FIXTURE_LANDMARK_NAMES`` and the water area stays unnamed. Names live in a
``named_features`` layer, as in the real processed data; they are not written to the tile feature
tables, so the .glb and feature .json files are unchanged.
"""

import argparse
import sys
import tempfile
from pathlib import Path

import geopandas as gpd
import pyogrio
from milano_iso import config, decor, landmark_style
from milano_iso.normalise import DropLog
from milano_iso.tiles import export
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box

FIXTURE_LANDMARK_NAMES = {"fixture_landmark": "Fixture Landmark"}
FIXTURE_NAMES = [
    ("w", 3001, "Via Fixture"),
    ("w", 3003, "Via Fixture"),
    ("w", 2001, "Parco Fixture"),
]
DEFAULT_OUT = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles"
# T-6.2: the same fixture with its coarse levels (e2e of level selection); the plain fixture above
# has none, so the visual baselines never meet a coarse level.
DEFAULT_LOD_OUT = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles-lod"
CRS = "EPSG:32632"

# key, local (xmin, ymin, xmax, ymax) in metres, height in metres, courtyard hole or None,
# OSM building value, landmark_id. One building per palette colour group (T-3.7): B1 residential,
# B2 commercial/office, B3 civic/religious, B4 industrial, B5 other, B6 landmark accent.
BUILDINGS = [
    ("B1", (20, 20, 60, 50), 10.0, None, "apartments", None),
    ("B2", (-80, 30, -40, 70), 15.0, None, "office", None),
    ("B3", (40, -120, 120, -40), 20.0, (65, -95, 95, -65), "church", None),  # courtyard
    ("B4", (-90, -75, -55, -40), 30.0, None, "warehouse", None),
    ("B5", (-45, -85, -15, -55), 12.0, None, "yes", None),
    ("B6", (-35, 35, -10, 60), 8.0, None, "yes", "fixture_landmark"),
]


def _utm(g):
    return affinity.translate(g, xoff=config.ORIGIN_E, yoff=config.ORIGIN_N)


def _frame(rows, cols):
    return gpd.GeoDataFrame(
        {c: [r[i] for r in rows] for i, c in enumerate(cols[:-1])},
        geometry=[_utm(r[-1]) for r in rows],
        crs=CRS,
    )


def _building_polygon(bb, hole):
    shell = box(*bb)
    if hole is None:
        return shell
    return Polygon(shell.exterior.coords, [box(*hole).exterior.coords])


# Invented OSM-like rows (osm_type, osm_id, tags, local geometry) for the T-4.1 layers.
OSM_POINTS = [
    ("n", 5001, {"natural": "tree"}, Point(80, 20)),
    ("n", 5002, {"natural": "tree", "height": "12"}, Point(90, 30)),
    ("n", 5003, {"natural": "tree"}, Point(-120, 120)),
]
OSM_LINES = [
    ("w", 6001, {"natural": "tree_row"}, LineString([(-180, -110), (-100, -110)])),
    ("w", 4001, {"highway": "footway", "footway": "crossing", "crossing": "zebra"}, None),
    ("w", 4002, {"highway": "footway", "footway": "crossing", "crossing": "marked"}, None),
    ("w", 4003, {"highway": "footway", "footway": "crossing", "crossing": "unmarked"}, None),
]


def _decor_layers(layers: dict) -> dict:
    """``trees`` and ``markings`` from the real decor code, on the fixture's own layers."""
    road_geom = {r.osm_id: r.geometry for r in layers["roads"].itertuples()}

    def frame(rows):
        return gpd.GeoDataFrame(
            {
                "osm_type": [r[0] for r in rows],
                "osm_id": [r[1] for r in rows],
                "tags": [r[2] for r in rows],
            },
            geometry=[road_geom[r[1]] if r[3] is None else _utm(r[3]) for r in rows],
            crs=CRS,
        )

    osm = {"points": frame(OSM_POINTS), "lines": frame(OSM_LINES)}
    res = decor.build_layers(osm, layers, config.PILOT_AOI_BBOX, DropLog())
    return {"trees": res["trees"], "markings": res["markings"]}


def write_gpkg(path: Path) -> None:
    b_rows, v_rows = [], []
    for n, (key, bb, h, hole, btype, lm) in enumerate(BUILDINGS, start=1):
        poly = _building_polygon(bb, hole)
        b_rows.append(
            (
                f"fix:{key}",
                "fixture",
                h,
                "fixture",
                "w",
                1000 + n,
                f"Fixture {key}",
                btype,
                lm,
                False,
                1,
                True,
                None,
                poly,
            )
        )
        v_rows.append(
            (
                f"fix:{key}:v1",
                f"fix:{key}",
                "fixture",
                0.0,
                h,
                h,
                "fixture",
                None,
                None,
                True,
                None,
                poly,
            )
        )
    b_cols = [
        "building_key", "source", "height_m", "height_source", "osm_type", "osm_id", "name",
        "building_type", "landmark_id", "landmark_primary", "n_volumes", "rendered",
        "render_reason", "geometry",
    ]  # fmt: skip
    v_cols = [
        "vol_key", "building_key", "source", "bottom_m", "top_m", "height_m", "height_source",
        "ground_flag", "ground_neighbours", "rendered", "render_reason", "geometry",
    ]  # fmt: skip
    layers = {
        "buildings": _frame(b_rows, b_cols),
        "render_volumes": _frame(v_rows, v_cols),
    }
    flat_cols = ["osm_type", "osm_id", "kind", "underground", "geometry"]
    class_cols = ["osm_type", "osm_id", "class", "underground", "geometry"]
    layers["green"] = _frame([("w", 2001, "park", False, box(-200, 80, -90, 190))], flat_cols)
    layers["landuse"] = _frame(
        [("w", 2002, "residential", False, box(100, -230, 200, -140))], flat_cols
    )
    layers["water"] = _frame([("w", 2003, "basin", False, box(-230, -60, -190, -20))], flat_cols)
    layers["road_areas"] = _frame(
        [("w", 2004, "pedestrian", False, box(70, 60, 130, 100))], class_cols
    )
    layers["rail"] = _frame(
        [("w", 2005, "tram", False, LineString([(-240, -240), (240, -230)]))], class_cols
    )
    roads_cols = ["osm_type", "osm_id", "class", "width_raw", "underground", "geometry"]
    layers["roads"] = _frame(
        [
            ("w", 3001, "residential", None, False, LineString([(-240, 0), (240, 0)])),
            ("w", 3002, "tertiary", None, False, LineString([(0, -240), (0, 240)])),
            ("w", 3003, "service", "5", False, LineString([(-100, -150), (100, -150)])),
            ("w", 3004, "footway", None, False, LineString([(-75, -25), (75, -5)])),
            ("w", 4001, "footway", None, False, LineString([(-4.5, 100), (4.5, 100)])),
            ("w", 4002, "footway", None, False, LineString([(-120, -4), (-120, 4)])),
            ("w", 4003, "footway", None, False, LineString([(120, 3.5), (120, -3.5)])),
        ],
        roads_cols,
    )
    layers.update(_decor_layers(layers))
    centroid_of = {
        (r.osm_type, r.osm_id): r.geometry.representative_point()
        for name in ("roads", "green")
        for r in layers[name].itertuples()
    }
    layers["named_features"] = gpd.GeoDataFrame(
        {
            "osm_type": [n[0] for n in FIXTURE_NAMES],
            "osm_id": [n[1] for n in FIXTURE_NAMES],
            "name": [n[2] for n in FIXTURE_NAMES],
            "name_en": [None for _ in FIXTURE_NAMES],
            "category": ["fixture" for _ in FIXTURE_NAMES],
        },
        geometry=[centroid_of[(n[0], n[1])] for n in FIXTURE_NAMES],
        crs=CRS,
    )
    for name, gdf in layers.items():
        pyogrio.write_dataframe(gdf, path, layer=name, driver="GPKG")


def build(out_dir: Path, specs: dict | None = None, levels: tuple | None = ()) -> None:
    """Run the real exporter on the synthetic layers. ``specs`` are the landmark detail specs
    (T-4.2): by default the fixture landmark's own small spec; ``{}`` builds without details.
    ``levels``: the coarse levels (T-6.2); ``()`` (default) writes the base tiles only, ``None`` the
    levels of ``milano_iso.tiles.lod.LEVELS``."""
    if specs is None:
        specs = {landmark_style.FIXTURE_SPEC.landmark_id: landmark_style.FIXTURE_SPEC}
    with tempfile.TemporaryDirectory(prefix="milano_fixture_") as tmp:
        tmp_path = Path(tmp)
        proc = tmp_path / "processed"
        proc.mkdir()
        write_gpkg(proc / export.GPKG_NAME)
        saved = config.PROCESSED_DIR
        config.PROCESSED_DIR = proc  # export.build reads config.PROCESSED_DIR at call time
        try:
            export.build(
                "pilot",
                out_dir=out_dir,
                summary_dir=tmp_path / "summary",
                specs=specs,
                landmark_names=FIXTURE_LANDMARK_NAMES,
                levels=levels,
            )
        finally:
            config.PROCESSED_DIR = saved


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--lod", action="store_true", help="the fixture with coarse levels (T-6.2)")
    args = ap.parse_args(argv)
    out = args.out or (DEFAULT_LOD_OUT if args.lod else DEFAULT_OUT)
    build(out, levels=None if args.lod else ())
    print(f"fixture tiles written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
