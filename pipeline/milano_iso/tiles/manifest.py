"""tiles.json manifest (T-2.3): a deterministic description of one tile directory.

Sorted keys, LF, no timestamps. Validated against ``tiles.schema.json`` (same directory).
"""

import copy
import gzip
import hashlib
import json
from pathlib import Path

from milano_iso import config
from milano_iso.tiles import grid

FORMAT_VERSION = 2  # T-6.3: tiles.json is a small root; the tile entries live in shards/
SCHEMA_PATH = Path(__file__).with_name("tiles.schema.json")
MANIFEST_NAME = "tiles.json"
SHARD_DIR = "shards"
# A shard holds the tiles whose cell centre falls in one square of SHARD_FACTOR x block_m of their
# level (ADR-0038): 8 x 250 m = 2 km at level 0 (64 tiles), 4 km at level 1, 8 km at level 2.
SHARD_FACTOR = 8
CRS = "EPSG:32632"  # CLAUDE.md hard rule 6
QUANT_UNIT_M = 0.02  # ADR-0022 point 2a; equal to glb.QUANT_SCALE (tested)
AXIS = "x=E-E0, y=up, z=-(N-N0)"
# Wording from docs/DATA_SOURCES.md: OSM licence ODbL 1.0 (rows 1, 1b) and the copyright line of
# CLAUDE.md hard rule 10; DBT 2020 of the Comune di Milano, CC BY 4.0 (row 3b, quoted page text).
ATTRIBUTION = [
    {
        "source": "OpenStreetMap",
        "licence": "ODbL 1.0",
        "text": "(c) OpenStreetMap contributors",
    },
    {
        "source": "Comune di Milano, Database Topografico (DBT) 2020",
        "licence": "CC BY 4.0",
        "text": "Comune di Milano, DBT 2020, licenza Creative Commons Attribuzione 4.0 "
        "Internazionale (CC BY 4.0)",
    },
]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_bytes(obj: dict) -> bytes:
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return (s + "\n").encode("utf-8")


def file_entry(path: Path) -> dict:
    """Manifest entry of a standalone file (index.json, minimap.svg): name, sizes, sha256."""
    blob = path.read_bytes()
    return {
        "file": path.name,
        "bytes": len(blob),
        "gzip9_bytes": len(gzip.compress(blob, 9, mtime=0)),
        "sha256": hashlib.sha256(blob).hexdigest(),
    }


def tile_entry(
    out_dir: Path,
    name: str,
    i: int,
    j: int,
    counts: dict[str, int],
    content_bbox_local: dict,
    size: float = config.TILE_SIZE_M,
) -> dict:
    """Manifest entry of tile ``name``; reads its .glb and .json files from ``out_dir``.

    ``size`` is the cell size (the base tile, or the block of a coarse level, T-6.2).
    """
    glb_path, feat_path = out_dir / f"{name}.glb", out_dir / f"{name}.json"
    blob = glb_path.read_bytes()
    xmin, ymin, xmax, ymax = grid.tile_bbox_local(i, j, size)
    return {
        "id": name,
        "i": i,
        "j": j,
        # [xmin, zmin, xmax, zmax], z = -(N - N0); 0.0 - v avoids -0.0
        "bbox_local": [xmin, 0.0 - ymax, xmax, 0.0 - ymin],
        "bbox_epsg32632": list(grid.tile_bbox(i, j, size=size)),
        "counts": dict(sorted(counts.items())),
        # extent of the decoded vertices, client frame [x, y, z]; may exceed bbox_local (overhang)
        "content_bbox_local": content_bbox_local,
        "glb": {
            "file": glb_path.name,
            "bytes": len(blob),
            "gzip9_bytes": len(gzip.compress(blob, 9, mtime=0)),
            "sha256": hashlib.sha256(blob).hexdigest(),
        },
        "features": {
            "file": feat_path.name,
            "bytes": feat_path.stat().st_size,
            "sha256": sha256_file(feat_path),
        },
    }


def build_manifest(
    entries: list[dict],
    layers: list[str],
    instanced_layers: list[str] | None = None,
    index: dict | None = None,
    minimap: dict | None = None,
    levels: list[dict] | None = None,
) -> dict:
    entries = sorted(entries, key=lambda e: e["id"])
    counts: dict[str, int] = {}
    for e in entries:
        for k, v in e["counts"].items():
            counts[k] = counts.get(k, 0) + v
    extra = {}
    if index is not None:
        extra["index"] = index  # T-5.3a: search index file entry
    if minimap is not None:
        extra["minimap"] = minimap  # T-5.3a: minimap drawing file entry
    if levels:
        extra["levels"] = levels  # T-6.2: level 0 (the base tiles above) and the coarse levels
    return {
        **extra,
        "format_version": FORMAT_VERSION,
        "crs": CRS,
        "origin": {"e": config.ORIGIN_E, "n": config.ORIGIN_N},
        "tile_size_m": config.TILE_SIZE_M,
        "axis": AXIS,
        "quantization": {"unit_m": QUANT_UNIT_M, "anchor": "tile_center"},
        "layers": list(layers),
        # layers without a mesh in the glb: their feature table rows carry x, z per instance
        "instanced_layers": list(instanced_layers or []),
        "attribution": copy.deepcopy(ATTRIBUTION),
        "tiles": entries,
        "totals": {
            "tiles": len(entries),
            "counts": dict(sorted(counts.items())),
            "glb_bytes": sum(e["glb"]["bytes"] for e in entries),
            "gzip9_bytes": sum(e["glb"]["gzip9_bytes"] for e in entries),
            "features_bytes": sum(e["features"]["bytes"] for e in entries),
        },
    }


