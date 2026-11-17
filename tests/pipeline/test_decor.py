"""Unit tests for trees and road markings (T-4.1) on small synthetic inputs."""

import geopandas as gpd
import pytest
import shapely
from milano_iso import decor, style
from milano_iso.normalise import DropLog
from shapely.geometry import LineString, Point, box

CRS = "EPSG:32632"
BBOX = (0.0, 0.0, 200.0, 200.0)


def _frame(rows, cols):
    return gpd.GeoDataFrame(
        {c: [r[i] for r in rows] for i, c in enumerate(cols)},
        geometry=[r[-1] for r in rows],
        crs=CRS,
    )


def _osm(points=(), lines=()):
    def mk(rows, osm_type):
        return gpd.GeoDataFrame(
            {
                "osm_type": [osm_type] * len(rows),
                "osm_id": [r[0] for r in rows],
                "tags": [r[1] for r in rows],
            },
            geometry=[r[2] for r in rows],
            crs=CRS,
        )

    return {"points": mk(points, "n"), "lines": mk(lines, "w")}


def _layers(green=None, roads=(), buildings=()):
    def empty(cols):
        return gpd.GeoDataFrame({c: [] for c in cols}, geometry=[], crs=CRS)

    g = _frame([("w", 1, "park", green)], ["osm_type", "osm_id", "kind"]) if green else None
    r = (
        _frame(
            [("w", i, c, None, False, geom) for i, c, geom in roads],
            ["osm_type", "osm_id", "class", "width_raw", "underground"],
        )
        if roads
        else empty(["osm_type", "osm_id", "class", "width_raw", "underground"])
    )
    b = (
        _frame(
            [(f"b{i}", True, geom) for i, geom in enumerate(buildings)],
            ["building_key", "rendered"],
        )
        if buildings
        else empty(["building_key", "rendered"])
    )
    return {
        "green": g if g is not None else empty(["osm_type", "osm_id", "kind"]),
        "roads": r,
        "buildings": b,
        "render_volumes": b.copy(),
        "road_areas": empty(["osm_type", "osm_id", "class"]),
        "water": empty(["osm_type", "osm_id", "kind"]),
    }


@pytest.mark.parametrize(
    ("raw", "want"),
    [("9", 9.0), ("8.5", 8.5), ("12 m", 12.0), ("7,5", 7.5), ("tall", None), ("-3", None),
     ("0", None), ("120", None), (None, None), ("8;9", None)],
)  # fmt: skip
def test_parse_tree_height(raw, want):
    assert decor.parse_tree_height(raw) == want


def test_points_along_spreads_evenly_and_uses_a_midpoint_for_short_lines():
    line = LineString([(0, 0), (70, 0)])
    pts = decor.points_along(line, 7.0)
    assert len(pts) == 10
    assert [round(p.x, 6) for p in pts][:2] == [3.5, 10.5]
    assert len(decor.points_along(LineString([(0, 0), (3, 0)]), 7.0)) == 1


def test_mapped_trees_sources_heights_and_drops():
    osm = _osm(
        points=[
            (1, {"natural": "tree"}, Point(50, 50)),
            (2, {"natural": "tree", "height": "11"}, Point(60, 50)),
            (3, {"natural": "tree", "height": "tall"}, Point(70, 50)),
            (4, {"natural": "tree"}, Point(500, 50)),  # outside the extent
            (5, {"amenity": "bench"}, Point(10, 10)),
        ],
        lines=[(9, {"natural": "tree_row"}, LineString([(10, 100), (80, 100)]))],
    )
    log = DropLog()
    trees, stats = decor.mapped_trees(osm, box(*BBOX), log)
    assert list(trees["source"]).count("osm_tree") == 3
    assert list(trees["source"]).count("osm_tree_row") == 10
    assert not trees["decorative"].any()
    by_id = trees[trees["osm_type"] == "n"].set_index("osm_id")
    assert by_id.loc[2, "height_m"] == 11.0
    assert by_id.loc[2, "height_source"] == "osm_height"
    assert by_id.loc[3, "height_m"] == style.TREE_DEFAULT_HEIGHT_M
    assert by_id.loc[3, "height_source"] == "style_default"
    assert stats["dropped_outside_extent"] == 1
    reasons = {(r[2], r[4]) for r in log.rows}
    assert ("n4", "outside_extent") in reasons
    assert ("n3", "height_tag_not_parseable:tall") in reasons


def test_fill_trees_are_deterministic_clear_of_obstacles_and_flagged():
    park = box(20, 20, 180, 180)
    building = box(60, 60, 100, 100)
    road = LineString([(20, 140), (180, 140)])
    layers = _layers(green=park, roads=[(7, "residential", road)], buildings=[building])
    osm = _osm(points=[(1, {"natural": "tree"}, Point(150, 40))])
    runs = []
    for _ in range(2):
        res = decor.build_layers(osm, layers, BBOX, DropLog())
        runs.append(res["trees"])
    a, b = runs
    assert len(a) > 20
    assert (
        shapely.to_wkb(a.geometry.to_numpy()).tolist()
        == shapely.to_wkb(b.geometry.to_numpy()).tolist()
    )
    fill = a[a["source"] == "fill"]
    assert len(fill) > 10
    assert fill["decorative"].all()
    assert fill["osm_id"].isna().all()
    assert (fill["height_source"] == "style_default").all()
    c = style.FILL_CLEARANCE_M
    ribbon_half = style.ROAD_WIDTH_M["residential"] / 2
    for p in fill.geometry:
        assert park.contains(p)
        assert building.distance(p) >= c["building"] - 1e-9
        assert road.distance(p) >= ribbon_half + c["road"] - 1e-6
        assert p.distance(Point(150, 40)) >= c["tree"] - 1e-9


