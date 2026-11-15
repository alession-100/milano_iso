"""ADR-0014 completeness and the drop log (T-1.6 check 4).

The DBT denominator is computed here, straight from the source ZIP, without normalise.py or
dbt_extract.py. The selection rule is the one in ADR-0013 (as amended in T-1.4): a building is
selected when its footprint (EDIFC / EDI_MIN, IS or ME layer) or one of its volumes intersects
the pilot extent; a selected building contributes all of its volumes.
"""

import json

import numpy as np
import pandas as pd
import pyogrio
import pytest
import shapely
from conftest import DBT_ZIP, DROP_LOG, OSM_INTERIM
from milano_iso import config
from milano_iso.heights import MATCH_THRESHOLD  # constant only: coverage >= 0.5 means matched
from pyproj import Transformer
from shapely.geometry import box

TARGET = 0.99
PREFIX = "DBT 2020 - SHAPE/"
FOOTPRINT_STEMS = [
    "EDIFC_CR_EDF_IS",
    "EDIFC_CR_EDF_ME",
    "EDI_MIN_CR_EDF_IS",
    "EDI_MIN_CR_EDF_ME",
]


def _shp(stem: str) -> str:
    return f"/vsizip/{DBT_ZIP.as_posix()}/{PREFIX}{stem}.shp"


def _extent_7791():
    dense = shapely.segmentize(box(*config.PILOT_AOI_BBOX), 10.0)
    t = Transformer.from_crs("EPSG:32632", "EPSG:7791", always_xy=True)
    return shapely.transform(dense, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))


@pytest.fixture(scope="session")
def dbt_source_volumes() -> pd.DataFrame:
    """All UN_VOL rows (CLASSID, CEDIUV) of the selected DBT buildings in the source ZIP."""
    assert DBT_ZIP.exists(), f"DBT source ZIP not found: {DBT_ZIP}"
    poly = _extent_7791()
    ids: set[str] = set()
    for stem in FOOTPRINT_STEMS:
        g = pyogrio.read_dataframe(_shp(stem), bbox=tuple(poly.bounds), columns=["CLASSREF"])
        ids |= set(g.loc[g.geometry.intersects(poly), "CLASSREF"])
    touching = pyogrio.read_dataframe(_shp("UN_VOL"), bbox=tuple(poly.bounds), columns=["CEDIUV"])
    ids |= set(touching.loc[touching.geometry.intersects(poly), "CEDIUV"])
    allv = pyogrio.read_dataframe(
        _shp("UN_VOL"), columns=["CLASSID", "CEDIUV"], read_geometry=False
    )
    return allv[allv["CEDIUV"].isin(ids)].reset_index(drop=True)


@pytest.fixture(scope="session")
def osm_source_buildings() -> pd.DataFrame:
    """building=* areas (value not 'no') of interim/osm_pilot.gpkg: osm_type, osm_id."""
    assert OSM_INTERIM.exists(), f"interim OSM extract not found: {OSM_INTERIM}"
    areas = pyogrio.read_dataframe(OSM_INTERIM, layer="areas", read_geometry=False)
    tags = areas["tags"].map(json.loads)
    val = tags.map(lambda t: t.get("building"))
    keep = val.notna() & (val != "no")
    return areas.loc[keep, ["osm_type", "osm_id"]].drop_duplicates().reset_index(drop=True)


@pytest.fixture(scope="session")
def drop_log() -> pd.DataFrame:
    assert DROP_LOG.exists(), f"drop log not found: {DROP_LOG}"
    return pd.read_csv(DROP_LOG, dtype=str, keep_default_na=False)


@pytest.fixture(scope="session")
def osm_missing(layers, osm_source_buildings) -> dict:
    """OSM source buildings neither present in `buildings` nor matched to DBT volumes."""
    b = layers["buildings"]
    present = set(zip(b["osm_type"].dropna(), b["osm_id"].dropna().astype("int64"), strict=True))
    src = set(zip(osm_source_buildings["osm_type"], osm_source_buildings["osm_id"], strict=True))
    rest = src - present
    ob = layers["osm_buildings"]
    ob = ob[[(t, i) in rest for t, i in zip(ob["osm_type"], ob["osm_id"], strict=True)]]
    rv = layers["render_volumes"]
    dbt_union = shapely.union_all(rv.loc[rv["source"] == "dbt"].geometry.to_numpy())
    geoms = ob.geometry.to_numpy()
    cov = shapely.area(shapely.intersection(geoms, dbt_union)) / shapely.area(geoms)
    matched = {
        (t, int(i))
        for t, i, c in zip(ob["osm_type"], ob["osm_id"], cov, strict=True)
        if c >= MATCH_THRESHOLD
    }
    in_processed = {(t, int(i)) for t, i in zip(ob["osm_type"], ob["osm_id"], strict=True)}
    missing = sorted(rest - matched)
    return {
        "source": len(src),
        "present": len(src & present),
        "matched": len(matched),
        "missing": missing,
        "not_in_osm_buildings": sorted(rest - in_processed),
    }


