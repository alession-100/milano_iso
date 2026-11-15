"""Synthetic-data tests for milano_iso.heights and the T-1.4 extent fix (no real data)."""

import geopandas as gpd
import pandas as pd
import pyogrio
import pytest
import shapely
from milano_iso import dbt_extract, heights, normalise
from shapely.geometry import box

CRS = "EPSG:32632"


def vol(vol_id, ref, por, base_z, av, qe, geom=None, cls="EDIFC"):
    return {
        "building_class": cls,
        "vol_id": vol_id,
        "building_ref": ref,
        "por": por,
        "base_z_min_m": base_z,
        "av_m": av,
        "qe_m": qe,
        "geometry": geom if geom is not None else box(0, 0, 10, 10),
    }


def osm_frame(rows):
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=CRS)


def osm_row(osm_id, geom, building="yes", name=None, **extra):
    row = {"osm_type": "w", "osm_id": osm_id, "building": building, "name": name}
    row |= {"height_raw": None, "levels_raw": None, "min_height_raw": None, "min_level_raw": None}
    row |= extra
    row["geometry"] = geom
    return row


# ----------------------------------------------------------------------------- DBT rule


def test_dbt_bottom_top_por01_and_por03():
    # Ground volume (01) on base 100; portico volume (03) whose QE - AV is 3.5 above its base.
    df = pd.DataFrame(
        [
            vol("V1", "B1", "01", 100.0, 10.0, 110.0),
            vol("V2", "B1", "03", 100.0, 5.0, 108.5),
        ]
    )
    out = heights.dbt_volume_heights(df).set_index("vol_id")
    assert out.loc["V1", "ground_z_m"] == 100.0
    assert out.loc["V1", "bottom_m"] == pytest.approx(0.0)
    assert out.loc["V1", "top_m"] == pytest.approx(10.0)
    assert out.loc["V2", "bottom_m"] == pytest.approx(3.5)
    assert out.loc["V2", "top_m"] == pytest.approx(8.5)
    assert out["ground_flag"].isna().all()


def test_dbt_ground_is_min_over_por01_only():
    df = pd.DataFrame(
        [
            vol("V1", "B1", "01", 101.0, 9.0, 110.0),
            vol("V2", "B1", "01", 100.5, 4.0, 104.5),
            vol("V3", "B1", "08", 90.0, 3.0, 93.0),  # not ground-based: ignored for ground_z
        ]
    )
    out = heights.dbt_volume_heights(df)
    assert (out["ground_z_m"] == 100.5).all()
    assert out["top_m"].tolist() == pytest.approx([9.5, 4.0, -7.5])
    assert out["bottom_m"].tolist() == pytest.approx([0.5, 0.0, -10.5])  # reported, not clamped


def test_dbt_no_por01_fallback_is_flagged():
    df = pd.DataFrame(
        [
            vol("V1", "B1", "03", 100.0, 5.0, 108.5),
            vol("V2", "B1", "02", 102.0, 3.0, 108.0),
            vol("V3", "B2", "01", 50.0, 10.0, 60.0),
        ]
    )
    out = heights.dbt_volume_heights(df).set_index("vol_id")
    assert out.loc["V1", "ground_flag"] == "no_por01"
    assert out.loc["V2", "ground_flag"] == "no_por01"
    assert out.loc["V1", "ground_z_m"] == 100.0  # minimum over all volumes of B1
    assert out.loc["V1", "bottom_m"] == pytest.approx(3.5)
    assert pd.isna(out.loc["V3", "ground_flag"])


# ----------------------------------------------------------------------------- matching


@pytest.mark.parametrize(("width", "expected"), [(4.9, False), (5.1, True)])
def test_coverage_threshold_049_and_051(width, expected):
    osm = box(0, 0, 10, 10)  # area 100
    dbt_union = box(0, 0, width, 10)
    cov = heights.coverage_ratios([osm], dbt_union)
    assert cov[0] == pytest.approx(width / 10)
    assert bool(heights.is_matched(cov)[0]) is expected


def test_transfer_picks_largest_overlap():
    bld = pd.Series({"dbt:B1": box(0, 0, 10, 10)})
    osm = osm_frame(
        [
            osm_row(5, box(0, 0, 4, 10), name="small"),
            osm_row(9, box(4, 0, 12, 10), building="church", name="big"),
        ]
    )
    out = heights.transfer_attributes(bld, osm)
    assert out.loc["dbt:B1", "osm_id"] == 9
    assert out.loc["dbt:B1", "building_type"] == "church"
    assert out.loc["dbt:B1", "name"] == "big"


