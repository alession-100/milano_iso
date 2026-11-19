import numpy as np
import pytest
from milano_iso import style
from milano_iso.tiles import geom
from shapely.geometry import LineString, Polygon, box

SQUARE_HOLE = Polygon(
    [(0, 0), (10, 0), (10, 10), (0, 10)],
    holes=[[(4, 4), (4, 6), (6, 6), (6, 4)]],
)


def _mesh(poly, bottom, top):
    mb = geom.MeshBuilder()
    mb.add_extrusion(poly, bottom, top, 7)
    return mb


def _enu_triangles(mb):
    """Triangle corners (n, 3, 3) and the geometric unit normals from the winding."""
    xyz = np.asarray(mb._xyz)
    p = xyz[np.asarray(mb._tri)]
    cross = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    return p, cross / np.linalg.norm(cross, axis=1, keepdims=True)


def test_square_with_hole_counts_with_bottom_cap():
    mb = _mesh(SQUARE_HOLE, 2.0, 5.0)
    wall = 2 * 8  # 4 outer + 4 inner edges, two triangles each
    cap = 8  # n + 2h - 2 triangles for 8 vertices and 1 hole
    assert mb.n_triangles == wall + cap + cap
    assert mb.n_vertices == 16  # 8 ring vertices at the bottom and at the top, shared


def test_square_extrusion_shares_vertices():
    mb = _mesh(box(0, 0, 10, 10), 0.0, 5.0)
    assert mb.n_vertices == 8
    assert mb.n_triangles == 10  # 8 wall triangles + 2 top cap triangles, no bottom cap


def test_no_bottom_cap_when_bottom_is_zero():
    mb = _mesh(SQUARE_HOLE, 0.0, 5.0)
    assert mb.n_triangles == 16 + 8
    _p, n = _enu_triangles(mb)
    assert not np.any(n[:, 2] < -1e-9)


def test_bottom_cap_only_when_bottom_positive():
    p, n = _enu_triangles(_mesh(SQUARE_HOLE, 1.0, 5.0))
    assert np.count_nonzero(n[:, 2] < -0.5) == 8
    assert np.all(p[n[:, 2] < -0.5][:, :, 2] == 1.0)
    assert np.count_nonzero(n[:, 2] > 0.5) == 8
    assert np.all(p[n[:, 2] > 0.5][:, :, 2] == 5.0)


def test_winding_faces_outward_and_walls_face_away_from_solid():
    p, n = _enu_triangles(_mesh(SQUARE_HOLE, 1.0, 5.0))
    walls = np.abs(n[:, 2]) < 1e-9
    centre = np.array([5.0, 5.0])
    for tri, nrm in zip(p[walls], n[walls], strict=True):
        mid = tri[:, :2].mean(axis=0)
        inner = np.abs(mid - centre).max() <= 1.0 + 1e-9  # the hole is 2 m wide
        # Outer wall: normal points away from the centre. Hole wall: towards the centre.
        away = float(np.dot(nrm[:2], mid - centre))
        assert (away < 0) if inner else (away > 0)


def test_gl_frame_flips_north_to_negative_z():
    mb = geom.MeshBuilder()
    mb.add_flat(box(0, 0, 10, 20), 0.5, 0)
    (gl,) = mb.to_gl_chunks()
    assert gl["positions"].dtype == np.float64
    assert gl["positions"][:, 1].tolist() == [0.5] * 4
    assert gl["positions"][:, 2].min() == -20.0 and gl["positions"][:, 2].max() == 0.0
    assert len(gl["indices"]) == 6 and len(gl["positions"]) == 4
    # Counter-clockwise from above (+y) in the client frame: normal +y.
    tri = gl["positions"][gl["indices"]].reshape(-1, 3, 3)
    c = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    assert np.all(c[:, 1] > 0)


def test_chunks_split_below_vertex_limit_and_cover_all_triangles():
    mb = geom.MeshBuilder()
    for k in range(5):
        mb.add_extrusion(box(20 * k, 0, 20 * k + 10, 10), 0.0, 5.0, k)
    chunks = mb.to_gl_chunks(max_vertices=20)
    assert [len(c["positions"]) for c in chunks] == [20, 20, 8]  # greedy, split between triangles
    assert sum(len(c["indices"]) for c in chunks) == 3 * mb.n_triangles
    assert all(c["indices"].max() < len(c["positions"]) for c in chunks)


def test_triangulation_covers_polygon_area_and_is_deterministic():
    t = geom.triangulate_polygon(SQUARE_HOLE)
    area = 0.5 * np.abs(
        (t[:, 1, 0] - t[:, 0, 0]) * (t[:, 2, 1] - t[:, 0, 1])
        - (t[:, 2, 0] - t[:, 0, 0]) * (t[:, 1, 1] - t[:, 0, 1])
    )
    assert area.sum() == pytest.approx(SQUARE_HOLE.area)
    assert np.array_equal(t, geom.triangulate_polygon(SQUARE_HOLE))


def test_ribbon_width_from_tag_vs_style_table():
    assert geom.ribbon_width("7.3", "footway", style.ROAD_WIDTH_M) == (7.3, "osm")
    assert geom.ribbon_width("1.20 m", "footway", style.ROAD_WIDTH_M) == (1.2, "osm")
    assert geom.ribbon_width(None, "footway", style.ROAD_WIDTH_M) == (1.5, "style")
    assert geom.ribbon_width("wide", "residential", style.ROAD_WIDTH_M) == (6.0, "style")
    assert geom.ribbon_width("-2", "residential", style.ROAD_WIDTH_M) == (6.0, "style")
    # owner decision of T-6.1 (ADR-0036): the whole-city classes have a style width ...
    assert geom.ribbon_width(None, "motorway", style.ROAD_WIDTH_M) == (12.0, "style")
    assert geom.ribbon_width(None, "other", style.ROAD_WIDTH_M) == (4.0, "style")
    assert geom.ribbon_width(None, "rail", style.RAIL_WIDTH_M) == (3.0, "style")
    # ... and a class that is still unknown is an error
    with pytest.raises(KeyError):
        geom.ribbon_width(None, "bridleway", style.ROAD_WIDTH_M)


def test_ribbon_polygon_has_requested_width_and_flat_caps():
    r = geom.ribbon(LineString([(0, 0), (100, 0)]), 6.0)
    assert r.bounds == (0.0, -3.0, 100.0, 3.0)
    assert r.area == pytest.approx(600.0)


def test_simplify_reports_hausdorff_within_limit():
    wavy = Polygon(
        [(0, 0), (5, 0.05), (10, 0), (10, 10), (5, 10.05), (0, 10)],
    )
    parts, h = geom.simplify_footprint(wavy)
    assert 0 < h <= 0.5
    assert len(parts) == 1
    assert len(parts[0].exterior.coords) < len(wavy.exterior.coords)