def test_completeness_dbt_volumes(layers, dbt_source_volumes, report):
    rv = layers["render_volumes"]
    have = set(rv.loc[rv["source"] == "dbt", "vol_key"].str.removeprefix("dbt:"))
    src = set(dbt_source_volumes["CLASSID"])
    ratio = len(src & have) / len(src)
    extra = sorted(have - src)
    report.add(
        "Completeness: DBT volumes",
        f"- denominator (source ZIP, selected buildings): {len(src)} volumes of "
        f"{dbt_source_volumes['CEDIUV'].nunique()} buildings\n"
        f"- render_volumes with source dbt present in the source set: {len(src & have)}\n"
        f"- ratio {ratio:.4f} (target {TARGET})\n"
        f"- render_volumes dbt rows not in the source set: {len(extra)}",
    )
    assert ratio >= TARGET, (
        f"DBT completeness {ratio:.4f} < {TARGET}: {len(src - have)} of {len(src)} source "
        f"volumes missing, first {sorted(src - have)[:5]}"
    )


def test_completeness_osm_buildings(osm_missing, report):
    m = osm_missing
    ratio = (m["source"] - len(m["missing"])) / m["source"]
    report.add(
        "Completeness: OSM buildings",
        f"- building=* areas in interim/osm_pilot.gpkg: {m['source']}\n"
        f"- present in `buildings`: {m['present']}; matched to DBT volumes only "
        f"(coverage >= {MATCH_THRESHOLD}): {m['matched']}\n"
        f"- missing: {len(m['missing'])}\n"
        f"- ratio {ratio:.4f} (target {TARGET})",
    )
    assert ratio >= TARGET, (
        f"OSM completeness {ratio:.4f} < {TARGET}: {len(m['missing'])} of {m['source']} "
        f"missing, first {m['missing'][:5]}"
    )


def test_drop_log_has_a_reason_for_every_drop(drop_log):
    assert list(drop_log.columns[:5]) == ["layer", "source", "id", "action", "reason"], (
        f"unexpected drop log columns {list(drop_log.columns)}"
    )
    blank = drop_log[drop_log["reason"].str.strip() == ""]
    assert blank.empty, (
        f"{len(blank)} drop log rows without a reason: {blank.head().to_dict('records')}"
    )


def test_every_missing_source_feature_is_in_drop_log(
    layers, dbt_source_volumes, osm_missing, drop_log
):
    rv = layers["render_volumes"]
    have = set(rv.loc[rv["source"] == "dbt", "vol_key"].str.removeprefix("dbt:"))
    logged = set(drop_log["id"])
    dbt_missing = sorted(set(dbt_source_volumes["CLASSID"]) - have)
    osm_ids = [f"{t}{i}" for t, i in osm_missing["not_in_osm_buildings"]]
    unlogged = [x for x in dbt_missing if x not in logged]
    unlogged += [x for x in osm_ids if x not in logged]
    assert not unlogged, (
        f"{len(unlogged)} source features are absent from the processed data and have no "
        f"drop log entry, first {unlogged[:5]}"
    )


def test_drop_log_counts_match_t13_validation(drop_log):
    """The drop log row count per layer equals the dropped counts in the T-1.3 validation.json."""
    path = config.REPO_ROOT / "reports" / "artifacts" / "T-1.3" / "validation.json"
    rep = json.loads(path.read_text(encoding="utf-8"))
    for layer, st in rep["layers"].items():
        dropped = sum(st.get("dropped", {}).values())
        logged = int((drop_log["layer"] == layer).sum())
        assert logged >= dropped, (
            f"{layer}: T-1.3 validation.json reports {dropped} dropped features but the drop "
            f"log has {logged} rows"
        )
