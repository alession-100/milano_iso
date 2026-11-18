"""Extract every OSM object intersecting an extent into one GeoPackage (T-1.1, ADR-0013).

Usage: ``python -m milano_iso.osm_extract --extent pilot|city``

Objects are kept whole (never cut at the extent edge). Layers ``points``, ``lines``, ``areas``
in EPSG:4326; columns ``osm_type`` (n/w/r), ``osm_id``, ``area_from`` (areas only), ``tags``
(JSON, sorted keys) and geometry. Rows are sorted by (osm_type, osm_id).
"""

import argparse
import hashlib
import json
import logging
from pathlib import Path

import geopandas as gpd
import osmium
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import box

from milano_iso import config, fetch
from milano_iso import extent as extent_mod
from milano_iso.measure import report_counts

log = logging.getLogger("milano_iso.osm_extract")

LAYERS = ("points", "lines", "areas")
AREA_RELATION_TYPES = ("multipolygon", "boundary")
EDGE_POINTS = 12  # vertices per edge when densifying the pilot box (spec: at least 10)


def pilot_extent_wgs84():
    """PILOT_AOI_BBOX (EPSG:32632), densified, transformed to EPSG:4326."""
    x0, y0, x1, y1 = config.PILOT_AOI_BBOX
    dense = shapely.segmentize(box(x0, y0, x1, y1), max(x1 - x0, y1 - y0) / (EDGE_POINTS - 1))
    t = Transformer.from_crs(32632, 4326, always_xy=True)
    xs, ys = t.transform(*shapely.get_coordinates(dense).T)
    return shapely.polygons(list(zip(xs, ys, strict=True)))


def city_extent_wgs84():
    """Comune di Milano boundary (downloaded by ``fetch comune_boundary``) in EPSG:4326."""
    path = config.RAW_DIR / "comune_boundary" / fetch.BOUNDARY_FILE
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    return gdf.to_crs(4326).geometry.union_all()


def _wkb(g):
    return shapely.from_wkb(bytes.fromhex(g) if isinstance(g, str) else bytes(g))


class _Collector(osmium.SimpleHandler):
    def __init__(self, extent):
        super().__init__()
        self.extent = extent
        shapely.prepare(extent)
        self.fac = osmium.geom.WKBFactory()
        self.rows = {name: [] for name in LAYERS}
        self.seen = {"nodes": 0, "ways": 0, "relations": 0, "areas": 0}
        self.way_lines = []  # candidate lines, dropped if osmium also made an area of the way
        self.area_ways = set()
        self.mp_relations = set()
        self.area_relations = set()
        self.failed_geometry = []

    def _hit(self, geom):
        return self.extent.intersects(geom)

    def node(self, n):
        self.seen["nodes"] += 1
        if not n.tags or not n.location.valid():
            return
        pt = shapely.Point(n.location.lon, n.location.lat)
        if self._hit(pt):
            self.rows["points"].append(("n", n.id, None, _tags(n.tags), pt))

    def way(self, w):
        self.seen["ways"] += 1
        if not w.tags or len(w.nodes) < 2:
            return
        try:
            geom = _wkb(self.fac.create_linestring(w))
        except (osmium.InvalidLocationError, RuntimeError, ValueError):
            self.failed_geometry.append(("w", w.id))
            return
        if self._hit(geom):
            self.way_lines.append(("w", w.id, None, _tags(w.tags), geom))

    def relation(self, r):
        self.seen["relations"] += 1
        if r.tags.get("type") in AREA_RELATION_TYPES:
            self.mp_relations.add(r.id)

    def area(self, a):
        self.seen["areas"] += 1
        from_way = a.from_way()
        if from_way:
            self.area_ways.add(a.orig_id())
        elif a.num_rings() == (0, 0):
            return  # osmium emits an empty area when assembly fails: counted as failed below
        else:
            self.area_relations.add(a.orig_id())
        if not a.tags:
            return
        try:
            geom = _wkb(self.fac.create_multipolygon(a))
        except (osmium.InvalidLocationError, RuntimeError, ValueError):
            self.failed_geometry.append(("w" if from_way else "r", a.orig_id()))
            return
        if self._hit(geom):
            self.rows["areas"].append(
                (
                    "w" if from_way else "r",
                    a.orig_id(),
                    "way" if from_way else "relation",
                    _tags(a.tags),
                    geom,
                )
            )


