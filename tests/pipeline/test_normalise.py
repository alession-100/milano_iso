"""Synthetic-data tests for milano_iso.normalise (no real data needed)."""

import json

import geopandas as gpd
import pandas as pd
import pyogrio
import pytest
import shapely
from milano_iso import config, normalise
from milano_iso.geo import canonical_dump_sha256
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, box

E0, N0 = config.ORIGIN_E, config.ORIGIN_N
BBOX = config.PILOT_AOI_BBOX
_T = Transformer.from_crs(32632, 4326, always_xy=True)


def ll(x, y):
    """Metres from the origin (EPSG:32632) to lon/lat."""
    return _T.transform(E0 + x, N0 + y)


def sq(x, y, size=20):
    return Polygon([ll(x, y), ll(x + size, y), ll(x + size, y + size), ll(x, y + size)])


def osm_rows():
    bowtie = Polygon([ll(100, 0), ll(120, 20), ll(120, 0), ll(100, 20)])
    collinear = Polygon([ll(200, 0), ll(200, 0), ll(200, 0)])  # degenerate: a single point
    ring = shapely.buffer(Point(ll(300, 300)), 0.0001, quad_segs=8)  # closed way, a roundabout
    return [
        ("w", 1, {"building": "yes", "name": "A", "layer": "-1", "height": "12"}, sq(0, 0)),
        ("w", 2, {"building": "yes"}, bowtie),
        ("w", 3, {"building": "yes"}, collinear),
        ("w", 4, {"highway": "primary", "junction": "roundabout"}, ring),
        ("w", 5, {"highway": "pedestrian", "area": "yes"}, sq(-100, -100, 40)),
        ("w", 6, {"leisure": "park", "name": "Parco"}, sq(-300, 0, 60)),
        ("r", 7, {"building:part": "yes", "min_height": "5"}, sq(30, 0)),
        ("w", 1, {"building": "yes", "name": "A", "layer": "-1", "height": "12"}, sq(0, 0)),
    ]


def osm_lines():
    return [
        ("w", 10, {"highway": "footway", "tunnel": "yes"}, LineString([ll(0, 50), ll(80, 50)])),
        ("w", 11, {"highway": "residential"}, LineString([ll(0, 60), ll(80, 60)])),
        ("w", 12, {"highway": "service"}, LineString([ll(5, 5), ll(5, 5)])),
        ("w", 13, {"railway": "tram", "layer": "-2"}, LineString([ll(0, 70), ll(80, 70)])),
        ("w", 14, {"waterway": "canal"}, LineString([ll(0, 80), ll(80, 80)])),
    ]


def osm_points():
    return [
        ("n", 20, {"amenity": "cafe", "name": "Bar", "name:en": "Cafe"}, Point(ll(10, 10))),
        ("n", 21, {"natural": "tree"}, Point(ll(11, 11))),
    ]


def _frame(rows):
    df = pd.DataFrame(
        {
            "osm_type": [r[0] for r in rows],
            "osm_id": [r[1] for r in rows],
            "tags": [json.dumps(r[2], sort_keys=True) for r in rows],
        }
    )
    return gpd.GeoDataFrame(df, geometry=[r[3] for r in rows], crs=4326)


def write_osm(path, reverse=False):
    for name, rows in (("points", osm_points()), ("lines", osm_lines()), ("areas", osm_rows())):
        rows = rows[::-1] if reverse else rows
        _frame(rows).to_file(path, layer=name, driver="GPKG", engine="pyogrio")


def zpoly(x, y, z, size=10):
    return Polygon(
        [
            (E0 + x, N0 + y, z),
            (E0 + x + size, N0 + y, z),
            (E0 + x + size, N0 + y + size, z + 1),
            (E0 + x, N0 + y + size, z),
        ]
    )


