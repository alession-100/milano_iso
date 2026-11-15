import importlib.util
import json
from pathlib import Path

from milano_iso import config
from milano_iso.geo import polygon_centroid_area
from shapely.geometry import MultiPolygon, Polygon

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "pipeline" / "scripts" / "origin_from_sources.py"
OVERPASS = ROOT / "reports" / "artifacts" / "T-0.3" / "overpass_wikidata_Q18068.json"


def _script():
    spec = importlib.util.spec_from_file_location("origin_from_sources", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _duomo_rings():
    elems = [
        e
        for e in json.loads(OVERPASS.read_text(encoding="utf-8"))["elements"]
        if e.get("tags", {}).get("wikidata") == "Q18068"
    ]
    assert len(elems) == 1
    return _script().projected_rings(elems[0])


def _shapely_centroid():
    outers, inners = _duomo_rings()
    assert not inners
    c = MultiPolygon([Polygon(r) for r in outers]).centroid
    return c.x, c.y


def test_synthetic_square_far_from_origin():
    x0, y0, side = 500000.0, 5000000.0, 37.0
    ring = [(x0, y0), (x0 + side, y0), (x0 + side, y0 + side), (x0, y0 + side), (x0, y0)]
    a, cx, cy = polygon_centroid_area(ring)
    assert abs(a - side * side) < 1e-6
    assert abs(cx - (x0 + side / 2)) < 1e-6
    assert abs(cy - (y0 + side / 2)) < 1e-6


def test_duomo_stable_centroid_matches_shapely():
    outers, _ = _duomo_rings()
    tot = sx = sy = 0.0
    for r in outers:
        a, cx, cy = polygon_centroid_area(r)
        tot += abs(a)
        sx += abs(a) * cx
        sy += abs(a) * cy
    sx, sy = sx / tot, sy / tot
    px, py = _shapely_centroid()
    assert abs(sx - px) < 1e-3
    assert abs(sy - py) < 1e-3


def test_config_origin_is_rounded_shapely_centroid():
    px, py = _shapely_centroid()
    assert (config.ORIGIN_E, config.ORIGIN_N) == (round(px), round(py))


def test_pilot_aoi_bbox():
    e, n, h = config.ORIGIN_E, config.ORIGIN_N, config.AOI_HALF_SIZE_M
    assert h == 500
    assert config.PILOT_AOI_BBOX == (e - 500, n - 500, e + 500, n + 500)