def _tags(tags):
    return json.dumps({t.k: t.v for t in tags}, sort_keys=True, ensure_ascii=False)


def _frame(rows, with_area_from):
    rows = sorted(rows, key=lambda r: (r[0], r[1]))
    df = pd.DataFrame(rows, columns=["osm_type", "osm_id", "area_from", "tags", "geometry"])
    if not with_area_from:
        df = df.drop(columns="area_from")
    df["osm_id"] = df["osm_id"].astype("int64")
    return gpd.GeoDataFrame(df, geometry="geometry", crs=4326)


def extract(pbf: Path, extent, out: Path) -> dict:
    """Extract objects of ``pbf`` intersecting ``extent`` (EPSG:4326) into ``out``."""
    h = _Collector(extent)
    h.apply_file(str(pbf), locations=True)

    lines = [r for r in h.way_lines if r[1] not in h.area_ways]
    failed_relations = sorted(h.mp_relations - h.area_relations)
    frames = {
        "points": _frame(h.rows["points"], False),
        "lines": _frame(lines, False),
        "areas": _frame(h.rows["areas"], True),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    for name in LAYERS:
        frames[name].to_file(out, layer=name, driver="GPKG", engine="pyogrio")

    summary = {
        "pbf": pbf.name,
        "output": out.name,
        "seen": h.seen,
        "kept": {name: len(frames[name]) for name in LAYERS},
        "failed_area_assembly": {
            "count": len(failed_relations),
            "relation_ids": failed_relations,
            "note": (
                "multipolygon/boundary relations seen in the PBF for which osmium produced no "
                "area (incomplete members or invalid rings); extent not applied to these"
            ),
        },
        "failed_geometry": {
            "count": len(h.failed_geometry),
            "objects": [f"{t}{i}" for t, i in sorted(h.failed_geometry)],
        },
        "canonical_sha256": canonical_sha256(out),
    }
    return summary


def canonical_sha256(gpkg: Path) -> str:
    """sha256 of the rows as sorted JSON; stable even if the GeoPackage bytes are not."""
    h = hashlib.sha256()
    for name in LAYERS:
        gdf = gpd.read_file(gpkg, layer=name, engine="pyogrio")
        recs = [
            [r.osm_type, int(r.osm_id), getattr(r, "area_from", None), r.tags, r.geometry.wkb_hex]
            for r in gdf.itertuples()
        ]
        recs.sort(key=lambda r: (r[0], r[1]))
        h.update(json.dumps([name, recs], sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return h.hexdigest()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--extent", choices=["pilot", "city"], required=True)
    p.add_argument("--summary", type=Path, help="write the summary JSON here")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    manifest = fetch.fetch_osm()
    pbf = config.RAW_DIR / manifest["file"]
    if args.extent == "pilot":
        extent = pilot_extent_wgs84()
    else:
        fetch.fetch_boundary()
        extent = city_extent_wgs84()
    out = extent_mod.interim_osm(args.extent)
    summary = extract(pbf, extent, out)
    summary["extent"] = args.extent
    summary["pbf_sha256"] = manifest["sha256"]
    text = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(text, encoding="utf-8", newline="\n")
    log.info(
        "kept %s; failed relations %d", summary["kept"], summary["failed_area_assembly"]["count"]
    )
    report_counts(**{"in": sum(summary["seen"].values()), "out": sum(summary["kept"].values())})
    log.info("canonical_sha256 %s", summary["canonical_sha256"])
    log.info("gpkg_sha256 %s", hashlib.sha256(out.read_bytes()).hexdigest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
