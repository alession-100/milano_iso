"""Minimal deterministic glTF 2.0 binary writer (ADR-0021). No timestamps, sorted JSON keys."""

import json
import struct

import numpy as np

GLB_MAGIC = 0x46546C67  # "glTF"
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
FLOAT = 5126
UNSIGNED_INT = 5125
GENERATOR = "milano-iso"


def _pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * (-len(b) % 4)


def write_glb(meshes: list[dict]) -> bytes:
    """meshes: dicts with name, positions (n,3) f32, normals (n,3) f32, feature_ids (n,) u32,
    indices (m,) u32. One node, mesh, primitive and material per entry, named after it."""
    bin_data = bytearray()
    views, accessors, gl_meshes, nodes, materials = [], [], [], [], []

    def add(arr: np.ndarray, comp: int, ctype: str, target: int, with_minmax: bool) -> int:
        raw = np.ascontiguousarray(arr).astype(arr.dtype.newbyteorder("<")).tobytes()
        off = len(bin_data)
        bin_data.extend(raw)
        bin_data.extend(b"\0" * (-len(bin_data) % 4))
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(raw), "target": target})
        acc = {
            "bufferView": len(views) - 1,
            "componentType": comp,
            "count": int(arr.shape[0]),
            "type": ctype,
        }
        if with_minmax:
            acc["min"] = [float(v) for v in arr.min(axis=0)]
            acc["max"] = [float(v) for v in arr.max(axis=0)]
        accessors.append(acc)
        return len(accessors) - 1

    for k, m in enumerate(meshes):
        pos = np.asarray(m["positions"], dtype=np.float32)
        nrm = np.asarray(m["normals"], dtype=np.float32)
        fid = np.asarray(m["feature_ids"], dtype=np.uint32)
        idx = np.asarray(m["indices"], dtype=np.uint32)
        a_pos = add(pos, FLOAT, "VEC3", ARRAY_BUFFER, True)
        a_nrm = add(nrm, FLOAT, "VEC3", ARRAY_BUFFER, False)
        a_fid = add(fid, UNSIGNED_INT, "SCALAR", ARRAY_BUFFER, False)
        a_idx = add(idx, UNSIGNED_INT, "SCALAR", ELEMENT_ARRAY_BUFFER, False)
        materials.append({"name": m["name"]})
        gl_meshes.append(
            {
                "name": m["name"],
                "primitives": [
                    {
                        "attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "_FEATURE_ID": a_fid},
                        "indices": a_idx,
                        "material": k,
                        "mode": 4,
                    }
                ],
            }
        )
        nodes.append({"name": m["name"], "mesh": k})

    doc = {
        "asset": {"version": "2.0", "generator": GENERATOR},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gl_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_data)}],
    }
    js = _pad(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode("utf-8"), b" ")
    bn = _pad(bytes(bin_data), b"\0")
    total = 12 + 8 + len(js) + 8 + len(bn)
    return (
        struct.pack("<III", GLB_MAGIC, 2, total)
        + struct.pack("<II", len(js), CHUNK_JSON)
        + js
        + struct.pack("<II", len(bn), CHUNK_BIN)
        + bn
    )
