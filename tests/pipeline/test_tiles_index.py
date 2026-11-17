"""Search index (index.json) and minimap (minimap.svg), synthetic inputs (T-5.3a)."""

import json
import xml.etree.ElementTree as ET

import pytest
import shapely
from milano_iso.tiles import index, minimap
from shapely.geometry import LineString, Point, box

LM = {"duomo": "Duomo di Milano", "galleria": "Galleria Vittorio Emanuele II"}
SVG = "{http://www.w3.org/2000/svg}"


def _b(key, name, lid, geom, tile="0_0"):
    return {"key": key, "name": name, "landmark_id": lid, "geom": geom, "tile": tile}


def _street(osm_id, name, geoms, tiles=("0_0",), osm_type="w"):
    return {
        "osm_type": osm_type,
        "osm_id": osm_id,
        "name": name,
        "geoms": list(geoms),
        "tiles": set(tiles),
    }


def _area(kind, osm_id, name):
    return {
        "kind": kind,
        "osm_type": "w",
        "osm_id": osm_id,
        "name": name,
        "geoms": [box(0, 0, 9, 9)],
        "tiles": {"0_0"},
    }


def _entries(buildings=(), streets=(), areas=(), roofs=None):
    return index.build_entries(list(buildings), list(streets), list(areas), LM, roofs)


def test_streets_are_grouped_by_exact_name_with_union_bbox_and_ids():
    s = [
        _street(7, "Via Dante", [box(0, 0, 10, 4)], ["0_0"]),
        _street(3, "Via Dante", [box(20, 0, 30, 4)], ["1_0"]),
        _street(5, "Via dante", [box(0, 50, 10, 54)]),  # a different name: not merged
        _street(9, "Via Dante", [box(5, 5, 6, 6)], ["0_0"], osm_type="r"),
    ]
    out = _entries(streets=s)
    assert [e["name"] for e in out] == ["Via Dante", "Via dante"]
    dante = out[0]
    assert dante["kind"] == "street"
    assert dante["ref"] == {"osm_ids": {"r": [9], "w": [3, 7]}}
    assert dante["bbox"] == [0.0, -6.0, 30.0, 0.0]  # [xmin, zmin, xmax, zmax], z = -y
    assert dante["tiles"] == ["0_0", "1_0"]
    cx, cz = dante["centre"]
    pieces = s[0]["geoms"] + s[1]["geoms"] + s[3]["geoms"]
    assert any(g.distance(Point(cx, -cz)) < 0.2 for g in pieces)  # a point on the street


def test_unnamed_and_blank_names_are_left_out_and_names_are_kept_exactly():
    b = [
        _b("a", None, None, box(0, 0, 5, 5)),
        _b("b", "", None, box(0, 0, 5, 5)),
        _b("c", "   ", None, box(0, 0, 5, 5)),
        _b("d", "Caffè  Città", None, box(0, 0, 5, 5)),
    ]
    out = _entries(buildings=b)
    assert [e["name"] for e in out] == ["Caffè  Città"]  # no accent folding, no whitespace edit
    assert out[0]["ref"] == {"key": "d"}


def test_landmark_name_takes_precedence_over_the_building_name():
    b = [
        _b("dbt:1", "Palazzo Carminati", "duomo", box(0, 0, 10, 10)),
        _b("dbt:2", "Palazzo Carminati", "duomo", box(10, 0, 20, 10), tile="1_0"),
        _b("dbt:3", "Bar Duomo", None, box(50, 0, 55, 5)),
    ]
    out = _entries(buildings=b)
    names = [(e["kind"], e["name"]) for e in out]
    assert names == [("building", "Bar Duomo"), ("landmark", "Duomo di Milano")]
    lm = out[1]
    assert lm["ref"] == {"landmark_id": "duomo"}
    assert lm["bbox"] == [0.0, -10.0, 20.0, 0.0]
    assert lm["tiles"] == ["0_0", "1_0"]
    assert lm["centre"] == [10.0, -5.0]


def test_a_roof_landmark_without_building_gets_its_entry_from_the_roof():
    roofs = [{"landmark_id": "galleria", "geom": box(0, 0, 40, 10), "tiles": ["-1_0"]}]
    out = _entries(roofs=roofs)
    assert [(e["kind"], e["name"], e["tiles"]) for e in out] == [
        ("landmark", "Galleria Vittorio Emanuele II", ["-1_0"])
    ]


def test_a_landmark_id_missing_from_the_yaml_is_an_error():
    with pytest.raises(ValueError, match="nowhere"):
        _entries(buildings=[_b("x", "X", "nowhere", box(0, 0, 1, 1))])


def test_sort_order_is_kind_then_name_then_ref():
    b = [
        _b("k2", "Zeta", None, box(0, 0, 5, 5)),
        _b("k1", "Alfa", None, box(0, 0, 5, 5)),
        _b("k4", "Alfa", None, box(0, 0, 5, 5)),
        _b("k3", "Alfa", None, box(0, 0, 5, 5)),
        _b("L", "x", "duomo", box(0, 0, 5, 5)),
    ]
    areas = [_area("water", 1, "Darsena"), _area("green", 2, "Parco")]
    street = [_street(1, "Via A", [box(0, 0, 5, 1)])]
    out = _entries(buildings=b, streets=street, areas=areas)
    assert [(e["kind"], e["name"]) for e in out] == [
        ("building", "Alfa"),
        ("building", "Alfa"),
        ("building", "Alfa"),
        ("building", "Zeta"),
        ("street", "Via A"),
        ("green", "Parco"),
        ("water", "Darsena"),
        ("landmark", "Duomo di Milano"),
    ]
    assert [e["ref"]["key"] for e in out[:3]] == ["k1", "k3", "k4"]
    assert out == _entries(buildings=b[::-1], streets=street, areas=areas[::-1])


