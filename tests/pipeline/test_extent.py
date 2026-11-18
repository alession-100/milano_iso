"""Processing extents and per-extent paths (T-6.1, ADR-0035)."""

import json

import numpy as np
import pytest
import shapely
from milano_iso import config, extent, fetch, measure
from milano_iso.tiles import export, grid
from pyproj import Transformer
from shapely.geometry import box


def test_pilot_paths_are_the_historical_ones():
    assert extent.interim_osm("pilot") == config.INTERIM_DIR / "osm_pilot.gpkg"
    assert extent.interim_dbt("pilot") == config.INTERIM_DIR / "dbt_pilot.gpkg"
    assert extent.processed_gpkg("pilot") == config.PROCESSED_DIR / "pilot.gpkg"
    assert extent.drop_log("pilot") == config.PROCESSED_DIR / "drop_log.csv"
    assert extent.tiles_dir("pilot") == config.DATA_DIR / "tiles" / "pilot"
    pilot_art = config.REPO_ROOT / "reports" / "artifacts" / "T-1.3"
    assert extent.artifact_dir("pilot", pilot_art) == pilot_art


def test_city_paths_are_per_extent_and_never_the_pilot_ones():
    assert extent.interim_osm("city") == config.INTERIM_DIR / "osm_city.gpkg"
    assert extent.interim_dbt("city") == config.INTERIM_DIR / "dbt_city.gpkg"
    assert extent.processed_gpkg("city") == config.PROCESSED_DIR / "city.gpkg"
    assert extent.drop_log("city") == config.PROCESSED_DIR / "drop_log_city.csv"
    assert extent.tiles_dir("city") == config.DATA_DIR / "tiles" / "city"
    pilot_art = config.REPO_ROOT / "reports" / "artifacts" / "T-1.3"
    city_art = extent.artifact_dir("city", pilot_art)
    assert city_art == config.REPO_ROOT / "reports" / "artifacts" / "T-6.1" / "city" / "T-1.3"
    assert city_art != pilot_art


def test_unknown_extent_is_rejected():
    for fn in (extent.interim_osm, extent.polygon, extent.bbox, extent.tiles_dir):
        with pytest.raises(ValueError, match="unknown extent"):
            fn("moon")


def test_pilot_polygon_is_the_aoi_box():
    assert extent.bbox("pilot") == config.PILOT_AOI_BBOX
    assert extent.polygon("pilot").equals(box(*config.PILOT_AOI_BBOX))
    assert extent.polygon("pilot").area == 1000 * 1000


def test_city_polygon_is_the_boundary_reprojected(tmp_path, monkeypatch):
    # a lon/lat triangle around the Duomo; the expected corners come from pyproj directly
    ring = [(9.17, 45.45), (9.21, 45.45), (9.19, 45.48), (9.17, 45.45)]
    gj = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }
    raw = tmp_path / "raw"
    (raw / "comune_boundary").mkdir(parents=True)
    (raw / "comune_boundary" / fetch.BOUNDARY_FILE).write_text(json.dumps(gj), encoding="utf-8")
    monkeypatch.setattr(config, "RAW_DIR", raw)
    t = Transformer.from_crs(4326, 32632, always_xy=True)
    xs, ys = t.transform([p[0] for p in ring], [p[1] for p in ring])
    poly = extent.polygon("city")
    assert poly.geom_type == "Polygon"
    assert not shapely.has_z(poly)
    got = {(round(x, 3), round(y, 3)) for x, y in shapely.get_coordinates(poly)}
    assert got == {(round(x, 3), round(y, 3)) for x, y in zip(xs, ys, strict=True)}
    assert extent.bbox("city") == (min(xs), min(ys), max(xs), max(ys))
    # the origin of the map (Duomo) lies inside, the grid is unchanged
    assert poly.contains(shapely.Point(config.ORIGIN_E, config.ORIGIN_N))
    assert grid.tile_ij(config.ORIGIN_E, config.ORIGIN_N) == (0, 0)


def test_flat_index_returns_the_same_pieces_as_testing_every_polygon():
    rng = np.random.default_rng(7)
    feats = []
    for k in range(60):
        n = int(rng.integers(0, 4))  # features with no polygon at all are allowed
        polys = []
        for _ in range(n):
            x, y = rng.uniform(-500, 500, 2)
            polys.append(box(x, y, x + rng.uniform(1, 80), y + rng.uniform(1, 80)))
        feats.append({"entry": {"k": k}, "polys": polys})
    index = export._FlatIndex(feats)
    for tile in ((0, 0, 250, 250), (-250, -250, 0, 0), (100, -300, 360, 40)):
        tb = box(*tile)
        want = []
        for f in feats:
            hit = [p for p in f["polys"] if shapely.intersects(p, tb)]
            if hit:
                want.append((f["entry"]["k"], [p.wkb for p in hit]))
        got = [(f["entry"]["k"], [p.wkb for p in ps]) for f, ps in index.features_in(tb)]
        assert got == want
    assert export._FlatIndex([]).features_in(box(0, 0, 1, 1)) == []


def test_measure_records_time_memory_and_counts(tmp_path, capsys):
    out = tmp_path / "m.json"
    code = (
        "import time; from milano_iso.measure import report_counts; "
        "x = b'x' * (60 * 2**20); time.sleep(0.6); "
        "report_counts(**{'in': 5, 'out': 3}); print('hello')"
    )
    for _ in range(2):  # the second run replaces the first entry
        rc = measure.main(
            ["--step", "demo", "--extent", "pilot", "--out", str(out), "--", "-c", code]
        )
        assert rc == 0
    items = json.loads(out.read_text(encoding="utf-8"))
    assert len(items) == 1
    e = items[0]
    assert (e["step"], e["extent"], e["returncode"]) == ("demo", "pilot", 0)
    assert e["counts"] == {"in": 5, "out": 3}
    assert e["seconds"] >= 0.5
    assert e["peak_mb"] > 50  # the child holds a 60 MiB buffer
    assert "hello" in capsys.readouterr().out


def test_measure_passes_the_exit_code_on(tmp_path):
    out = tmp_path / "m.json"
    rc = measure.main(
        ["--step", "bad", "--extent", "city", "--out", str(out), "--", "-c", "raise SystemExit(3)"]
    )
    assert rc == 3
    assert json.loads(out.read_text(encoding="utf-8"))[0]["returncode"] == 3


def test_count_outside_tolerates_float_noise_on_the_edge_only():
    from milano_iso import normalise

    ext = box(0, 0, 100, 100)
    pts = np.array(
        [
            shapely.Point(50, 50),  # inside
            shapely.Point(100 + 1e-10, 50),  # on the edge, float noise: not outside
            shapely.Point(100.01, 50),  # 1 cm outside: outside
            shapely.Point(-5, -5),  # outside
        ],
        dtype=object,
    )
    assert normalise._count_outside(pts, ext) == 2
    assert normalise._count_outside(pts[:2], ext) == 0


def test_report_counts_is_silent_outside_the_wrapper(monkeypatch, capsys):
    monkeypatch.delenv(measure.ENV_FLAG, raising=False)
    measure.report_counts(**{"in": 1})
    assert capsys.readouterr().out == ""
    monkeypatch.setenv(measure.ENV_FLAG, "1")
    measure.report_counts(**{"in": 1})
    assert capsys.readouterr().out.startswith(measure.PREFIX)
