import json
import struct

import numpy as np
from milano_iso.tiles import glb


def _mesh(name, n_tri, seed):
    rng = np.random.default_rng(seed)
    n = n_tri * 3
    return {
        "name": name,
        "positions": rng.uniform(-5, 5, (n, 3)).astype(np.float32),
        "normals": np.tile(np.float32([0, 1, 0]), (n, 1)),
        "feature_ids": (np.arange(n) // 3).astype(np.uint32),
        "indices": np.arange(n, dtype=np.uint32),
    }


def _parse(blob):
    magic, version, length = struct.unpack_from("<III", blob, 0)
    jlen, jtype = struct.unpack_from("<II", blob, 12)
    doc = json.loads(blob[20 : 20 + jlen])
    boff = 20 + jlen
    blen, btype = struct.unpack_from("<II", blob, boff)
    return magic, version, length, jlen, jtype, doc, blen, btype, blob[boff + 8 : boff + 8 + blen]


def test_roundtrip_header_alignment_and_minmax():
    meshes = [_mesh("buildings", 5, 1), _mesh("roads", 3, 2)]
    blob = glb.write_glb(meshes)
    magic, version, length, jlen, jtype, doc, blen, btype, bin_data = _parse(blob)
    assert magic == 0x46546C67 and version == 2 and length == len(blob)
    assert jtype == 0x4E4F534A and btype == 0x004E4942
    assert jlen % 4 == 0 and blen % 4 == 0 and length % 4 == 0
    assert len(bin_data) == blen == doc["buffers"][0]["byteLength"]
    assert doc["asset"] == {"generator": "milano-iso", "version": "2.0"}
    assert [m["name"] for m in doc["meshes"]] == ["buildings", "roads"]
    assert [m["name"] for m in doc["materials"]] == ["buildings", "roads"]

    for mesh, src in zip(doc["meshes"], meshes, strict=True):
        prim = mesh["primitives"][0]
        assert set(prim["attributes"]) == {"POSITION", "NORMAL", "_FEATURE_ID"}
        acc = doc["accessors"][prim["attributes"]["POSITION"]]
        view = doc["bufferViews"][acc["bufferView"]]
        assert view["byteOffset"] % 4 == 0
        pos = np.frombuffer(bin_data, "<f4", acc["count"] * 3, view["byteOffset"]).reshape(-1, 3)
        assert np.array_equal(pos, src["positions"])
        assert acc["min"] == [float(v) for v in src["positions"].min(axis=0)]
        assert acc["max"] == [float(v) for v in src["positions"].max(axis=0)]
        fa = doc["accessors"][prim["attributes"]["_FEATURE_ID"]]
        assert fa["componentType"] == 5125
        fv = doc["bufferViews"][fa["bufferView"]]
        fid = np.frombuffer(bin_data, "<u4", fa["count"], fv["byteOffset"])
        assert np.array_equal(fid, src["feature_ids"])
        ia = doc["accessors"][prim["indices"]]
        assert ia["componentType"] == 5125
        iv = doc["bufferViews"][ia["bufferView"]]
        assert iv["target"] == 34963
        idx = np.frombuffer(bin_data, "<u4", ia["count"], iv["byteOffset"])
        assert np.array_equal(idx, src["indices"])


def test_output_is_byte_identical_across_calls():
    meshes = [_mesh("green", 4, 3)]
    assert glb.write_glb(meshes) == glb.write_glb(meshes)