def test_transfer_tie_goes_to_lower_osm_id():
    bld = pd.Series({"dbt:B1": box(0, 0, 10, 10)})
    osm = osm_frame(
        [
            osm_row(30, box(5, 0, 10, 10), name="b"),
            osm_row(20, box(0, 0, 5, 10), name="a"),
        ]
    )
    out = heights.transfer_attributes(bld, osm)
    assert out.loc["dbt:B1", "osm_id"] == 20
    assert out.loc["dbt:B1", "name"] == "a"


def test_transfer_no_overlap_gives_no_row():
    bld = pd.Series({"dbt:B1": box(0, 0, 10, 10)})
    osm = osm_frame([osm_row(1, box(20, 20, 30, 30))])
    assert heights.transfer_attributes(bld, osm).empty


# ----------------------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    ("raw", "metres"),
    [
        ("12", 12.0),
        ("12.5", 12.5),
        ("12 m", 12.0),
        ("12m", 12.0),
        ("10 ft", 3.048),
        ("10ft", 3.048),
        ("10'", 3.048),
        (" 7 ", 7.0),
    ],
)
def test_parse_height_accepted(raw, metres):
    value, reason = heights.parse_height(raw)
    assert value == pytest.approx(metres)
    assert reason in {"plain", "metres", "feet"}


@pytest.mark.parametrize(
    "raw",
    ["", "  ", None, float("nan"), "12 meters", "1,5", "3-4", "tall", "5'6\"", "12 km", "-3"],
)
def test_parse_height_rejected(raw):
    value, reason = heights.parse_height(raw)
    assert value is None
    assert reason in {"empty", "unrecognised_format"}


def test_levels_rule_and_chain_order():
    top, src, log = heights.osm_top_m(None, "4", 99.0)
    assert (top, src) == (12.0, "osm_levels")
    assert log[0][:3] == ("levels", "4", "accepted")
    # height wins over levels
    assert heights.osm_top_m("20", "4", 99.0)[:2] == (20.0, "osm_height")
    # rejected height falls through to levels, and the rejection is logged
    top, src, log = heights.osm_top_m("tall", "2", 99.0)
    assert (top, src) == (6.0, "osm_levels")
    assert [r[2] for r in log] == ["rejected", "accepted"]
    # unusable levels (not a plain positive number) fall through to the default
    for bad in ("0", "3;4", "many", "-1"):
        assert heights.osm_top_m(None, bad, 99.0)[:2] == (99.0, "default")
    assert heights.osm_top_m(None, None, 99.0)[:2] == (99.0, "default")


def test_bottom_from_min_height_then_min_level():
    assert heights.osm_bottom_m("4 m", "2")[0] == 4.0
    assert heights.osm_bottom_m(None, "2")[0] == 6.0
    assert heights.osm_bottom_m(None, None)[0] == 0.0
    b, log = heights.osm_bottom_m("deep", None)
    assert b == 0.0
    assert log[0][2] == "rejected"


# ----------------------------------------------------------------------------- defaults


def test_default_is_median_of_edi_min_buildings():
    df = pd.DataFrame(
        {
            "building_class": ["EDI_MIN"] * 3 + ["EDIFC"] * 2 + [None],
            "height_m": [2.0, 3.0, 10.0, 30.0, 40.0, 5.0],
        }
    )
    assert heights.derive_default(df) == {
        "value": 3.0,
        "n": 3,
        "method": "median_edi_min_dbt_buildings",
    }


def test_default_fails_loudly_without_edi_min():
    df = pd.DataFrame({"building_class": ["EDIFC", None], "height_m": [30.0, 5.0]})
    with pytest.raises(ValueError, match="EDI_MIN"):
        heights.derive_default(df)
    with pytest.raises(ValueError):
        heights.derive_default(pd.DataFrame({"height_m": [3.0]}))


def test_render_status():
    assert heights.render_status("roof", "default") == (False, "no_walls_roof")
    assert heights.render_status("construction", "default") == (False, "under_construction")
    assert heights.render_status("yes", "default") == (True, None)


# ----------------------------------------------------------------------------- build


