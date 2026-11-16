import json

import pytest
from milano_iso import config
from milano_iso.tiles import glb, manifest, schema_check

SCHEMA = json.loads(manifest.SCHEMA_PATH.read_text(encoding="utf-8"))


def _tile(out, name, i, j, blob=b"glTF", feat=b"{}\n"):
    (out / f"{name}.glb").write_bytes(blob)
    (out / f"{name}.json").write_bytes(feat)
    return manifest.tile_entry(out, name, i, j, {"buildings": 2, "roads": 1})


@pytest.fixture
def man(tmp_path):
    entries = [_tile(tmp_path, "1_0", 1, 0), _tile(tmp_path, "-1_-1", -1, -1)]
    return manifest.build_manifest(entries, ["buildings", "roads"])


def test_manifest_is_valid_sorted_and_summed(man):
    assert schema_check.validate(man, SCHEMA) == []
    assert [t["id"] for t in man["tiles"]] == ["-1_-1", "1_0"]
    assert man["totals"]["counts"] == {"buildings": 4, "roads": 2}
    assert man["tile_size_m"] == config.TILE_SIZE_M
    assert man["quantization"]["unit_m"] == glb.QUANT_SCALE


def test_bbox_local_uses_z_down_north(man):
    t = man["tiles"][1]  # tile 1_0
    s = config.TILE_SIZE_M
    assert t["bbox_local"] == [s, -s, 2 * s, 0.0]
    assert t["bbox_epsg32632"] == [
        config.ORIGIN_E + s,
        config.ORIGIN_N,
        config.ORIGIN_E + 2 * s,
        config.ORIGIN_N + s,
    ]


def test_bytes_are_deterministic_lf_without_timestamps(man):
    a = manifest.manifest_bytes(man)
    assert a == manifest.manifest_bytes(json.loads(a))
    assert a.endswith(b"\n")
    assert b"\r" not in a


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m.pop("totals"),
        lambda m: m.update(extra=1),
        lambda m: m["tiles"][0]["glb"].update(sha256="xyz"),
        lambda m: m["tiles"][0].update(bbox_local=[1, 2, 3]),
        lambda m: m.update(crs="EPSG:4326"),
        lambda m: m["tiles"][0]["counts"].update(roads=-1),
        lambda m: m["tiles"][0].update(i="0"),
        lambda m: m["attribution"].pop(),
    ],
)
def test_schema_rejects_broken_manifests(man, mutate):
    mutate(man)
    assert schema_check.validate(man, SCHEMA)


def test_validator_rejects_unknown_keyword():
    with pytest.raises(ValueError):
        schema_check.validate(1, {"oneOf": []})
