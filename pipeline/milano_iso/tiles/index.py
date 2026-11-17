"""Search index of named features (T-5.3a): the content of ``index.json``.

Pure functions on local-frame shapely geometries (x = E - E0, y = N - N0; the output frame is the
client frame, x and z = -y, metres, rounded to 0.1 m). Names are copied exactly as in the source
(ADR-0006: no translation, no accent folding; the client folds them).

Entry kinds, in sort order: building, street, green, water, landmark. A building that carries a
``landmark_id`` is represented only by the landmark entry, named from ``tests/landmarks.yaml``, so
a name transferred to the building from OSM can never shadow the landmark's own name.

``ref`` per kind: building ``{"key"}``; street ``{"osm_ids": {"w": [...], "r": [...]}}`` (all
ways and relations of that name, sorted; one street can mix both, e.g. a square); green and water
``{"osm_type", "osm_id"}``; landmark ``{"landmark_id"}``. ``centre`` is the area centroid of the
rendered pieces; for streets it is the centroid of the piece nearest to the bbox centre.
"""

import json

import shapely
import yaml

from milano_iso.heights import LANDMARKS_FILE

INDEX_NAME = "index.json"
INDEX_FORMAT_VERSION = 1
KIND_ORDER = ("building", "street", "green", "water", "landmark")
GRID_M = 0.1


def load_landmark_names(path=LANDMARKS_FILE) -> dict[str, str]:
    """{landmark id: name} from tests/landmarks.yaml."""
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {r["id"]: r["name"] for r in data["landmarks"]}


def _r(v: float) -> float:
    return round(v, 1) + 0.0  # + 0.0 turns -0.0 into 0.0


def _has_name(name) -> bool:
    return isinstance(name, str) and name.strip() != ""


def _bbox_xz(geoms) -> list[float]:
    minx, miny, maxx, maxy = (float(v) for v in shapely.total_bounds(list(geoms)))
    return [_r(minx), _r(-maxy), _r(maxx), _r(-miny)]


def _centroid_xz(geoms) -> list[float]:
    c = shapely.GeometryCollection(list(geoms)).centroid
    return [_r(c.x), _r(-c.y)]


def _bbox_centre_xz(bbox: list[float]) -> list[float]:
    return [_r((bbox[0] + bbox[2]) / 2), _r((bbox[1] + bbox[3]) / 2)]


def _street_centre_xz(geoms, bbox: list[float]) -> list[float]:
    """Centroid of the street piece nearest to the bbox centre: a point on the street itself.

    Ties are broken by the rounded coordinates, so the choice does not depend on input order.
    """
    bc = _bbox_centre_xz(bbox)
    cands = []
    for g in geoms:
        c = _centroid_xz([g])
        cands.append((round(((c[0] - bc[0]) ** 2 + (c[1] - bc[1]) ** 2) ** 0.5, 1), c[0], c[1]))
    return list(min(cands)[1:])


def _entry(name, kind, geoms, tiles, ref, *, street=False) -> dict:
    bbox = _bbox_xz(geoms)
    return {
        "name": name,
        "kind": kind,
        "centre": _street_centre_xz(geoms, bbox) if street else _centroid_xz(geoms),
        "bbox": bbox,
        "tiles": sorted(tiles),
        "ref": ref,
    }


def build_entries(
    buildings: list[dict],
    streets: list[dict],
    areas: list[dict],
    landmark_names: dict[str, str],
    roof_landmarks: list[dict] | None = None,
) -> list[dict]:
    """Sorted index entries.

    ``buildings``: rendered buildings, dicts with key, name, landmark_id, geom, tile.
    ``streets``: rendered above-ground roads, dicts with osm_type, osm_id, name, geoms, tiles.
    ``areas``: rendered green and water features, dicts with kind ("green" | "water"), osm_type,
    osm_id, name, geoms, tiles. ``geoms`` are the rendered (clipped) pieces, local frame.
    ``roof_landmarks``: landmarks without a rendered building of their own (the Galleria), dicts
    with landmark_id, geom (the roof footprint), tiles (where their details are drawn).
    """
    out: list[dict] = []
    landmarks: dict[str, dict] = {}
    for b in buildings:
        lid = b["landmark_id"]
        if lid is not None:
            if lid not in landmark_names:
                raise ValueError(f"landmark {lid!r} is not in tests/landmarks.yaml")
            g = landmarks.setdefault(lid, {"geoms": [], "tiles": set()})
            g["geoms"].append(b["geom"])
            g["tiles"].add(b["tile"])
        elif _has_name(b["name"]):
            out.append(_entry(b["name"], "building", [b["geom"]], [b["tile"]], {"key": b["key"]}))
    for r in roof_landmarks or []:
        lid = r["landmark_id"]
        if lid not in landmark_names:
            raise ValueError(f"landmark {lid!r} is not in tests/landmarks.yaml")
        g = landmarks.setdefault(lid, {"geoms": [], "tiles": set()})
        g["geoms"].append(r["geom"])
        g["tiles"].update(r["tiles"])
    for lid, g in landmarks.items():
        out.append(
            _entry(landmark_names[lid], "landmark", g["geoms"], g["tiles"], {"landmark_id": lid})
        )

    by_name: dict[str, dict] = {}
    for s in streets:
        if not _has_name(s["name"]):
            continue
        g = by_name.setdefault(s["name"], {"geoms": [], "tiles": set(), "ids": set()})
        g["geoms"].extend(s["geoms"])
        g["tiles"].update(s["tiles"])
        g["ids"].add((s["osm_type"], int(s["osm_id"])))
    for name, g in by_name.items():
        ids: dict[str, list[int]] = {}
        for t, i in sorted(g["ids"]):
            ids.setdefault(t, []).append(i)
        out.append(
            _entry(
                name,
                "street",
                g["geoms"],
                g["tiles"],
                {"osm_ids": ids},
                street=True,
            )
        )

    for a in areas:
        if _has_name(a["name"]):
            ref = {"osm_type": a["osm_type"], "osm_id": int(a["osm_id"])}
            out.append(_entry(a["name"], a["kind"], a["geoms"], a["tiles"], ref))

    def sort_key(e):
        return (KIND_ORDER.index(e["kind"]), e["name"], json.dumps(e["ref"], sort_keys=True))

    return sorted(out, key=sort_key)


def index_document(entries: list[dict]) -> dict:
    return {
        "format_version": INDEX_FORMAT_VERSION,
        "frame": "x=E-E0, z=-(N-N0), metres, 0.1 m",
        "kinds": list(KIND_ORDER),
        "entries": entries,
    }
