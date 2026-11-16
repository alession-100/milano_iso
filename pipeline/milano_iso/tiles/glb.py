"""Minimal deterministic glTF 2.0 binary writer (ADR-0021). No timestamps, sorted JSON keys."""

import json
import struct

import numpy as np

GLB_MAGIC = 0x46546C67  # "glTF"
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125
SHORT = 5122
GENERATOR = "milano-iso"
EXTENSION = "KHR_mesh_quantization"
QUANT_SCALE = 0.02  # one int16 unit is 2 cm (ADR-0022 point 2a)
INT16_MAX = 32767
UINT16_LIMIT = 65536


def _pad(b: bytes, fill: bytes) -> bytes:
    return b + fill * (-len(b) % 4)


def quantise(positions: np.ndarray, centre: tuple[float, float]) -> np.ndarray:
    """int16 offsets in 2 cm units from the tile centre (cx, cz) at y = 0. Raises when out of range."""
    off = np.asarray(positions, dtype=np.float64) - np.array([centre[0], 0.0, centre[1]])
    q = np.rint(off / QUANT_SCALE)
    if np.abs(q).max() > INT16_MAX:
        raise ValueError(
            f"position out of int16 range (+/-{INT16_MAX * QUANT_SCALE:.2f} m from the tile "
            f"centre): max offset {np.abs(off).max():.3f} m"
        )
    return q.astype(np.int16)


def dequantise(q: np.ndarray, centre: tuple[float, float]) -> np.ndarray:
    """Client-frame metres from int16 values, as a node (translation, scale 0.02) does."""
    return q.astype(np.float64) * QUANT_SCALE + np.array([centre[0], 0.0, centre[1]])


def write_glb(meshes: list[dict], centre: tuple[float, float], n_features: int) -> bytes:
    """meshes: dicts with name, positions (n,3) float64 in client metres, feature_ids (n,) and
    indices (m,). One node, mesh, primitive and material per entry, named after it.

    Positions are stored as int16 2 cm units from ``centre`` (x, z of the tile centre in client
    metres); each node has translation (cx, 0, cz) and scale 0.02 (KHR_mesh_quantization).
    Indices are uint16 below 65,536 vertices, else uint32; ``_FEATURE_ID`` is uint16 when
    ``n_features`` < 65,536, else uint32. The int16 POSITION view uses byteStride 8 (6 data bytes
    plus 2 padding) and a uint16 ``_FEATURE_ID`` view byteStride 4 (2 plus 2 padding), so every
    vertex attribute is 4-byte aligned as the Khronos validator requires; the index views and a
    uint32 ``_FEATURE_ID`` are tightly packed.
    """
    bin_data = bytearray()
    views, accessors, gl_meshes, nodes, materials = [], [], [], [], []

    def add(arr, comp, ctype, target, stride=None, minmax=None, count=None) -> int:
        raw = np.ascontiguousarray(arr).astype(arr.dtype.newbyteorder("<")).tobytes()
        off = len(bin_data)
        bin_data.extend(raw)
        bin_data.extend(b"\0" * (-len(bin_data) % 4))
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(raw), "target": target}
        if stride:
            view["byteStride"] = stride
        views.append(view)
        acc = {
            "bufferView": len(views) - 1,
            "componentType": comp,
            "count": int(arr.shape[0] if count is None else count),
            "type": ctype,
        }
        if minmax is not None:
            acc["min"], acc["max"] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    fid_dtype = np.uint16 if n_features < UINT16_LIMIT else np.uint32
    fid_comp = UNSIGNED_SHORT if fid_dtype is np.uint16 else UNSIGNED_INT
    for k, m in enumerate(meshes):
        q = quantise(m["positions"], centre)
        n = len(q)
        padded = np.zeros((n, 4), dtype=np.int16)
        padded[:, :3] = q
        fid = np.asarray(m["feature_ids"])
        if fid.max() >= np.iinfo(fid_dtype).max + 1:
            raise ValueError("feature id out of range")
        fid = fid.astype(fid_dtype)
        idx_dtype = np.uint16 if n < UINT16_LIMIT else np.uint32
        idx = np.asarray(m["indices"]).astype(idx_dtype)
        a_pos = add(
            padded,
            SHORT,
            "VEC3",
            ARRAY_BUFFER,
            stride=8,
            minmax=([int(v) for v in q.min(axis=0)], [int(v) for v in q.max(axis=0)]),
            count=n,
        )
        if fid_dtype is np.uint16:
            # Khronos validator (MESH_PRIMITIVE_ACCESSOR_UNALIGNED): every vertex attribute
            # element must start on a 4-byte boundary, so a 2-byte id gets byteStride 4.
            fid_pad = np.zeros((n, 2), dtype=np.uint16)
            fid_pad[:, 0] = fid
            a_fid = add(fid_pad, fid_comp, "SCALAR", ARRAY_BUFFER, stride=4, count=n)
        else:
            a_fid = add(fid, fid_comp, "SCALAR", ARRAY_BUFFER)
        a_idx = add(
            idx,
            UNSIGNED_SHORT if idx_dtype is np.uint16 else UNSIGNED_INT,
            "SCALAR",
            ELEMENT_ARRAY_BUFFER,
        )
        materials.append({"name": m["name"]})
        gl_meshes.append(
            {
                "name": m["name"],
                "primitives": [
                    {
                        "attributes": {"POSITION": a_pos, "_FEATURE_ID": a_fid},
                        "indices": a_idx,
                        "material": k,
                        "mode": 4,
                    }
                ],
            }
        )
        nodes.append(
            {
                "name": m["name"],
                "mesh": k,
                "scale": [QUANT_SCALE] * 3,
                "translation": [float(centre[0]), 0.0, float(centre[1])],
            }
        )

    doc = {
        "asset": {"version": "2.0", "generator": GENERATOR},
        "extensionsUsed": [EXTENSION],
        "extensionsRequired": [EXTENSION],
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
