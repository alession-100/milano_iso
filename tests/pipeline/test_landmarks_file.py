import math
import re
import subprocess
import sys
from pathlib import Path

import yaml
from milano_iso import config

ROOT = Path(__file__).resolve().parents[2]
YAML_PATH = ROOT / "tests" / "landmarks.yaml"
SCRIPT = ROOT / "pipeline" / "scripts" / "build_landmarks.py"
QID = re.compile(r"^Q[1-9][0-9]*$")


def _landmarks():
    return yaml.safe_load(YAML_PATH.read_text(encoding="utf-8"))["landmarks"]


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def test_count_and_duomo():
    lm = _landmarks()
    assert len(lm) == 16
    assert sum(1 for x in lm if x["group"] == "phase4") == 11
    assert sum(1 for x in lm if x["group"] == "pilot_ref") == 5
    assert next(x for x in lm if x["id"] == "duomo")["in_pilot"] is True


def test_schema():
    for x in _landmarks():
        assert re.fullmatch(r"[a-z0-9_]+", x["id"])
        assert isinstance(x["name"], str) and x["name"]
        assert QID.match(x["wikidata"])
        osm = x["osm"]
        assert osm["type"] in ("node", "way", "relation")
        assert isinstance(osm["id"], int)
        assert isinstance(osm["version"], int)
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", osm["timestamp"])
        pos = x["position"]
        assert _num(pos["e"]) and _num(pos["n"]) and _num(pos["lat"]) and _num(pos["lon"])
        assert pos["method"] in ("footprint_centroid", "node")
        assert (pos["method"] == "node") == (osm["type"] == "node")
        assert isinstance(x["in_pilot"], bool)
        assert x["tolerance_m"] == 5
        p = x["wikidata_p625"]
        if p is not None:
            assert _num(p["lat"]) and _num(p["lon"]) and _num(p["distance_m"])
        assert x["sources"]
        for s in x["sources"]:
            assert s["url"].startswith("https://")
            assert re.fullmatch(r"\d{4}-\d\d-\d\d", s["retrieved"])


def test_unique_ids_and_qids():
    lm = _landmarks()
    ids = [x["id"] for x in lm]
    assert len(set(ids)) == len(ids)
    assert ids == sorted(ids)
    # Two Bosco Verticale towers share one Wikidata item; every other QID is unique.
    qids = [x["wikidata"] for x in lm if not x["id"].startswith("bosco_verticale_")]
    assert len(set(qids)) == len(qids)
    bosco = {x["wikidata"] for x in lm if x["id"].startswith("bosco_verticale_")}
    assert len(bosco) == 1 and bosco.isdisjoint(qids)
    osm = [(x["osm"]["type"], x["osm"]["id"]) for x in lm]
    assert len(set(osm)) == len(osm)


def test_in_pilot_matches_bbox():
    xmin, ymin, xmax, ymax = config.PILOT_AOI_BBOX
    for x in _landmarks():
        e, n = x["position"]["e"], x["position"]["n"]
        assert x["in_pilot"] == (xmin <= e <= xmax and ymin <= n <= ymax), x["id"]


def test_positions_within_20km_of_origin():
    for x in _landmarks():
        d = math.hypot(x["position"]["e"] - config.ORIGIN_E, x["position"]["n"] - config.ORIGIN_N)
        assert d < 20_000, x["id"]


def test_build_reproduces_committed_yaml():
    before = YAML_PATH.read_bytes()
    try:
        subprocess.run([sys.executable, str(SCRIPT)], check=True, capture_output=True)
        assert YAML_PATH.read_bytes() == before
    finally:
        YAML_PATH.write_bytes(before)


NODE_METHOD_EXCEPTIONS = []  # ids allowed to use method: node (must stay empty, T-1.5a)


def test_buildings_use_footprint_centroid():
    # Every landmark is a building (or the stadium/roof outline); none may fall back to a node.
    for x in _landmarks():
        if x["id"] in NODE_METHOD_EXCEPTIONS:
            continue
        assert x["position"]["method"] == "footprint_centroid", x["id"]
        assert x["osm"]["type"] in ("way", "relation"), x["id"]
    centrale = next(x for x in _landmarks() if x["id"] == "stazione_centrale")
    assert centrale["osm"]["via"] == "contains_node/6067258870"
