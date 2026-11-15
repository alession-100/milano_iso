"""Compute the map origin and pilot AOI bbox (ADR-0004) from saved source responses.

Reads, from reports/artifacts/T-0.3/:
  overpass_wikidata_Q18068.json  Overpass `out geom` of the OSM Duomo element
  wikidata_Q18068.json           Wikidata entity JSON (property P625)
Prints coordinates in WGS84 and EPSG:32632, their distance, the origin (OSM
centroid in EPSG:32632 rounded to whole metres) and the AOI = origin +/- 500 m.
Run with `uv run python pipeline/scripts/origin_from_sources.py` (project env).
"""

import json
import math
import sys
from pathlib import Path

from milano_iso.geo import polygon_centroid_area
from pyproj import Transformer

ART = Path(__file__).resolve().parents[2] / "reports" / "artifacts" / "T-0.3"
HALF = 500.0
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32632", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)


def load(name):
    return json.loads((ART / name).read_text(encoding="utf-8"))


def assemble_rings(ways):
    """Join way segments (lists of (lon, lat)) into closed rings by shared end points."""
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


def projected_rings(elem):
    """Return (outer_rings, inner_rings) of a multipolygon element, in EPSG:32632."""

    def rings_for(role):
        ways = [
            [(g["lon"], g["lat"]) for g in m["geometry"]]
            for m in elem["members"]
            if m["type"] == "way" and m["role"] == role
        ]
        return [[TO_UTM.transform(lon, lat) for lon, lat in ring] for ring in assemble_rings(ways)]

    return rings_for("outer"), rings_for("inner")


def osm_centroid(elem):
    outers, inners = projected_rings(elem)
    tot = sx = sy = 0.0
    for rings, sign in ((outers, 1.0), (inners, -1.0)):
        for pts in rings:
            a, cx, cy = polygon_centroid_area(pts)
            w = sign * abs(a)
            tot += w
            sx += w * cx
            sy += w * cy
    return sx / tot, sy / tot, tot


def main():
    ov = load("overpass_wikidata_Q18068.json")
    elems = [e for e in ov["elements"] if e.get("tags", {}).get("wikidata") == "Q18068"]
    if len(elems) != 1:
        sys.exit(f"expected 1 OSM element, got {len(elems)}")
    e = elems[0]
    ox, oy, area = osm_centroid(e)
    olon, olat = TO_WGS.transform(ox, oy)

    wd = load("wikidata_Q18068.json")["entities"]["Q18068"]["claims"]["P625"][0]["mainsnak"][
        "datavalue"
    ]["value"]
    wlat, wlon = wd["latitude"], wd["longitude"]
    wx, wy = TO_UTM.transform(wlon, wlat)

    dist = math.hypot(ox - wx, oy - wy)
    org_x, org_y = round(ox), round(oy)
    xmin, ymin, xmax, ymax = org_x - HALF, org_y - HALF, org_x + HALF, org_y + HALF

    print(
        f"OSM element: {e['type']}/{e['id']}  name={e['tags'].get('name')}  osm_base={ov['osm3s']['timestamp_osm_base']}"
    )
    print(f"OSM footprint area (EPSG:32632 m2): {area:.1f}")
    print(f"OSM centroid WGS84 (lat, lon): {olat:.7f}, {olon:.7f}")
    print(f"OSM centroid EPSG:32632 (E, N): {ox:.2f}, {oy:.2f}")
    print("Wikidata: Q18068 P625")
    print(f"Wikidata WGS84 (lat, lon): {wlat:.6f}, {wlon:.6f}")
    print(f"Wikidata EPSG:32632 (E, N): {wx:.2f}, {wy:.2f}")
    print(f"Distance OSM centroid - Wikidata (m): {dist:.1f}")
    print(f"ORIGIN EPSG:32632 (E, N): {org_x}, {org_y}")
    print(
        f"AOI bbox EPSG:32632 (xmin, ymin, xmax, ymax): {xmin:.0f}, {ymin:.0f}, {xmax:.0f}, {ymax:.0f}"
    )
    for name, (x, y) in (
        ("SW", (xmin, ymin)),
        ("SE", (xmax, ymin)),
        ("NE", (xmax, ymax)),
        ("NW", (xmin, ymax)),
    ):
        lon, lat = TO_WGS.transform(x, y)
        print(f"AOI corner {name} WGS84 (lat, lon): {lat:.6f}, {lon:.6f}")


if __name__ == "__main__":
    main()