def write_dbt(path):
    def put(name, df, geoms=None):
        if geoms is None:
            pyogrio.write_dataframe(df, path, layer=name, driver="GPKG")
        else:
            g = gpd.GeoDataFrame(df, geometry=geoms, crs="EPSG:7791")
            pyogrio.write_dataframe(g, path, layer=name, driver="GPKG")

    put(
        "un_vol",
        pd.DataFrame(
            {
                "CLASSID": ["UN_VOL_10", "UN_VOL_2", "UN_VOL_3", "UN_VOL_4"],
                "CEDIUV": ["EDIFC_1", "EDI_MIN_5", "EDIFC_1", "EDI_MIN_99"],
                "UN_VOL_POR": ["01", "01", "08", "01"],
                "UN_VOL_AV": [10.0, 3.0, 4.0, 2.0],
                "UN_VOL_QE": [110.0, 103.0, 100.0, 102.0],
                "UN_VOL_EX": ["01"] * 4,
                "SCRIL": ["RC2"] * 4,
            }
        ),
        [zpoly(0, 0, 100), zpoly(20, 0, 100), zpoly(40, 0, 90), zpoly(60, 0, 100)],
    )
    put("edifc", pd.DataFrame({"CLASSREF": ["EDIFC_1"]}), [zpoly(0, 0, 100, 50)])
    put("edi_min", pd.DataFrame({"CLASSREF": ["EDI_MIN_5"]}), [zpoly(20, 0, 100)])
    put("edifc_me", pd.DataFrame({"CLASSREF": ["EDIFC_1"]}), [zpoly(0, 0, 100, 50)])
    put("edi_min_me", pd.DataFrame({"CLASSREF": ["EDI_MIN_5"]}), [zpoly(20, 0, 100)])
    put(
        "edifc_attr",
        pd.DataFrame(
            {
                "CLASSID": ["EDIFC_1"],
                "SCRIL": ["RC2"],
                "EDIFC_MON": [0],
                "EDIFC_STAT": ["03"],
                "EDIFC_TY": ["11"],
                "NOME": ["CHIESA"],
            }
        ),
    )
    put(
        "edifc_uso", pd.DataFrame({"CLASSREF": ["EDIFC_1", "EDIFC_1"], "EDIFC_USO": ["0601", "01"]})
    )
    put(
        "edi_min_attr",
        pd.DataFrame(
            {
                "CLASSID": ["EDI_MIN_5"],
                "SCRIL": ["RC2"],
                "EDI_MIN_PR": [0],
                "EDI_MIN_ST": ["03"],
                "EDI_MIN_TY": ["07"],
            }
        ),
    )


def write_boundary(path):
    gpd.GeoDataFrame(
        {"Dettaglio": ["Comune"]}, geometry=[box(9.0, 45.3, 9.4, 45.6)], crs=4326
    ).to_file(path, driver="GeoJSON")


@pytest.fixture
def inputs(tmp_path):
    osm, dbt, bnd = tmp_path / "osm.gpkg", tmp_path / "dbt.gpkg", tmp_path / "b.geojson"
    write_osm(osm)
    write_dbt(dbt)
    write_boundary(bnd)
    return osm, dbt, bnd, tmp_path


def run_all(inputs, name="out.gpkg"):
    osm, dbt, bnd, tmp = inputs
    return normalise.run(osm, dbt, bnd, tmp / name, BBOX), tmp / name


# --------------------------------------------------------------------------- unit tests


def test_reproject_uses_xy_order():
    x, y = shapely.get_coordinates(normalise.reproject([Point(9.1919, 45.4641)], "EPSG:4326"))[0]
    assert 500_000 < x < 530_000
    assert 5_020_000 < y < 5_050_000


def test_reproject_drops_z_and_dbt_is_near_identity():
    g = normalise.reproject([Point(E0, N0, 123.0)], "EPSG:7791")[0]
    assert not shapely.has_z(g)
    assert (g.x, g.y) == pytest.approx((E0, N0), abs=0.01)


def test_drop_log_requires_a_reason():
    log = normalise.DropLog()
    with pytest.raises(ValueError):
        log.add("l", "osm", "w1", "dropped", "")


def test_clean_geometry_repairs_bowtie_and_reports_reason():
    bowtie = Polygon([(0, 0), (10, 10), (10, 0), (0, 10)])
    geom, repair, drop = normalise.clean_geometry(bowtie)
    assert drop is None
    assert repair.startswith("Self-intersection")
    assert shapely.is_valid(geom)
    assert geom.geom_type in ("Polygon", "MultiPolygon")
    assert geom.area == pytest.approx(50.0)


