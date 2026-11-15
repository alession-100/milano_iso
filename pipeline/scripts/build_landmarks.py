"""Build tests/landmarks.yaml from saved OSM and Wikidata responses (T-1.5). Offline.

Reads only reports/artifacts/T-1.5/responses/ (saved by fetch_landmarks.py) and writes
tests/landmarks.yaml deterministically (sorted keys, entries sorted by id).

The selection below (which QID, which OSM element) is a human decision, explained for
every non-obvious case in reports/artifacts/T-1.5/choices.md. The script verifies the
selection against the saved responses: the QID must appear in the saved Wikidata search,
and the chosen OSM element must be one of the elements Overpass returned for that QID.

Position (ADR-0011): centroid of the OSM footprint polygon (area-weighted, holes
subtracted), computed with milano_iso.geo.polygon_centroid_area and cross-checked
against shapely (must agree within 1e-3 m); for a node, the node itself.

Run with `uv run python pipeline/scripts/build_landmarks.py`.
"""

import json
import math
import sys
import urllib.parse

import yaml
from milano_iso import config
from milano_iso.geo import polygon_centroid_area
from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

RESP = config.REPO_ROOT / "reports" / "artifacts" / "T-1.5" / "responses"
OUT = config.REPO_ROOT / "tests" / "landmarks.yaml"
RETRIEVED = "2026-11-15"
TOLERANCE_M = 5
CROSSCHECK_M = 1e-3

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32632", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)

# id, name, group, QID, search (file key, language, query text), OSM element[, via node id]
# A seventh item (via) means the QID resolves only to a non-building element, the node with
# that id. The footprint is then the single building=* area containing that node
# (rule of T-1.5a, saved Overpass is_in response contains_node_<id>.json).
SELECTION = [
    ("duomo", "Duomo di Milano", "phase4", "Q18068", ("duomo", "it", "Duomo di Milano"), "relation/18017026"),
    ("castello_sforzesco", "Castello Sforzesco", "phase4", "Q23354", ("castello", "it", "Castello Sforzesco"), "relation/1918"),
    ("torre_velasca", "Torre Velasca", "phase4", "Q1156274", ("velasca", "it", "Torre Velasca"), "relation/18238298"),
    ("grattacielo_pirelli", "Grattacielo Pirelli", "phase4", "Q920809", ("pirelli", "it", "Grattacielo Pirelli"), "way/89444196"),
    ("bosco_verticale_torre_confalonieri", "Bosco Verticale (Torre Confalonieri)", "phase4", "Q2501413", ("bosco_verticale", "it", "Bosco Verticale"), "way/179244686"),
    ("bosco_verticale_torre_de_castillia", "Bosco Verticale (Torre De Castillia)", "phase4", "Q2501413", ("bosco_verticale", "it", "Bosco Verticale"), "way/179244688"),
    ("stazione_centrale", "Stazione di Milano Centrale", "phase4", "Q801193", ("centrale", "it", "Stazione di Milano Centrale"), "relation/18231605", 6067258870),
    ("citylife_allianz", "Torre Allianz (Isozaki)", "phase4", "Q3995200", ("allianz", "it", "Torre Allianz"), "way/353878517"),
    ("citylife_generali", "Torre Generali (Hadid)", "phase4", "Q3995195", ("generali", "it", "Torre Generali"), "relation/18247480"),
    ("citylife_pwc", "Torre PwC (Libeskind)", "phase4", "Q3995204", ("pwc", "it", "Torre PwC"), "relation/18247388"),
    ("stadio_meazza", "Stadio Giuseppe Meazza (San Siro)", "phase4", "Q133566", ("meazza", "it", "Stadio Giuseppe Meazza"), "way/218520505"),
    ("galleria_vittorio_emanuele_ii", "Galleria Vittorio Emanuele II", "pilot_ref", "Q51112", ("galleria", "it", "Galleria Vittorio Emanuele II"), "way/166623705"),
    ("teatro_alla_scala", "Teatro alla Scala", "pilot_ref", "Q5471", ("scala", "it", "Teatro alla Scala"), "relation/6552704"),
    ("palazzo_reale", "Palazzo Reale", "pilot_ref", "Q51105", ("palazzo_reale_b", "it", "Palazzo Reale"), "relation/36488"),
    ("palazzo_marino", "Palazzo Marino", "pilot_ref", "Q1403582", ("palazzo_marino", "it", "Palazzo Marino"), "relation/2766789"),
    ("palazzo_assicurazioni_generali", "Palazzo delle Assicurazioni Generali (Piazza Cordusio)", "pilot_ref", "Q28150806", ("assicurazioni_generali_c", "it", "Palazzo delle Assicurazioni Generali"), "relation/6462576"),
]  # fmt: skip