def _bbox3_union(boxes: list[dict]) -> dict:
    return {
        "min": [min(b["min"][k] for b in boxes) for k in range(3)],
        "max": [max(b["max"][k] for b in boxes) for k in range(3)],
    }


def shard_id(level: int, a: int, b: int) -> str:
    return f"S{level}_{a}_{b}"


def split_manifest(full: dict, factor: int = SHARD_FACTOR) -> tuple[dict, dict[str, dict]]:
    """Split the full manifest (``build_manifest``) into the root tiles.json and its shards.

    Returns ``(root, shards)``; ``shards`` maps the file name (``shards/S<level>_<a>_<b>.json``)
    to the shard document. The root is the full manifest without the tile entries (``tiles`` and
    ``levels[].tiles``) plus ``bounds_local`` (the ground extent of the base tiles, for the camera)
    and ``shards`` (level, id, file, size, sha256, tile count and content box of every shard, sorted
    by level then id). A shard is a literal slice of the full manifest: the same tile entries.
    """
    levels = full.get("levels") or []
    block = {lv["level"]: lv["block_m"] for lv in levels}
    block.setdefault(0, full["tile_size_m"])
    by_level: dict[int, list[dict]] = {0: full["tiles"]}
    for lv in levels:
        if lv["level"] > 0:
            by_level[lv["level"]] = lv["tiles"]
    cells: dict[tuple[int, int, int], list[dict]] = {}
    for level, tiles in sorted(by_level.items()):
        size = block[level] * factor
        for t in tiles:
            x0, z0, x1, z1 = t["bbox_local"]
            key = (level, int(((x0 + x1) / 2) // size), int(((z0 + z1) / 2) // size))
            cells.setdefault(key, []).append(t)
    shards: dict[str, dict] = {}
    records = []
    for (level, a, b), tiles in sorted(cells.items(), key=lambda kv: (kv[0][0], shard_id(*kv[0]))):
        tiles = sorted(tiles, key=lambda t: t["id"])
        doc = {"format_version": FORMAT_VERSION, "id": shard_id(level, a, b), "level": level}
        doc["tiles"] = tiles
        blob = manifest_bytes(doc)
        name = f"{SHARD_DIR}/{doc['id']}.json"
        shards[name] = doc
        records.append(
            {
                "level": level,
                "id": doc["id"],
                "file": name,
                "bytes": len(blob),
                "gzip9_bytes": len(gzip.compress(blob, 9, mtime=0)),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "tiles": len(tiles),
                "content_bbox_local": _bbox3_union([t["content_bbox_local"] for t in tiles]),
            }
        )
    root = copy.deepcopy({k: v for k, v in full.items() if k != "tiles"})
    for lv in root.get("levels", []):
        lv.pop("tiles", None)
    base = _bbox3_union([t["content_bbox_local"] for t in full["tiles"]])
    root["bounds_local"] = [base["min"][0], base["min"][2], base["max"][0], base["max"][2]]
    root["shards"] = records
    return root, shards


def join_manifest(root: dict, read_shard) -> dict:
    """Inverse of ``split_manifest``: ``read_shard(file)`` returns the parsed shard document."""
    full = copy.deepcopy({k: v for k, v in root.items() if k not in ("shards", "bounds_local")})
    per_level: dict[int, list[dict]] = {}
    for rec in root["shards"]:
        per_level.setdefault(rec["level"], []).extend(read_shard(rec["file"])["tiles"])
    full["tiles"] = sorted(per_level.get(0, []), key=lambda t: t["id"])
    for lv in full.get("levels", []):
        if lv["level"] > 0:
            lv["tiles"] = sorted(per_level.get(lv["level"], []), key=lambda t: t["id"])
    return full


def load_full(out_dir: Path) -> dict:
    """Read tiles.json and every shard of ``out_dir`` and return the full manifest."""
    root = json.loads((out_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
    return join_manifest(root, lambda f: json.loads((out_dir / f).read_text(encoding="utf-8")))


def write_manifest(out_dir: Path, manifest: dict, factor: int = SHARD_FACTOR) -> Path:
    """Write the root tiles.json and ``shards/`` (a stale shards directory is replaced)."""
    root, shards = split_manifest(manifest, factor)
    shard_dir = out_dir / SHARD_DIR
    if shard_dir.exists():
        for old in sorted(shard_dir.glob("*.json")):
            old.unlink()
    shard_dir.mkdir(parents=True, exist_ok=True)
    for name, doc in shards.items():
        (out_dir / name).write_bytes(manifest_bytes(doc))
    p = out_dir / MANIFEST_NAME
    p.write_bytes(manifest_bytes(root))
    return p