def test_make_valid_keeps_polygonal_parts_only():
    # a square with a zero-width spike: make_valid yields a polygon plus a line
    spike = Polygon([(0, 0), (10, 0), (10, 10), (5, 10), (5, 15), (5, 10), (0, 10)])
    assert not shapely.is_valid(spike)
    geom, repair, drop = normalise.clean_geometry(spike)
    assert drop is None
    assert repair is not None
    assert geom.geom_type == "Polygon"
    assert geom.area == pytest.approx(100.0)


def test_clean_geometry_drops_zero_area_and_zero_length_and_empty():
    assert normalise.clean_geometry(Polygon([(0, 0), (1, 0), (2, 0)]))[2] is not None
    assert normalise.clean_geometry(LineString([(1, 1), (1, 1)]))[2] is not None
    assert normalise.clean_geometry(Polygon())[2] == "empty_geometry"
    assert normalise.clean_geometry(None)[2] == "empty_geometry"
    assert normalise.clean_geometry(Point(1, 1)) == (Point(1, 1), None, None)


def test_clean_layer_logs_repairs_and_drops():
    gdf = gpd.GeoDataFrame(
        {"k": [1, 2, 3]},
        geometry=[
            Polygon([(0, 0), (10, 10), (10, 0), (0, 10)]),
            Polygon([(0, 0), (1, 0), (2, 0)]),
            box(0, 0, 1, 1),
        ],
        crs=32632,
    )
    log = normalise.DropLog()
    out, st = normalise.clean_layer(gdf, "lay", "osm", ["a", "b", "c"], log)
    assert list(out["k"]) == [1, 3]
    assert st["repaired"] == 1
    assert sum(st["dropped"].values()) == 1
    frame = log.frame()
    assert list(frame.columns) == ["layer", "source", "id", "action", "reason"]
    assert sorted(frame["action"]) == ["dropped", "repaired"]
    assert (frame["reason"].str.len() > 0).all()
    assert shapely.is_valid(out.geometry.to_numpy()).all()


def test_duplicates_are_removed_and_logged():
    g = box(0, 0, 1, 1)
    gdf = gpd.GeoDataFrame(
        {"osm_type": ["w", "w", "w", "w"], "osm_id": [1, 1, 1, 2]},
        geometry=[g, g, box(0, 0, 2, 2), g],
        crs=32632,
    )
    log = normalise.DropLog()
    out, n = normalise.drop_duplicates(gdf, ["osm_type", "osm_id"], list("abcd"), "lay", "osm", log)
    assert n == 1  # same key AND same geometry; w1 with another geometry is kept
    assert len(out) == 3
    assert log.rows == [("lay", "osm", "b", "dropped", "duplicate")]


def test_exterior_z_range():
    p = Polygon([(0, 0, 5), (1, 0, 7), (1, 1, 6), (0, 0, 5)])
    assert normalise.exterior_z_range(p) == (5.0, 7.0)
    assert normalise.exterior_z_range(Polygon([(0, 0), (1, 0), (1, 1)])) == (None, None)


def test_building_class_of():
    assert normalise.building_class_of("E_1", {"E_1"}, {"M_1"}) == "EDIFC"
    assert normalise.building_class_of("M_1", {"E_1"}, {"M_1"}) == "EDI_MIN"
    assert normalise.building_class_of("X", {"E_1"}, {"M_1"}) is None


# --------------------------------------------------------------------------- end to end


