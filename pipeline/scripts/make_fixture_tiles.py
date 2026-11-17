"""Build the synthetic e2e fixture tileset (T-3.2) through the real exporter.

Run: ``uv run python pipeline/scripts/make_fixture_tiles.py [--out web/e2e/fixtures/tiles]``

A tiny processed GeoPackage (invented geometry, NOT real Milan data) is written to a temp
directory and ``milano_iso.tiles.export.build`` is run on it, so the output has exactly the format
of the real tiles. Everything is deterministic: fixed coordinates, no randomness, no timestamps.

Layout (local metres, x east, y north; tile size 250 m, so tiles 0_0, -1_0, 0_-1 and -1_-1):
  six buildings with known heights, one of them (B3) with a courtyard, a few roads, one green
  area, plus one tiny water, landuse, road-area and rail feature so that every layer exists.
"""

import argparse
import sys
import tempfile
from pathlib import Path

import geopandas as gpd
import pyogrio
from milano_iso import config
from milano_iso.tiles import export
from shapely import affinity
from shapely.geometry import LineString, Polygon, box

DEFAULT_OUT = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles"
CRS = "EPSG:32632"

# key, local (xmin, ymin, xmax, ymax) in metres, height in metres, courtyard hole or None.
BUILDINGS = [
    ("B1", (20, 20, 60, 50), 10.0, None),
    ("B2", (-80, 30, -40, 70), 15.0, None),
    ("B3", (40, -120, 120, -40), 20.0, (65, -95, 95, -65)),  # courtyard
    ("B4", (-120, -90, -70, -40), 30.0, None),
    ("B5", (-60, -200, -20, -160), 12.0, None),
    ("B6", (150, 120, 190, 160), 8.0, None),
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


def write_gpkg(path: Path) -> None:
    b_rows, v_rows = [], []
    for n, (key, bb, h, hole) in enumerate(BUILDINGS, start=1):
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
                "yes",
                None,
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
        ],
        roads_cols,
    )
    for name, gdf in layers.items():
        pyogrio.write_dataframe(gdf, path, layer=name, driver="GPKG")


def build(out_dir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="milano_fixture_") as tmp:
        tmp_path = Path(tmp)
        proc = tmp_path / "processed"
        proc.mkdir()
        write_gpkg(proc / export.GPKG_NAME)
        saved = config.PROCESSED_DIR
        config.PROCESSED_DIR = proc  # export.build reads config.PROCESSED_DIR at call time
        try:
            export.build("pilot", out_dir=out_dir, summary_dir=tmp_path / "summary")
        finally:
            config.PROCESSED_DIR = saved


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    build(args.out)
    print(f"fixture tiles written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