def test_values_are_rounded_to_a_tenth_of_a_metre():
    out = _entries(buildings=[_b("a", "A", None, box(0.012, 0.049, 10.26, 20.33))])
    e = out[0]
    for v in [*e["bbox"], *e["centre"]]:
        assert abs(v * 10 - round(v * 10)) < 1e-9
    assert e["bbox"] == [0.0, -20.3, 10.3, 0.0]


def _inputs(dx):
    move = shapely.affinity.translate
    b = [
        _b("a", "Casa", None, move(box(3.01, 4.02, 13.31, 24.43), dx, dx)),
        _b("d", "x", "duomo", move(box(40.01, 4.02, 63.1, 54.4), dx, dx)),
    ]
    s = [_street(1, "Via X", [LineString([(0.01 + dx, 0.02), (90.03, 0.02 + dx)]).buffer(3)])]
    return b, s


def test_index_does_not_depend_on_one_nanometre_input_shifts():
    # CLAUDE.md lesson (T-4.4): Linux and Windows GEOS differ in the last bits; the rounding to
    # 0.1 m must absorb that. A 1e-9 m shift stands in for that noise.
    b0, s0 = _inputs(0.0)
    base = json.dumps(_entries(buildings=b0, streets=s0))
    for dx in (1e-9, -1e-9, 3e-10):
        b, s = _inputs(dx)
        assert json.dumps(_entries(buildings=b, streets=s)) == base


# ---------------------------------------------------------------------------- minimap


def _svg(dx=0.0, **kw):
    water = [shapely.affinity.translate(box(-30.0, 10.0, -10.0, 30.0), dx, dx)]
    green = [box(0.01 + dx, 0.02, 40.03, 25.04).difference(box(10, 10, 20, 20))]
    bld = [box(50.04 + dx, -20.06, 80.07, -5.01), box(60.01, -12.04, 90.02 + dx, 0.03)]
    roads = [
        ("primary", LineString([(-100.01 + dx, 0.02), (0.03, 0.0 + dx), (100.04, 40.0)])),
        ("residential", LineString([(5.01, -50.02 + dx), (6.0, 60.03)])),
        ("footway", LineString([(0, 0), (5, 5)])),  # not drawn
    ]
    return minimap.render((-120, -60, 240, 130), water, green, bld, roads, **kw)


def test_minimap_is_well_formed_svg_with_the_given_viewbox_and_css_classes():
    root = ET.fromstring(_svg())
    assert root.tag == f"{SVG}svg"
    assert root.get("viewBox") == "-120 -60 240 130"
    paths = {p.get("class"): p.get("d") for p in root.iter(f"{SVG}path")}
    assert set(paths) == {"mm-green", "mm-water", "mm-road-minor", "mm-road-major", "mm-building"}
    for el in root.iter():
        assert el.get("fill") is None and el.get("stroke") is None  # colours only via CSS classes
    assert "mm-building{fill:" in root.find(f"{SVG}style").text
    # the footway is not drawn: the minor-road path holds the residential line only
    assert paths["mm-road-minor"].count("M") == 1


def test_minimap_is_north_up_and_formats_decimetres_without_floats():
    root = ET.fromstring(minimap.render((0, -10, 20, 20), [], [], [box(0, 0, 4, 2)], []))
    d = root.find(f"{SVG}path").get("d")
    # the footprint spans y = 0..2 (north), so SVG y = 0..-2: the path starts at its minimum point
    assert d.startswith("M0 -2l")
    assert [minimap._fmt(v) for v in (123, -5, 0, -120)] == ["12.3", "-0.5", "0", "-12"]


def _rel_ring_area2(ring: str) -> float:
    head, steps = ring[1:].split("l")
    x, y = (float(v) for v in head.split())
    nums = [float(v) for v in steps.split()]
    pts = [(x, y)]
    for k in range(0, len(nums), 2):
        pts.append((pts[-1][0] + nums[k], pts[-1][1] + nums[k + 1]))
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1], strict=True))


def test_minimap_courtyard_is_a_hole_by_orientation_not_by_union():
    outer = box(0, 0, 20, 20)
    ring = shapely.Polygon(outer.exterior.coords, [box(5, 5, 15, 15).exterior.coords])
    root = ET.fromstring(minimap.render((0, -20, 20, 20), [], [], [ring], []))
    rings = [r for r in root.find(f"{SVG}path").get("d").split("z") if r]
    assert len(rings) == 2
    assert _rel_ring_area2(rings[0]) * _rel_ring_area2(rings[1]) < 0  # opposite orientation


def test_minimap_does_not_depend_on_one_nanometre_input_shifts():
    base = _svg()
    for dx in (1e-9, -1e-9, 3e-10):
        assert _svg(dx) == base


def test_minimap_simplifies_with_the_tolerance():
    zig = LineString([(x, 0.3 * (x % 2)) for x in range(100)])
    fine = minimap.render((0, 0, 100, 10), [], [], [], [("primary", zig)], tolerance=0.1)
    coarse = minimap.render((0, 0, 100, 10), [], [], [], [("primary", zig)], tolerance=1.0)
    assert len(fine) - len(coarse) > 500  # the 100-point zigzag collapses to one segment


def test_viewbox_covers_the_content_boxes_in_whole_metres():
    boxes = [(-10.4, -20.0, 5.2, 7.0), (0.0, -3.0, 30.01, 9.5)]
    assert minimap.viewbox_of(boxes) == (-11, -20, 42, 30)
