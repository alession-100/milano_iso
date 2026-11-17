"""Trees and road markings on the real processed pilot data (T-4.1).

Mapped trees are data (OSM); fill trees and every marking are style and must be flagged as such.
"""

import json
from collections import Counter

import pytest
import shapely
from milano_iso import config, decor, style
from milano_iso.normalise import DropLog
from milano_iso.tiles import grid

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
MAPPED_SOURCES = ("osm_tree", "osm_tree_row")


@pytest.fixture(scope="module")
def trees(layers):
    assert "trees" in layers, "no `trees` layer in the processed GeoPackage; run `make data`"
    return layers["trees"]


@pytest.fixture(scope="module")
def osm_tags():
    return decor.read_osm_tags(config.INTERIM_DIR / "osm_pilot.gpkg")


def test_tree_counts(trees, osm_tags, report):
    by_source = Counter(trees["source"])
    assert set(by_source) <= {"osm_tree", "osm_tree_row", "fill"}
    nodes = sum(t.get("natural") == "tree" for t in osm_tags["points"]["tags"])
    rows = sum(t.get("natural") == "tree_row" for t in osm_tags["lines"]["tags"])
    dropped = Counter()
    # Every OSM tree node is kept or dropped for a logged reason; none disappears silently.
    drop_log = DropLog()
    _, stats = decor.mapped_trees(osm_tags, shapely.box(*config.PILOT_AOI_BBOX), drop_log)
    dropped.update(r[4] for r in drop_log.rows if r[3] == "dropped")
    assert nodes == stats.get("tree_nodes_in_extract", 0)
    outside_nodes = sum(1 for r in drop_log.rows if r[4] == "outside_extent")
    outside_rows = sum(1 for r in drop_log.rows if r[4] == "tree_row_outside_extent")
    assert by_source["osm_tree"] == nodes - outside_nodes
    assert (by_source["osm_tree_row"] > 0) == (rows - outside_rows > 0)
    assert by_source["osm_tree"] > 0, "no OSM natural=tree in the pilot"
    assert by_source["fill"] > 0, "no fill trees"
    report.add(
        "Trees (T-4.1)",
        f"- OSM natural=tree nodes in the extract: {nodes}; natural=tree_row ways: {rows}\n"
        f"- trees by source: {dict(sorted(by_source.items()))}\n"
        f"- drops: {dict(sorted(dropped.items()))}\n"
        f"- stats: {json.dumps(stats, sort_keys=True)}",
    )


def test_mapped_trees_are_not_decorative_and_carry_osm_ids(trees):
    mapped = trees[trees["source"].isin(MAPPED_SOURCES)]
    assert not mapped["decorative"].any()
    assert mapped["osm_id"].notna().all() and mapped["osm_type"].notna().all()
    assert mapped["height_source"].isin(["osm_height", "style_default"]).all()
    assert (mapped["height_m"] > 0).all()


def test_every_fill_tree_is_decorative_style_default_without_osm_id(trees):
    fill = trees[trees["source"] == "fill"]
    assert len(fill) > 0
    assert fill["decorative"].all(), "a fill tree is not flagged decorative"
    assert fill["osm_id"].isna().all() and fill["osm_type"].isna().all()
    assert (fill["height_source"] == "style_default").all()
    assert (trees["decorative"] == (trees["source"] == "fill")).all()


def test_fill_trees_not_in_buildings_on_roads_or_water_and_inside_parks(trees, layers):
    fill = trees[trees["source"] == "fill"].geometry
    building_geoms = list(layers["buildings"].geometry)
    rv = layers["render_volumes"]
    building_geoms += list(rv[rv["rendered"].astype(bool)].geometry)
    bld_tree = shapely.STRtree(building_geoms)
    hits = bld_tree.query(list(fill), predicate="intersects")
    assert hits.shape[1] == 0, f"{hits.shape[1]} fill trees touch a building footprint"

    ribbons = decor.road_ribbons(layers["roads"].rename(columns={"class": "class_"}))
    road_tree = shapely.STRtree(ribbons)
    hits = road_tree.query(list(fill), predicate="intersects")
    assert hits.shape[1] == 0, f"{hits.shape[1]} fill trees stand on a road"

    for name in ("road_areas", "water"):
        t = shapely.STRtree(list(layers[name].geometry))
        assert t.query(list(fill), predicate="intersects").shape[1] == 0, name

    green = layers["green"]
    parks = shapely.union_all(list(green[green["kind"].isin(style.FILL_GREEN_KINDS)].geometry))
    assert shapely.contains(parks, list(fill)).all(), "a fill tree is outside park/garden areas"


