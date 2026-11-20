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


SHARD_REF = {"$ref": "#/$defs/shard_file"}


def _check_split(full, factor=manifest.SHARD_FACTOR):
    """Root and every shard validate against the schema; return (root, shards)."""
    root, shards = manifest.split_manifest(full, factor)
    assert schema_check.validate(root, SCHEMA) == []
    for doc in shards.values():
        assert schema_check.validate(doc, SHARD_REF, SCHEMA) == []
    return root, shards


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
    _check_split(man)
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
        lambda m: m.pop("shards"),
        lambda m: m.pop("bounds_local"),
        lambda m: m.update(tiles=[]),
        lambda m: m["shards"][0].update(file="S0_0_0.json"),
        lambda m: m["shards"][0].update(sha256="xyz"),
        lambda m: m.update(format_version=1),
        lambda m: m.update(crs="EPSG:4326"),
        lambda m: m["attribution"].pop(),
        lambda m: m.pop("index"),
        lambda m: m.pop("minimap"),
        lambda m: m["index"].update(sha256="xyz"),
        lambda m: m["minimap"].pop("gzip9_bytes"),
    ],
)
def test_schema_rejects_broken_manifests(man, mutate):
    root, _ = manifest.split_manifest(man)
    mutate(root)
    assert schema_check.validate(root, SCHEMA)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["tiles"][0]["glb"].update(sha256="xyz"),
        lambda d: d["tiles"][0].update(bbox_local=[1, 2, 3]),
        lambda d: d["tiles"][0]["counts"].update(roads=-1),
        lambda d: d["tiles"][0].update(i="0"),
        lambda d: d["tiles"][0].pop("content_bbox_local"),
        lambda d: d["tiles"][0]["content_bbox_local"].update(min=[1, 2]),
        lambda d: d.update(tiles=[]),
        lambda d: d.update(id="0_0"),
    ],
)
def test_schema_rejects_broken_shards(man, mutate):
    _, shards = manifest.split_manifest(man)
    doc = next(iter(shards.values()))
    mutate(doc)
    assert schema_check.validate(doc, SHARD_REF, SCHEMA)


def _levels_manifest(tmp_path):
    """A manifest with base tiles on both sides of a shard border and two coarse levels."""
    base = [
        _tile(tmp_path, n, i, j)
        for n, i, j in [("0_0", 0, 0), ("7_0", 7, 0), ("8_0", 8, 0), ("-1_0", -1, 0)]
    ]
    lv = []
    for level, block in ((1, 500), (2, 1000)):
        name = f"L{level}_0_0"
        (tmp_path / f"{name}.glb").write_bytes(b"glTF")
        (tmp_path / f"{name}.json").write_bytes(b"{}\n")
        e = manifest.tile_entry(tmp_path, name, 0, 0, {"roads": 1}, BBOX3, size=block)
        lv.append(
            {
                "level": level,
                "block_m": block,
                "tolerance_m": level * 1.0,
                "unit_m": 0.02,
                "tiles": [e],
            }
        )
    lv.insert(0, {"level": 0, "block_m": 250, "tolerance_m": 0.2, "unit_m": 0.02})
    (tmp_path / "index.json").write_bytes(b"{}\n")
    (tmp_path / "minimap.svg").write_bytes(b"<svg/>\n")
    return manifest.build_manifest(
        base,
        ["roads"],
        index=manifest.file_entry(tmp_path / "index.json"),
        minimap=manifest.file_entry(tmp_path / "minimap.svg"),
        levels=lv,
    )


def test_split_puts_tiles_in_shards_by_cell_centre_and_joins_back(tmp_path):
    full = _levels_manifest(tmp_path)
    root, shards = _check_split(full)
    assert "tiles" not in root and all("tiles" not in lv for lv in root["levels"])
    # 8 x 250 m = 2 km shards at level 0: tiles 0..7 in column 0, 8 in column 1, -1 in column -1
    ids = {rec["id"]: [t["id"] for t in shards[rec["file"]]["tiles"]] for rec in root["shards"]}
    assert ids == {
        "S0_-1_-1": ["-1_0"],
        "S0_0_-1": ["0_0", "7_0"],
        "S0_1_-1": ["8_0"],
        "S1_0_-1": ["L1_0_0"],
        "S2_0_-1": ["L2_0_0"],
    }
    assert [r["id"] for r in root["shards"]] == sorted(ids, key=lambda k: (int(k[1]), k))
    # the extent of the base tiles' content boxes: x 0..2, z -1..4 (BBOX3, the same for every tile)
    assert root["bounds_local"] == [0.0, -1.0, 2.0, 4.0]
    # no information is lost
    joined = manifest.join_manifest(root, lambda f: shards[f])
    assert joined == full
    # a smaller factor gives more shards (the fixtures use 1)
    _, more = manifest.split_manifest(full, 1)
    assert len(more) == 6


def test_shard_records_match_the_files_written(tmp_path):
    import gzip
    import hashlib

    full = _levels_manifest(tmp_path)
    manifest.write_manifest(tmp_path, full)
    root = json.loads((tmp_path / "tiles.json").read_text(encoding="utf-8"))
    on_disk = sorted(p.name for p in (tmp_path / "shards").iterdir())
    assert on_disk == sorted(r["file"].split("/")[1] for r in root["shards"])
    for rec in root["shards"]:
        blob = (tmp_path / rec["file"]).read_bytes()
        assert rec["bytes"] == len(blob)
        assert rec["gzip9_bytes"] == len(gzip.compress(blob, 9, mtime=0))
        assert rec["sha256"] == hashlib.sha256(blob).hexdigest()
    assert manifest.load_full(tmp_path) == full
    # writing again replaces the shards: a stale shard file does not survive
    (tmp_path / "shards" / "S9_9_9.json").write_text("{}")
    manifest.write_manifest(tmp_path, full)
    assert not (tmp_path / "shards" / "S9_9_9.json").exists()
    first = {p.name: p.read_bytes() for p in (tmp_path / "shards").iterdir()}
    manifest.write_manifest(tmp_path, full)
    assert first == {p.name: p.read_bytes() for p in (tmp_path / "shards").iterdir()}


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
    _check_split(man)