def test_run_end_to_end_on_synthetic_data(inputs):
    res, out = run_all(inputs)
    rep, log = res["report"], res["log"]
    layers = {n: pyogrio.read_dataframe(out, layer=n) for n, _ in pyogrio.list_layers(out)}
    assert set(layers) == {
        "dbt_volumes", "dbt_buildings", "osm_buildings", "osm_building_parts", "roads",
        "road_areas", "rail", "water", "green", "landuse", "named_features", "comune_boundary",
    }  # fmt: skip
    a = rep["assertions"]
    assert a["crs_all_layers_epsg32632"] is True
    assert a["invalid_geometries_total"] == 0
    assert a["all_features_intersect_extent"] is True

    # OSM buildings: w1 (twice -> one duplicate), w2 repaired, w3 degenerate dropped
    b = layers["osm_buildings"]
    assert list(b["osm_id"]) == [1, 2]
    assert rep["layers"]["osm_buildings"]["duplicates"] == 1
    assert rep["layers"]["osm_buildings"]["repaired"] == 1
    assert bool(b.set_index("osm_id").loc[1, "underground"]) is True  # layer=-1
    assert bool(b.set_index("osm_id").loc[2, "underground"]) is False
    assert b.set_index("osm_id").loc[1, "height_raw"] == "12"
    assert rep["completeness"]["osm_buildings"]["in"] == 4  # 4 building=* area rows
    assert rep["completeness"]["osm_buildings"]["out"] == 2
    assert layers["osm_building_parts"].loc[0, "min_height_raw"] == "5"

    # roundabout ring -> roads (boundary line); pedestrian area=yes -> road_areas
    roads = layers["roads"].set_index("osm_id")
    assert roads.loc[4, "class"] == "primary"
    assert roads.loc[4].geometry.geom_type in ("LineString", "MultiLineString")
    assert bool(roads.loc[10, "underground"]) is True  # tunnel=yes
    assert 12 not in roads.index  # zero-length line dropped
    assert list(layers["road_areas"]["osm_id"]) == [5]
    assert list(layers["rail"]["osm_id"]) == [13]
    assert bool(layers["rail"].loc[0, "underground"]) is True  # layer=-2
    assert list(layers["water"]["kind"]) == ["canal"]
    assert list(layers["green"]["kind"]) == ["park"]

    # named features: points as-is, areas as a point inside the extent
    nf = layers["named_features"]
    assert set(nf["osm_id"]) == {1, 6, 20}
    assert (nf.geometry.geom_type == "Point").all()
    assert nf.set_index("osm_id").loc[20, "name_en"] == "Cafe"

    # drop log: sorted, every row has a reason
    frame = log.frame()
    assert frame.equals(frame.sort_values(list(frame.columns)).reset_index(drop=True))
    assert (frame["reason"].str.len() > 0).all()
    assert {"repaired", "dropped"} <= set(frame["action"])
    assert ("osm_buildings", "osm", "w3", "dropped") in set(
        zip(frame["layer"], frame["source"], frame["id"], frame["action"], strict=True)
    )

    # DBT: natural order of ids, class from the attribute tables, base Z kept as attributes
    v = layers["dbt_volumes"]
    assert list(v["vol_id"]) == ["UN_VOL_2", "UN_VOL_3", "UN_VOL_4", "UN_VOL_10"]
    assert list(v["building_class"].fillna("null")) == ["EDI_MIN", "EDIFC", "null", "EDIFC"]
    assert rep["dbt"]["volumes_unmatched"] == 1
    assert not v.geometry.has_z.any()
    first = v.set_index("vol_id").loc["UN_VOL_10"]
    assert (first["base_z_min_m"], first["base_z_max_m"]) == (100.0, 101.0)
    assert bool(v.set_index("vol_id").loc["UN_VOL_3", "underground"]) is True  # por 08
    assert rep["completeness"]["dbt_volumes"]["ratio"] == 1.0
    bl = layers["dbt_buildings"].set_index("bld_id")
    assert bl.loc["EDIFC_1", "use_codes"] == "01;0601"
    assert bl.loc["EDIFC_1", "type_label"] == "chiesa"
    assert bl.loc["EDI_MIN_5", "type_label"] == "garage, box auto"
    assert bl.loc["EDI_MIN_5", "status_label"] == "costruito"


