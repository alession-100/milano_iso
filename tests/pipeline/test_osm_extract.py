import json

import geopandas as gpd
from milano_iso import osm_extract
from shapely.geometry import box

# Extent: lon 0..1, lat 0..1.
EXTENT = box(0, 0, 1, 1)


def _node(i, lon, lat, tags=None):
    t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in (tags or {}).items())
    return f'<node id="{i}" version="1" lat="{lat}" lon="{lon}">{t}</node>'


def _way(i, refs, tags=None):
    nd = "".join(f'<nd ref="{r}"/>' for r in refs)
    t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in (tags or {}).items())
    return f'<way id="{i}" version="1">{nd}{t}</way>'


def _rel(i, members, tags):
    m = "".join(f'<member type="way" ref="{r}" role="{role}"/>' for r, role in members)
    t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
    return f'<relation id="{i}" version="1">{m}{t}</relation>'


def _write(tmp_path, body):
    p = tmp_path / "t.osm"
    p.write_text(
        '<?xml version="1.0"?><osm version="0.6" generator="test">' + body + "</osm>",
        encoding="utf-8",
    )
    return p


def _body():
    nodes = [
        _node(1, 0.2, 0.2, {"amenity": "cafe", "name": "Inside"}),
        _node(2, 5.0, 5.0, {"amenity": "cafe", "name": "Outside"}),
        _node(3, 0.3, 0.3),  # untagged, no output
        # building straddling the east edge (x from 0.9 to 1.5)
        _node(10, 0.9, 0.4),
        _node(11, 1.5, 0.4),
        _node(12, 1.5, 0.6),
        _node(13, 0.9, 0.6),
        # building wholly outside
        _node(20, 3.0, 3.0),
        _node(21, 3.1, 3.0),
        _node(22, 3.1, 3.1),
        _node(23, 3.0, 3.1),
        # road crossing the extent from far west to inside
        _node(30, -2.0, 0.8),
        _node(31, 0.5, 0.8),
        # multipolygon: outer 0.1..0.4 with hole 0.2..0.3 (untagged ways)
        _node(40, 0.1, 0.6),
        _node(41, 0.4, 0.6),
        _node(42, 0.4, 0.9),
        _node(43, 0.1, 0.9),
        _node(44, 0.2, 0.7),
        _node(45, 0.3, 0.7),
        _node(46, 0.3, 0.8),
        _node(47, 0.2, 0.8),
    ]
    ways = [
        _way(100, [10, 11, 12, 13, 10], {"building": "yes"}),
        _way(101, [20, 21, 22, 23, 20], {"building": "yes"}),
        _way(102, [30, 31], {"highway": "residential"}),
        _way(103, [10, 13], {}),  # untagged way
        _way(110, [40, 41, 42, 43, 40]),
        _way(111, [44, 45, 46, 47, 44]),
    ]
    rels = [
        _rel(200, [(110, "outer"), (111, "inner")], {"type": "multipolygon", "landuse": "park"}),
    ]
    return "".join(nodes + ways + rels)


def _run(tmp_path, extent=EXTENT):
    src = _write(tmp_path, _body())
    out = tmp_path / "out.gpkg"
    summary = osm_extract.extract(src, extent, out)
    layers = {n: gpd.read_file(out, layer=n) for n in osm_extract.LAYERS}
    return summary, layers, out


def test_extent_intersection(tmp_path):
    summary, layers, _ = _run(tmp_path)
    assert list(layers["points"].osm_id) == [1]  # tagged, inside; not 2 (outside) or 3 (untagged)
    assert set(layers["areas"].osm_id) == {100, 200}  # not 101 (outside)
    assert list(layers["lines"].osm_id) == [102]
    assert summary["kept"] == {"points": 1, "lines": 1, "areas": 2}
    assert summary["failed_area_assembly"]["relation_ids"] == []


def test_objects_kept_whole(tmp_path):
    _, layers, _ = _run(tmp_path)
    bld = layers["areas"].set_index("osm_id").loc[100].geometry
    assert bld.bounds == (0.9, 0.4, 1.5, 0.6)  # extends past the extent edge at x=1
    road = layers["lines"].iloc[0].geometry
    assert road.bounds[0] == -2.0


def test_area_output_closed_way_and_multipolygon(tmp_path):
    _, layers, _ = _run(tmp_path)
    areas = layers["areas"].set_index("osm_id")
    assert areas.loc[100, "osm_type"] == "w" and areas.loc[100, "area_from"] == "way"
    assert areas.loc[200, "osm_type"] == "r" and areas.loc[200, "area_from"] == "relation"
    mp = areas.loc[200].geometry
    assert abs(mp.area - (0.3 * 0.3 - 0.1 * 0.1)) < 1e-12  # hole preserved
    assert json.loads(areas.loc[200, "tags"])["landuse"] == "park"
    # untagged member ways are not output on their own
    assert not set(layers["lines"].osm_id) & {110, 111}
    assert not set(areas.index) & {110, 111}
    assert list(layers["points"].columns) == ["osm_type", "osm_id", "tags", "geometry"]
    assert layers["points"].crs.to_epsg() == 4326


def test_tags_json_sorted(tmp_path):
    _, layers, _ = _run(tmp_path)
    assert layers["points"].tags.iloc[0] == '{"amenity": "cafe", "name": "Inside"}'


def test_deterministic_ordering_and_hash(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    s1, l1, _ = _run(tmp_path / "a")
    s2, _l2, _ = _run(tmp_path / "b")
    assert s1["canonical_sha256"] == s2["canonical_sha256"]
    for df in l1.values():
        keys = list(zip(df.osm_type, df.osm_id, strict=True))
        assert keys == sorted(keys)


def test_failed_area_assembly_listed(tmp_path):
    # Open ring: the relation cannot be assembled.
    body = (
        _node(1, 0.1, 0.1)
        + _node(2, 0.4, 0.1)
        + _node(3, 0.4, 0.4)
        + _way(10, [1, 2, 3])
        + _rel(300, [(10, "outer")], {"type": "multipolygon", "landuse": "grass"})
    )
    src = _write(tmp_path, body)
    summary = osm_extract.extract(src, EXTENT, tmp_path / "o.gpkg")
    assert summary["failed_area_assembly"]["relation_ids"] == [300]
    assert summary["kept"]["areas"] == 0


def test_pilot_extent_is_densified_and_wgs84():
    poly = osm_extract.pilot_extent_wgs84()
    assert len(poly.exterior.coords) - 1 >= 40  # at least 10 points per edge
    minx, miny, maxx, maxy = poly.bounds
    assert 9.1 < minx < maxx < 9.2 and 45.4 < miny < maxy < 45.5  # Milan centre
