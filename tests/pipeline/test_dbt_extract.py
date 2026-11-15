"""Synthetic-data tests for dbt_extract and dbt_fetch (no real data needed)."""

import json

import geopandas as gpd
import pandas as pd
import pytest
from milano_iso import dbt_extract as ex
from milano_iso import dbt_fetch as fe
from shapely.geometry import Polygon, box


def test_natural_key_orders_numerically():
    ids = ["UN_VOL_10", "UN_VOL_2", "UN_VOL_1"]
    assert sorted(ids, key=ex.natural_key) == ["UN_VOL_1", "UN_VOL_2", "UN_VOL_10"]


def test_sort_by_key_and_rejects_duplicates():
    gdf = gpd.GeoDataFrame({"CLASSID": ["A_3", "A_1", "A_2"]}, geometry=[box(0, 0, 1, 1)] * 3)
    assert list(ex.sort_by_key(gdf, "CLASSID")["CLASSID"]) == ["A_1", "A_2", "A_3"]
    dup = gpd.GeoDataFrame({"CLASSID": ["A_1", "A_1"]}, geometry=[box(0, 0, 1, 1)] * 2)
    with pytest.raises(ValueError):
        ex.sort_by_key(dup, "CLASSID")


def test_extent_polygon_is_densified_and_same_crs_passthrough():
    poly = ex.extent_polygon((0, 0, 100, 100), "EPSG:32632", "EPSG:32632", step=10)
    assert len(poly.exterior.coords) == 41  # 4 edges x 10 segments + closing vertex
    assert poly.bounds == pytest.approx((0, 0, 100, 100))


def test_extent_polygon_transform_stays_close():
    bbox = (514479, 5034036, 515479, 5035036)
    poly = ex.extent_polygon(bbox)
    # RDN2008 and WGS84 UTM differ by well under a metre: bounds stay within 1 m.
    assert poly.bounds == pytest.approx(bbox, abs=1.0)
    assert len(poly.exterior.coords) > 5


def test_read_intersecting_keeps_whole_features(tmp_path):
    inside = box(0, 0, 10, 10)
    straddle = box(90, 90, 200, 200)
    outside = box(500, 500, 510, 510)
    gdf = gpd.GeoDataFrame({"k": ["a", "b", "c"]}, geometry=[inside, straddle, outside], crs=32632)
    path = tmp_path / "t.gpkg"
    gdf.to_file(path, driver="GPKG")
    got = ex.read_intersecting(str(path), box(0, 0, 100, 100))
    assert list(got["k"]) == ["a", "b"]
    assert got.geometry.iloc[1].equals(straddle)  # not clipped


def test_canonical_dump_is_stable_and_sensitive(tmp_path):
    gdf = gpd.GeoDataFrame(
        {"k": ["a", "b"], "v": [1.5, None]}, geometry=[box(0, 0, 1, 1), box(2, 2, 3, 3)], crs=32632
    )
    p1, p2, p3 = (tmp_path / n for n in ("1.gpkg", "2.gpkg", "3.gpkg"))
    gdf.to_file(p1, driver="GPKG", layer="x")
    gdf.to_file(p2, driver="GPKG", layer="x")
    changed = gdf.copy()
    changed.loc[0, "v"] = 9.0
    changed.to_file(p3, driver="GPKG", layer="x")
    assert ex.canonical_dump_sha256(p1) == ex.canonical_dump_sha256(p2)
    assert ex.canonical_dump_sha256(p1) != ex.canonical_dump_sha256(p3)


def test_column_stats():
    df = pd.DataFrame({"n": [1.0, 3.0, None], "s": ["a", "", None]})
    stats = {s["field"]: s for s in ex.column_stats(df)}
    assert stats["n"]["nulls"] == 1
    assert (stats["n"]["min"], stats["n"]["median"], stats["n"]["max"]) == (1.0, 2.0, 3.0)
    assert stats["s"]["nulls"] == 1
    assert stats["s"]["empty_strings"] == 1


def test_join_stats():
    b = pd.DataFrame({"CLASSREF": ["E_1", "E_2", "E_3"]})
    uv = pd.DataFrame({"CEDIUV": ["E_1", "E_1", "E_2", "X_9"]})
    j = ex.join_stats(uv, b)
    assert j["un_vol_matched"] == 3
    assert j["match_rate"] == pytest.approx(0.75)
    assert j["buildings_without_volume"] == 1
    assert j["volumes_per_building_histogram"] == {"1": 1, "2": 1}
    assert j["volumes_per_building_max"] == 2


def test_height_vs_extrusion():
    def ring(z):
        return Polygon([(0, 0, z), (1, 0, z), (1, 1, z), (0, 0, z)])

    uv = gpd.GeoDataFrame(
        {"UN_VOL_QE": [110.0, 110.0], "UN_VOL_AV": [10.0, 6.5], "UN_VOL_POR": ["01", "03"]},
        geometry=[ring(100.0), ring(100.0)],
    )
    r = ex.height_vs_extrusion(uv)
    assert r["01"]["qe_minus_basez_minus_av_median"] == pytest.approx(0.0)
    assert r["03"]["qe_minus_basez_minus_av_median"] == pytest.approx(3.5)


def test_fetch_skips_when_manifest_matches_and_fails_on_mismatch(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(fe.config, "RAW_DIR", tmp_path / "raw")
    monkeypatch.setattr(fe, "MANIFEST_DIR", tmp_path / "man")
    dest = fe.target_path("dbt_spec")
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"hello")
    fe.MANIFEST_DIR.mkdir()
    man = {"url": "u", "retrieved_utc": "t", "bytes": 5, "sha256": fe.sha256_file(dest)}
    fe.manifest_path("dbt_spec").write_text(json.dumps(man))

    def boom(*a, **k):
        raise AssertionError("must not download")

    monkeypatch.setattr(fe, "_download", boom)
    fe.fetch("dbt_spec")
    assert "skip" in capsys.readouterr().out
    dest.write_bytes(b"tampered")
    with pytest.raises(SystemExit):
        fe.fetch("dbt_spec")