def test_fill_keeps_its_clearance_from_buildings_and_mapped_trees(trees, layers):
    fill = list(trees[trees["source"] == "fill"].geometry)
    mapped = list(trees[trees["source"] != "fill"].geometry)
    c = style.FILL_CLEARANCE_M
    near = shapely.STRtree(list(layers["buildings"].geometry)).query(
        fill, predicate="dwithin", distance=c["building"] - 1e-6
    )
    assert near.shape[1] == 0
    near = shapely.STRtree(mapped).query(fill, predicate="dwithin", distance=c["tree"] - 1e-6)
    assert near.shape[1] == 0


def test_fill_is_deterministic_across_two_runs(layers, osm_tags):
    runs = []
    for _ in range(2):
        res = decor.build_layers(osm_tags, layers, config.PILOT_AOI_BBOX, DropLog())
        runs.append(shapely.to_wkb(res["trees"].geometry.to_numpy()).tolist())
    assert runs[0] == runs[1]
    assert len(runs[0]) == len(layers["trees"])
    stored = shapely.to_wkb(layers["trees"].geometry.to_numpy()).tolist()
    assert runs[0] == stored, "the stored trees layer differs from a fresh build"


def test_markings_are_all_stylised_and_trace_to_a_road_or_crossing(layers, osm_tags, report):
    m = layers["markings"]
    assert len(m) > 0
    assert m["stylised"].all()
    roads = layers["roads"]
    road_ids = set(zip(roads["osm_type"], roads["osm_id"], strict=True))
    crossings = {
        (t, int(i))
        for t, i, tags in zip(
            osm_tags["lines"]["osm_type"],
            osm_tags["lines"]["osm_id"],
            osm_tags["lines"]["tags"],
            strict=True,
        )
        if tags.get("footway") == "crossing"
    }
    classes = dict(
        zip(zip(roads["osm_type"], roads["osm_id"], strict=True), roads["class"], strict=True)
    )
    for r in m.itertuples():
        key = (r.osm_type, int(r.osm_id))
        if r.kind == "centre_line":
            assert key in road_ids, f"centre line of unknown road {key}"
            assert classes[key] in style.CENTRE_LINE_CLASSES
        else:
            assert r.kind == "zebra"
            assert key in crossings, f"zebra on a way that is not footway=crossing: {key}"
    report.add(
        "Markings (T-4.1)",
        f"- rows by kind: {dict(sorted(Counter(m['kind']).items()))}; crossing ways in the "
        f"extract: {len(crossings)}; crossing nodes (highway=crossing): "
        f"{sum(t.get('highway') == 'crossing' for t in osm_tags['points']['tags'])} (not used)",
    )


def test_tile_tables_carry_every_tree_with_its_fields(trees):
    man = json.loads((TILE_DIR / "tiles.json").read_text(encoding="utf-8"))
    assert "trees" in man["layers"] and man["instanced_layers"] == ["trees"]
    rows = []
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        tile_rows = table["layers"].get("trees", [])
        assert t["counts"].get("trees", 0) == len(tile_rows)
        for r in tile_rows:
            assert set(r) == {
                "osm_type", "osm_id", "source", "decorative", "height_m", "height_source", "x", "z"
            }  # fmt: skip
            e = r["x"] + config.ORIGIN_E
            n = config.ORIGIN_N - r["z"]
            assert grid.tile_name(*grid.tile_ij(e, n)) == t["id"]
        rows += tile_rows
    assert len(rows) == len(trees)
    assert Counter(r["source"] for r in rows) == Counter(trees["source"])
    assert all(r["decorative"] == (r["source"] == "fill") for r in rows)