def load(name):
    return json.loads((RESP / name).read_text(encoding="utf-8"))


def assemble_rings(ways):
    """Join node-id sequences into closed rings. Returns a list of node-id lists."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        while ring[0] != ring[-1]:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                break
            else:
                raise ValueError("ring could not be closed")
        rings.append(ring)
    return rings


def footprint(elems, typ, oid):
    """Return (element, outer_rings, inner_rings) with rings as EPSG:32632 (x, y) lists."""
    nodes = {e["id"]: e for e in elems if e["type"] == "node"}
    ways = {e["id"]: e for e in elems if e["type"] == "way"}
    el = next(e for e in elems if e["type"] == typ and e["id"] == oid)

    def proj(ids):
        return [TO_UTM.transform(nodes[i]["lon"], nodes[i]["lat"]) for i in ids]

    if typ == "way":
        if el["nodes"][0] != el["nodes"][-1]:
            raise ValueError(f"way/{oid} is not closed")
        return el, [proj(el["nodes"])], []
    outer, inner = [], []
    for m in el["members"]:
        if m["type"] != "way":
            continue
        (inner if m["role"] == "inner" else outer).append(ways[m["ref"]]["nodes"])
    return (
        el,
        [proj(r) for r in assemble_rings(outer)],
        [proj(r) for r in assemble_rings(inner)],
    )


def centroid(outers, inners):
    """Area-weighted centroid (holes subtracted), stable method, cross-checked with shapely."""
    tot = sx = sy = 0.0
    for rings, sign in ((outers, 1.0), (inners, -1.0)):
        for pts in rings:
            a, cx, cy = polygon_centroid_area(pts)
            w = sign * abs(a)
            tot += w
            sx += w * cx
            sy += w * cy
    x, y = sx / tot, sy / tot
    # shapely cross-check: union of outers, holes cut out, coordinates shifted to the
    # first vertex so that the check itself is not limited by float cancellation.
    bx, by = outers[0][0]

    def shifted(r):
        return [(px - bx, py - by) for px, py in r]

    geom = unary_union([Polygon(shifted(r)) for r in outers])
    if inners:
        geom = geom.difference(unary_union([Polygon(shifted(r)) for r in inners]))
    c = geom.centroid
    d = math.hypot(x - (c.x + bx), y - (c.y + by))
    if d > CROSSCHECK_M:
        raise ValueError(f"centroid cross-check failed: {d} m")
    return x, y, tot


def p625(entity):
    claims = entity["claims"].get("P625", [])
    claims = [c for c in claims if c.get("rank") != "deprecated"]
    claims.sort(key=lambda c: c.get("rank") != "preferred")  # stable: preferred first
    if not claims:
        return None
    v = claims[0]["mainsnak"]["datavalue"]["value"]
    return v["latitude"], v["longitude"]


def check_contains_node(lid, qid, node_id, typ, oid, outers, inners):
    """Verify the T-1.5a rule offline: node carries the QID, exactly one building contains it."""
    ov = load(f"overpass_{qid}.json")
    if not any(e["type"] == "node" and e["id"] == node_id for e in ov["elements"]):
        raise ValueError(f"{lid}: node/{node_id} does not carry wikidata={qid} in saved Overpass")
    if any("building" in e.get("tags", {}) for e in ov["elements"]):
        raise ValueError(
            f"{lid}: a building element carries {qid}; the node fallback is not needed"
        )
    cands = load(f"contains_node_{node_id}.json")["elements"]
    if [(e["type"], e["id"]) for e in cands] != [(typ, oid)]:
        raise ValueError(f"{lid}: not exactly one containing building: {cands}")
    if "building" not in cands[0]["tags"]:
        raise ValueError(f"{lid}: {typ}/{oid} has no building tag")
    nd = next(e for e in load(f"osm_node_{node_id}.json")["elements"] if e["id"] == node_id)
    pt = Point(TO_UTM.transform(nd["lon"], nd["lat"]))
    geom = unary_union([Polygon(r) for r in outers])
    if inners:
        geom = geom.difference(unary_union([Polygon(r) for r in inners]))
    if not geom.contains(pt):
        raise ValueError(f"{lid}: node/{node_id} is not inside {typ}/{oid} (own check)")


def build_entry(lid, name, group, qid, search, osmref, via=None):
    skey, slang, stext = search
    if not any(s["id"] == qid for s in load(f"search_{skey}_{slang}.json")["search"]):
        raise ValueError(f"{lid}: {qid} not in saved search {skey}_{slang}")
    entity = load(f"wikidata_{qid}.json")["entities"][qid]
    ov = load(f"overpass_{qid}.json")
    typ, oid = osmref.split("/")
    oid = int(oid)
    if via is None and not any(e["type"] == typ and e["id"] == oid for e in ov["elements"]):
        raise ValueError(f"{lid}: {osmref} does not carry wikidata={qid} in saved Overpass")
    elems = load(f"osm_{typ}_{oid}.json")["elements"]
    if typ == "node":
        el = next(e for e in elems if e["type"] == "node" and e["id"] == oid)
        x, y = TO_UTM.transform(el["lon"], el["lat"])
        method = "node"
    else:
        el, outers, inners = footprint(elems, typ, oid)
        x, y, _ = centroid(outers, inners)
        method = "footprint_centroid"
        if via is not None:
            check_contains_node(lid, qid, via, typ, oid, outers, inners)
    e, n = round(x, 2), round(y, 2)
    lon, lat = TO_WGS.transform(x, y)
    xmin, ymin, xmax, ymax = config.PILOT_AOI_BBOX
    wd = p625(entity)
    if wd is None:
        wdout = None
    else:
        wx, wy = TO_UTM.transform(wd[1], wd[0])
        wdout = {"lat": wd[0], "lon": wd[1], "distance_m": round(math.hypot(x - wx, y - wy), 2)}
    api = f"https://api.openstreetmap.org/api/0.6/{typ}/{oid}" + ("" if typ == "node" else "/full")
    ql = f'[out:json][timeout:60];nwr["wikidata"="{qid}"];out tags center;'
    search_q = {"action": "wbsearchentities", "search": stext, "language": slang}
    search_q.update({"uselang": slang, "limit": "8", "format": "json"})
    osm = {"type": typ, "id": oid, "version": el["version"], "timestamp": el["timestamp"]}
    if via is not None:
        osm["via"] = f"contains_node/{via}"
    entry = {
        "id": lid,
        "name": name,
        "group": group,
        "wikidata": qid,
        "osm": osm,
        "position": {
            "e": e,
            "n": n,
            "lat": round(lat, 7),
            "lon": round(lon, 7),
            "method": method,
        },
        "in_pilot": bool(xmin <= e <= xmax and ymin <= n <= ymax),
        "wikidata_p625": wdout,
        "tolerance_m": TOLERANCE_M,
        "sources": [
            {
                "url": "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(search_q),
                "retrieved": RETRIEVED,
            },
            {
                "url": f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json",
                "retrieved": RETRIEVED,
            },
            {
                "url": "https://overpass-api.de/api/interpreter?"
                + urllib.parse.urlencode({"data": ql}),
                "retrieved": RETRIEVED,
                "timestamp_osm_base": ov["osm3s"]["timestamp_osm_base"],
            },
            {"url": api, "retrieved": RETRIEVED},
        ],
    }
    if via is not None:
        cq = f"[out:json][timeout:60];node({via});is_in->.a;"
        cq += '(way(pivot.a)["building"];rel(pivot.a)["building"];);out tags center;'
        entry["sources"].append(
            {
                "url": "https://overpass-api.de/api/interpreter?"
                + urllib.parse.urlencode({"data": cq}),
                "retrieved": RETRIEVED,
                "timestamp_osm_base": load(f"contains_node_{via}.json")["osm3s"][
                    "timestamp_osm_base"
                ],
            }
        )
    return entry


def main():
    entries = sorted((build_entry(*s) for s in SELECTION), key=lambda d: d["id"])
    ids = [d["id"] for d in entries]
    if len(set(ids)) != len(ids):
        sys.exit("duplicate ids")
    header = (
        "# Landmark reference positions (T-1.5). Generated by\n"
        "# pipeline/scripts/build_landmarks.py from reports/artifacts/T-1.5/responses/.\n"
        "# Do not edit by hand. Position = footprint centroid (ADR-0011), EPSG:32632.\n"
    )
    body = yaml.safe_dump(
        {"landmarks": entries}, sort_keys=True, allow_unicode=True, default_flow_style=False
    )
    OUT.write_bytes((header + body).encode("utf-8"))
    print(f"wrote {OUT} ({len(entries)} entries)")


if __name__ == "__main__":
    main()