def test_build_end_to_end_synthetic():
    vols = gpd.GeoDataFrame(
        [
            vol("U1", "B1", "01", 100.0, 10.0, 110.0, box(0, 0, 10, 10)),
            vol("U2", "B1", "01", 100.0, 20.0, 120.0, box(10, 0, 20, 10)),
            vol("M1", "B2", "01", 100.0, 4.0, 104.0, box(100, 0, 110, 10), cls="EDI_MIN"),
        ],
        geometry="geometry",
        crs=CRS,
    )
    osm = osm_frame(
        [
            osm_row(1, box(0, 0, 20, 10), name="Matched"),
            osm_row(2, box(50, 0, 60, 10), name="Gap", height_raw="8 m"),
            osm_row(3, box(70, 0, 80, 10), building="roof"),
            osm_row(4, box(90, 20, 95, 25), building="construction"),
            osm_row(5, box(90, 40, 95, 45)),
        ]
    )
    parts = gpd.GeoDataFrame({"geometry": [box(52, 2, 54, 4)]}, geometry="geometry", crs=CRS)
    res = heights.build(vols, osm, parts, {("w", 1): "lm1", ("w", 2): "lm2"})
    rv, bl = res["render_volumes"], res["buildings"]
    assert rv["vol_key"].tolist() == [
        "dbt:M1",
        "dbt:U1",
        "dbt:U2",
        "osm:w2",
        "osm:w3",
        "osm:w4",
        "osm:w5",
    ]
    assert bl["building_key"].tolist() == [
        "dbt:B1",
        "dbt:B2",
        "osm:w2",
        "osm:w3",
        "osm:w4",
        "osm:w5",
    ]
    by_key = bl.set_index("building_key")
    dbt = by_key.loc["dbt:B1"]
    assert dbt["height_m"] == 20.0 and dbt["n_volumes"] == 2 and dbt["name"] == "Matched"
    assert dbt["landmark_id"] == "lm1" and dbt["height_source"] == "dbt"
    gap = by_key.loc["osm:w2"]
    assert gap["height_m"] == 8.0 and gap["height_source"] == "osm_height"
    assert gap["landmark_id"] == "lm2"
    assert res["defaults"]["value"] == 4.0 and res["defaults"]["n"] == 1
    expected = {
        "osm:w2": (True, None),
        "osm:w3": (False, "no_walls_roof"),
        "osm:w4": (False, "under_construction"),
        "osm:w5": (True, None),
        "dbt:B1": (True, None),
    }
    for key, (rendered, reason) in expected.items():
        row = by_key.loc[key]
        assert bool(row["rendered"]) is rendered
        if reason is None:
            assert pd.isna(row["render_reason"])
        else:
            assert row["render_reason"] == reason
    for key in ("osm:w3", "osm:w4", "osm:w5"):
        assert by_key.loc[key, "height_m"] == 4.0 and by_key.loc[key, "height_source"] == "default"
    assert not rv.set_index("vol_key").loc["osm:w3", "rendered"]
    assert res["n_unmatched_with_parts"] == 1
    assert heights.check_layers(rv, bl) == {"render_volumes_ok": True, "buildings_ok": True}
    rep = heights.make_report(res)
    assert rep["matching"]["matched"] == 1 and rep["matching"]["unmatched"] == 4
    assert rep["attribute_transfer"]["dbt_buildings_without_osm_attributes"] == 1
    assert rep["render_status"] == {
        "rendered": 4,
        "not_rendered": 2,
        "reasons": {"no_walls_roof": 1, "under_construction": 1},
    }


# ----------------------------------------------------------------------------- landmark-first


def _cand(items):
    return pd.DataFrame({"building_key": [k for k, _ in items], "geometry": [g for _, g in items]})


def test_assign_landmarks_largest_overlap_is_primary():
    cand = _cand([("a", box(0, 0, 10, 10)), ("b", box(10, 0, 30, 10))])
    # footprint overlaps a by 30 m2 (30% of a) and b by 100 m2 (50% of b)
    out, unassigned = heights.assign_landmarks(cand, {"lm": box(7, 0, 20, 10)})
    assert out["b"] == ("lm", True)
    assert "a" not in out
    assert unassigned == []


