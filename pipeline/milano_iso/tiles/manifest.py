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

FORMAT_VERSION = 1
SCHEMA_PATH = Path(__file__).with_name("tiles.schema.json")
MANIFEST_NAME = "tiles.json"
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


def write_manifest(out_dir: Path, manifest: dict) -> Path:
    p = out_dir / MANIFEST_NAME
    p.write_bytes(manifest_bytes(manifest))
    return p