def test_fill_only_in_park_and_garden_kinds():
    layers = _layers(green=box(20, 20, 180, 180))
    layers["green"]["kind"] = "grass"
    res = decor.build_layers(_osm(), layers, BBOX, DropLog())
    assert len(res["trees"]) == 0


def test_dashes_are_centred_and_skip_short_lines():
    line = LineString([(0, 0), (100, 0)])
    d = decor.dashes(line, 3.0, 4.5, 5.0)
    assert all(abs(x.length - 3.0) < 1e-9 for x in d)
    assert d[0].coords[0][0] >= 5.0
    assert d[-1].coords[-1][0] <= 95.0
    assert decor.dashes(LineString([(0, 0), (9, 0)]), 3.0, 4.5, 5.0) == []


def test_centre_lines_only_on_listed_classes_and_flagged_stylised():
    line = LineString([(10, 100), (190, 100)])
    layers = _layers(roads=[(1, "tertiary", line), (2, "footway", line), (3, "service", line)])
    res = decor.build_layers(_osm(), layers, BBOX, DropLog())
    m = res["markings"]
    assert list(m["osm_id"]) == [1]
    assert list(m["kind"]) == ["centre_line"]
    assert m["stylised"].all()


def test_zebra_only_on_marked_crossing_ways():
    cross = LineString([(100, 90), (100, 110)])
    crossing = {"highway": "footway", "footway": "crossing"}
    osm = _osm(
        lines=[
            (10, {**crossing, "crossing": "zebra"}, cross),
            (11, {**crossing, "crossing": "unmarked"}, cross),
            (12, {**crossing}, cross),
            (13, {**crossing, "crossing": "marked", "tunnel": "yes"}, cross),
        ]
    )
    log = DropLog()
    res = decor.build_layers(osm, _layers(), BBOX, log)
    m = res["markings"]
    assert list(m["osm_id"]) == [10]
    assert list(m["kind"]) == ["zebra"]
    stripes = list(m.geometry.iloc[0].geoms)
    assert (
        len(stripes) == int((20 - 2 * style.ZEBRA_END_TRIM_M - style.ZEBRA_STRIPE_WIDTH_M) // 1) + 1
    )
    # stripes run along the road, across the crossing way (here: x extent is the stripe length)
    minx, miny, maxx, maxy = stripes[0].bounds
    assert maxx - minx == pytest.approx(style.ZEBRA_STRIPE_LENGTH_M)
    assert maxy - miny == pytest.approx(style.ZEBRA_STRIPE_WIDTH_M)
    reasons = {r[2]: r[4] for r in log.rows if r[0] == "markings"}
    assert reasons["w11"] == "crossing_not_marked:unmarked"
    assert reasons["w12"] == "crossing_not_marked:None"
    assert reasons["w13"] == "underground"


def test_a_stylised_polygon_layer_is_valid():
    line = LineString([(10, 100), (190, 100)])
    res = decor.build_layers(_osm(), _layers(roads=[(1, "tertiary", line)]), BBOX, DropLog())
    assert all(isinstance(g, shapely.MultiPolygon) and g.is_valid for g in res["markings"].geometry)


def _markings_wkb(dx: float) -> list[bytes]:
    """Markings of one diagonal road and one diagonal crossing, inputs shifted by ``dx``."""
    road = LineString([(20 + dx, 30), (170, 160 + dx), (185, 120)])
    cross = LineString([(90, 110 + dx), (110 + dx, 85)])
    osm = _osm(lines=[(10, {"footway": "crossing", "crossing": "zebra"}, cross)])
    res = decor.build_layers(osm, _layers(roads=[(1, "tertiary", road)]), BBOX, DropLog())
    return [g.wkb for g in res["markings"].geometry]


def test_markings_do_not_depend_on_last_bit_float_noise():
    # T-4.4: Linux and Windows GEOS builds differ in the last bits of buffer and interpolation
    # results, which reordered dash parts and flipped rectangle diagonals in the CI fixture.
    # A 1e-9 m input shift stands in for that noise; the snapped, sorted output must not move.
    base = _markings_wkb(0.0)
    assert len(base) == 2
    for dx in (1e-9, -1e-9, 3e-10):
        assert _markings_wkb(dx) == base


def test_marking_coordinates_are_on_the_millimetre_grid():
    line = LineString([(10.0003, 100.0007), (190.0001, 140.0009)])
    res = decor.build_layers(_osm(), _layers(roads=[(1, "tertiary", line)]), BBOX, DropLog())
    coords = shapely.get_coordinates(res["markings"].geometry.iloc[0])
    assert (abs(coords * 1000 - (coords * 1000).round()) < 1e-6).all()