def test_assign_landmarks_secondary_needs_more_than_half_inside():
    cand = _cand(
        [
            ("big", box(0, 0, 20, 10)),
            ("half", box(20, 0, 30, 10)),  # exactly 50% inside: not secondary
            ("most", box(20, 20, 30, 30)),  # 60% inside: secondary
            ("far", box(100, 0, 110, 10)),
        ]
    )
    fp = shapely.union_all([box(0, 0, 25, 10), box(20, 20, 26, 30)])
    out, _ = heights.assign_landmarks(cand, {"lm": fp})
    assert out == {"big": ("lm", True), "most": ("lm", False)}


def test_assign_landmarks_no_overlap_is_reported():
    cand = _cand([("a", box(0, 0, 10, 10))])
    out, unassigned = heights.assign_landmarks(cand, {"lm": box(50, 50, 60, 60)})
    assert out == {} and unassigned == ["lm"]


def test_build_landmark_first_not_attribute_transfer():
    """Generali case: attribute transfer gives the DBT building OSM id 2 (larger overlap), but
    the landmark is OSM id 1; landmark-first still makes the DBT building primary."""
    vols = gpd.GeoDataFrame(
        [
            vol("U1", "B1", "01", 100.0, 10.0, 110.0, box(0, 0, 30, 10)),
            vol("M1", "B2", "01", 100.0, 4.0, 104.0, box(100, 0, 110, 10), cls="EDI_MIN"),
        ],
        geometry="geometry",
        crs=CRS,
    )
    osm = osm_frame(
        [
            osm_row(1, box(0, 0, 25, 10), name="Landmark"),
            osm_row(2, box(0, 0, 30, 10), name="Other"),
        ]
    )
    parts = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=CRS)
    res = heights.build(vols, osm, parts, {("w", 1): "lm1"})
    row = res["buildings"].set_index("building_key").loc["dbt:B1"]
    assert row["osm_id"] == 2 and row["landmark_id"] == "lm1" and bool(row["landmark_primary"])
    assert res["landmarks_no_rendered_overlap"] == []


# ----------------------------------------------------------------------------- edge fix


def test_selected_building_ids_and_whole_building_volumes(tmp_path):
    touching = pd.DataFrame({"CEDIUV": ["EDIFC_1"]})
    layers = {
        "edifc": pd.DataFrame({"CLASSREF": ["EDIFC_2"]}),
        "edifc_me": pd.DataFrame({"CLASSREF": ["EDIFC_2", "EDIFC_3"]}),
        "edi_min": pd.DataFrame({"CLASSREF": ["EDI_MIN_4"]}),
        "edi_min_me": pd.DataFrame({"CLASSREF": pd.Series([], dtype=str)}),
    }
    ids = dbt_extract.selected_building_ids(layers, touching)
    assert ids == {"EDIFC_1", "EDIFC_2", "EDIFC_3", "EDI_MIN_4"}

    # EDIFC_1 has one volume inside the extent and one far outside: both must be kept.
    gpkg = tmp_path / "v.gpkg"
    src = gpd.GeoDataFrame(
        {
            "CLASSID": ["V1", "V2", "V3"],
            "CEDIUV": ["EDIFC_1", "EDIFC_1", "EDIFC_9"],
            "geometry": [box(0, 0, 1, 1), box(500, 500, 501, 501), box(2, 2, 3, 3)],
        },
        geometry="geometry",
        crs=CRS,
    )
    pyogrio.write_dataframe(src, gpkg, layer="UN_VOL")
    got = dbt_extract.read_building_volumes(str(gpkg), {"EDIFC_1"})
    assert sorted(got["CLASSID"]) == ["V1", "V2"]


def test_volumes_outside_extent_allowed_only_with_their_building():
    extent = box(0, 0, 100, 100)
    vols = gpd.GeoDataFrame(
        {
            "building_ref": ["B1", "B1", "B2"],
            "geometry": [box(10, 10, 20, 20), box(150, 10, 160, 20), box(200, 200, 210, 210)],
        },
        geometry="geometry",
        crs=CRS,
    )
    blds = gpd.GeoDataFrame(
        {"bld_id": ["B1", "B2"], "geometry": [box(10, 10, 20, 20), box(200, 200, 210, 210)]},
        geometry="geometry",
        crs=CRS,
    )
    violations, kept = normalise.volumes_outside_extent(vols, blds, extent)
    assert kept == 1  # B1's outer volume
    assert violations == 1  # B2 does not touch the extent at all
