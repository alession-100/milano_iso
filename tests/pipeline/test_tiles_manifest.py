import copy
import json

import pytest
from milano_iso import config
from milano_iso.tiles import glb, manifest, schema_check

SCHEMA = json.loads(manifest.SCHEMA_PATH.read_text(encoding="utf-8"))


BBOX3 = {"min": [0.0, 0.0, -1.0], "max": [2.0, 3.0, 4.0]}


def _tile(out, name, i, j, blob=b"glTF", feat=b"{}\n"):
    (out / f"{name}.glb").write_bytes(blob)
    (out / f"{name}.json").write_bytes(feat)
    return manifest.tile_entry(out, name, i, j, {"buildings": 2, "roads": 1}, BBOX3)


@pytest.fixture
def man(tmp_path):
    entries = [_tile(tmp_path, "1_0", 1, 0), _tile(tmp_path, "-1_-1", -1, -1)]
    (tmp_path / "index.json").write_bytes(b"{}\n")
    (tmp_path / "minimap.svg").write_bytes(b"<svg/>\n")
    return copy.deepcopy(
        manifest.build_manifest(
            entries,
            ["buildings", "roads"],
            index=manifest.file_entry(tmp_path / "index.json"),
            minimap=manifest.file_entry(tmp_path / "minimap.svg"),
        )
    )


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
        lambda m: m["tiles"][0].pop("content_bbox_local"),
        lambda m: m["tiles"][0]["content_bbox_local"].update(min=[1, 2]),
        lambda m: m["attribution"].pop(),
        lambda m: m.pop("index"),
        lambda m: m.pop("minimap"),
        lambda m: m["index"].update(sha256="xyz"),
        lambda m: m["minimap"].pop("gzip9_bytes"),
    ],
)
def test_schema_rejects_broken_manifests(man, mutate):
    mutate(man)
    assert schema_check.validate(man, SCHEMA)


def test_validator_rejects_unknown_keyword():
    with pytest.raises(ValueError):
        schema_check.validate(1, {"oneOf": []})


def test_empty_tile_is_skipped_not_written_as_zero_byte_glb(tmp_path):
    from milano_iso.tiles import export

    assert export.write_tile(tmp_path, "5_5", 5, 5, [], {}, {}, (0.0, 0.0)) is None
    assert list(tmp_path.iterdir()) == []


def test_write_tile_reports_content_bbox_of_dequantised_vertices(tmp_path):
    import numpy as np
    from milano_iso.tiles import export

    pos = np.array([[10.0, 0.0, -5.0], [12.0, 3.0, -5.0], [10.0, 3.0, -9.0]])
    mesh = {
        "name": "buildings",
        "positions": pos,
        "feature_ids": np.zeros(3, dtype=np.int64),
        "indices": np.array([0, 1, 2]),
    }
    stats = {"buildings": {"features": 1}}
    entry, blob = export.write_tile(
        tmp_path, "0_0", 0, 0, [mesh], {"buildings": [{}]}, stats, (11.0, -7.0)
    )
    assert blob and (tmp_path / "0_0.glb").stat().st_size == len(blob)
    assert entry["content_bbox_local"] == {"min": [10.0, 0.0, -9.0], "max": [12.0, 3.0, -5.0]}
    (tmp_path / "index.json").write_bytes(b"{}\n")
    (tmp_path / "minimap.svg").write_bytes(b"<svg/>\n")
    man = manifest.build_manifest(
        [entry],
        ["buildings"],
        index=manifest.file_entry(tmp_path / "index.json"),
        minimap=manifest.file_entry(tmp_path / "minimap.svg"),
    )
    assert schema_check.validate(man, SCHEMA) == []
