"""Independent decoder of the tile .glb files written by milano_iso.tiles.glb (T-2.5).

Reads the binary the way a client does: int16 POSITION times the node scale plus the node
translation, ``_FEATURE_ID`` and indices from the accessors. Client frame: x = E - E0, y = up,
z = -(N - N0).
"""

import json
import struct
from pathlib import Path

import numpy as np

_DTYPES = {5122: np.int16, 5123: np.uint16, 5125: np.uint32}


def _accessor(doc: dict, bin_data: bytes, k: int, width: int) -> np.ndarray:
    """Accessor ``k`` as an (count, width) array; honours byteStride."""
    acc = doc["accessors"][k]
    view = doc["bufferViews"][acc["bufferView"]]
    dt = np.dtype(_DTYPES[acc["componentType"]]).newbyteorder("<")
    stride = view.get("byteStride", dt.itemsize * width)
    n = acc["count"]
    buf = bin_data[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
    per = stride // dt.itemsize
    raw = np.frombuffer(buf, dtype=dt, count=(n - 1) * per + width).copy()
    out = np.zeros((n, width), dtype=dt)
    for c in range(width):
        out[:, c] = raw[c : c + (n - 1) * per + 1 : per]
    return out


def decode_glb(path: Path) -> list[dict]:
    """One dict per mesh: name, q (int16 units), positions (client metres), fid, tris (m, 3)."""
    data = Path(path).read_bytes()
    magic, version, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2 and total == len(data), path
    jlen, jtype = struct.unpack_from("<II", data, 12)
    assert jtype == 0x4E4F534A
    doc = json.loads(data[20 : 20 + jlen])
    blen, btype = struct.unpack_from("<II", data, 20 + jlen)
    assert btype == 0x004E4942
    bin_data = data[28 + jlen : 28 + jlen + blen]
    out = []
    for node in doc["nodes"]:
        prim = doc["meshes"][node["mesh"]]["primitives"][0]
        q = _accessor(doc, bin_data, prim["attributes"]["POSITION"], 3)
        fid = _accessor(doc, bin_data, prim["attributes"]["_FEATURE_ID"], 1)[:, 0]
        idx = _accessor(doc, bin_data, prim["indices"], 1)[:, 0].astype(np.int64)
        pos = q.astype(np.float64) * np.array(node["scale"]) + np.array(node["translation"])
        out.append(
            {
                "name": node["name"],
                "layer": node["name"].split("#")[0],
                "q": q,
                "positions": pos,
                "fid": fid.astype(np.int64),
                "tris": idx.reshape(-1, 3),
            }
        )
    return out