def test_deterministic_ordering_and_hash(inputs):
    _osm, dbt, bnd, tmp = inputs
    res1, out1 = run_all(inputs, "a.gpkg")
    _res2, out2 = run_all(inputs, "b.gpkg")
    assert canonical_dump_sha256(out1) == canonical_dump_sha256(out2)
    assert res1["report"]["canonical_dump_sha256_pilot_gpkg"] == canonical_dump_sha256(out2)
    # the same objects in the opposite input order give the same output rows
    rev = tmp / "osm_rev.gpkg"
    write_osm(rev, reverse=True)
    res3 = normalise.run(rev, dbt, bnd, tmp / "c.gpkg", BBOX)
    for layer in ("osm_buildings", "roads", "named_features", "dbt_volumes"):
        a = pyogrio.read_dataframe(out1, layer=layer).drop(columns="geometry")
        c = pyogrio.read_dataframe(tmp / "c.gpkg", layer=layer).drop(columns="geometry")
        assert a.equals(c), layer
    assert res3["log"].frame().equals(res1["log"].frame())
    keys = pyogrio.read_dataframe(out1, layer="osm_buildings")[["osm_type", "osm_id"]]
    assert keys.equals(keys.sort_values(["osm_type", "osm_id"]).reset_index(drop=True))


def _dbt_frames(with_me: bool):
    """In-memory DBT input: EDIFC_1 has an IS footprint, EDIFC_2 only volumes (and ME if asked)."""
    ge = lambda *a: gpd.GeoDataFrame({"CLASSREF": [a[0]]}, geometry=[a[1]], crs="EPSG:7791")
    empty = gpd.GeoDataFrame({"CLASSREF": []}, geometry=[], crs="EPSG:7791")
    vols = gpd.GeoDataFrame(
        {
            "CLASSID": ["UN_VOL_1", "UN_VOL_2"],
            "CEDIUV": ["EDIFC_1", "EDIFC_2"],
            "UN_VOL_POR": ["01", "04"],
            "UN_VOL_AV": [10.0, 3.0],
            "UN_VOL_QE": [110.0, 108.0],
        },
        geometry=[zpoly(0, 0, 100), zpoly(40, 0, 100)],
        crs="EPSG:7791",
    )
    return {
        "un_vol": vols,
        "edifc": ge("EDIFC_1", zpoly(0, 0, 100, 50)),
        "edifc_me": ge("EDIFC_2", zpoly(38, -2, 100, 54)) if with_me else empty,
        "edi_min": empty,
        "edi_min_me": empty,
        "edifc_attr": pd.DataFrame(
            {
                "CLASSID": ["EDIFC_1", "EDIFC_2"],
                "EDIFC_MON": [0, 0],
                "EDIFC_STAT": ["03", "03"],
                "EDIFC_TY": ["11", "11"],
                "NOME": [None, None],
            }
        ),
        "edifc_uso": pd.DataFrame({"CLASSREF": ["EDIFC_1"], "EDIFC_USO": ["01"]}),
        "edi_min_attr": pd.DataFrame(
            {"CLASSID": [], "EDI_MIN_PR": [], "EDI_MIN_ST": [], "EDI_MIN_TY": []}
        ),
    }


def test_building_without_is_footprint_uses_me_then_volumes():
    for with_me, expect in ((True, "me"), (False, "volumes")):
        log = normalise.DropLog()
        layers, _, _ = normalise.normalise_dbt(_dbt_frames(with_me), log)
        b = layers["dbt_buildings"].set_index("bld_id")
        assert list(b.index) == ["EDIFC_1", "EDIFC_2"]
        assert b.loc["EDIFC_1", "footprint_source"] == "is"
        assert b.loc["EDIFC_2", "footprint_source"] == expect
        assert b.loc["EDIFC_2", "geometry"].area > 0
        assert [r for r in log.rows if r[3] == "substituted"] == [
            ("dbt_buildings", "dbt", "EDIFC_2", "substituted", f"no_is_footprint_used_{expect}")
        ]


def test_same_geometry_different_key_is_flagged_except_named_features():
    g = box(0, 0, 10, 10)
    gdf = gpd.GeoDataFrame(
        {"k": ["a", "b", "c"]}, geometry=[g, g, box(20, 0, 30, 10)], crs="EPSG:32632"
    )
    for layer, expected in (("roads", 1), ("named_features", 0)):
        log = normalise.DropLog()
        n = normalise.flag_same_geometry(gdf, list("abc"), layer, "osm", log)
        assert n == expected
        assert [r[2:] for r in log.rows] == (
            [("b", "flagged", "same_geometry_different_key")] if expected else []
        )
