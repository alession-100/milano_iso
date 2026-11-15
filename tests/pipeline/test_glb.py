import json
import struct

import numpy as np
import pytest
from milano_iso.tiles import glb

CENTRE = (250.0, -250.0)  # tile 0_0 centre in client metres


def _mesh(name, n_vertices, seed, spread=200.0):
    rng = np.random.default_rng(seed)
    pos = rng.uniform(-spread, spread, (n_vertices, 3))
    pos[:, 1] = rng.uniform(0, 100, n_vertices)
    pos += np.array([CENTRE[0], 0.0, CENTRE[1]])
    idx = np.arange(n_vertices - n_vertices % 3, dtype=np.int64)
    return {
        "name": name,
        "positions": pos,
        "feature_ids": np.arange(n_vertices) // 3,
        "indices": idx,
    }


def _parse(blob):
    magic, version, length = struct.unpack_from("<III", blob, 0)
    jlen, jtype = struct.unpack_from("<II", blob, 12)
    doc = json.loads(blob[20 : 20 + jlen])
    boff = 20 + jlen
    blen, btype = struct.unpack_from("<II", blob, boff)
    return magic, version, length, jlen, jtype, doc, blen, btype, blob[boff + 8 : boff + 8 + blen]


def _read(doc, bin_data, acc_i, dtype, width):
    acc = doc["accessors"][acc_i]
    view = doc["bufferViews"][acc["bufferView"]]
    stride = view.get("byteStride", np.dtype(dtype).itemsize * width)
    raw = np.frombuffer(bin_data, np.uint8, view["byteLength"], view["byteOffset"])
    out = np.empty((acc["count"], width), dtype=dtype)
    for n in range(acc["count"]):
        out[n] = np.frombuffer(raw[n * stride :], dtype, width)
    return acc, view, out


def test_quantised_roundtrip_header_alignment_extension_and_error():
    meshes = [_mesh("buildings", 300, 1), _mesh("roads", 60, 2)]
    blob = glb.write_glb(meshes, CENTRE, 100)
    magic, version, length, jlen, jtype, doc, blen, btype, bin_data = _parse(blob)
    assert magic == 0x46546C67 and version == 2 and length == len(blob)
    assert jtype == 0x4E4F534A and btype == 0x004E4942
    assert jlen % 4 == 0 and blen % 4 == 0 and length % 4 == 0
    assert len(bin_data) == blen == doc["buffers"][0]["byteLength"]
    assert doc["extensionsUsed"] == ["KHR_mesh_quantization"]
    assert doc["extensionsRequired"] == ["KHR_mesh_quantization"]
    assert [m["name"] for m in doc["meshes"]] == ["buildings", "roads"]

    for mesh, node, src in zip(doc["meshes"], doc["nodes"], meshes, strict=True):
        assert node["scale"] == [0.01] * 3
        assert node["translation"] == [CENTRE[0], 0.0, CENTRE[1]]
        prim = mesh["primitives"][0]
        assert set(prim["attributes"]) == {"POSITION", "_FEATURE_ID"}
        acc, view, q = _read(doc, bin_data, prim["attributes"]["POSITION"], "<i2", 3)
        assert acc["componentType"] == 5122 and "normalized" not in acc
        assert view["byteOffset"] % 4 == 0 and view["byteStride"] % 4 == 0
        assert acc["min"] == q.min(axis=0).tolist() and acc["max"] == q.max(axis=0).tolist()
        back = q * 0.01 + np.array([node["translation"][0], 0.0, node["translation"][2]])
        err = np.abs(back - src["positions"]).max()
        assert err <= 0.005 + 1e-9  # half a centimetre
        assert err > 0  # genuinely quantised
        _, _, fid = _read(doc, bin_data, prim["attributes"]["_FEATURE_ID"], "<u2", 1)
        assert np.array_equal(fid[:, 0], src["feature_ids"])
        _, iv, idx = _read(doc, bin_data, prim["indices"], "<u2", 1)
        assert iv["target"] == 34963 and iv["byteOffset"] % 4 == 0
        assert np.array_equal(idx[:, 0], src["indices"])


def test_dequantise_helper_matches_error_bound():
    m = _mesh("x", 90, 3)
    q = glb.quantise(m["positions"], CENTRE)
    assert q.dtype == np.int16
    assert np.abs(glb.dequantise(q, CENTRE) - m["positions"]).max() <= 0.005 + 1e-9


def test_out_of_range_coordinate_raises():
    m = _mesh("x", 9, 4)
    m["positions"][0, 0] = CENTRE[0] + 327.68  # one unit past int16
    with pytest.raises(ValueError, match="out of int16 range"):
        glb.write_glb([m], CENTRE, 10)
    m["positions"][0, 0] = CENTRE[0] + 327.67  # last representable value
    glb.write_glb([m], CENTRE, 10)


def _index_component(n_vertices):
    pos = np.zeros((n_vertices, 3)) + np.array([CENTRE[0], 0.0, CENTRE[1]])
    mesh = {
        "name": "m",
        "positions": pos,
        "feature_ids": np.zeros(n_vertices, dtype=np.int64),
        "indices": np.array([0, 1, 2]),
    }
    doc = _parse(glb.write_glb([mesh], CENTRE, 1))[5]
    return doc["accessors"][doc["meshes"][0]["primitives"][0]["indices"]]["componentType"]


def test_index_type_switches_at_65536_vertices():
    assert _index_component(65535) == 5123  # uint16
    assert _index_component(65536) == 5125  # uint32


def test_feature_id_type_switches_at_65536_features():
    m = _mesh("x", 9, 5)
    for n_features, comp in ((65535, 5123), (65536, 5125)):
        doc = _parse(glb.write_glb([m], CENTRE, n_features))[5]
        attrs = doc["meshes"][0]["primitives"][0]["attributes"]
        assert doc["accessors"][attrs["_FEATURE_ID"]]["componentType"] == comp


def test_output_is_byte_identical_across_calls():
    meshes = [_mesh("green", 12, 6)]
    assert glb.write_glb(meshes, CENTRE, 4) == glb.write_glb(meshes, CENTRE, 4)
