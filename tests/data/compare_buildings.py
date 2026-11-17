"""Per-tile hash comparison of the ``buildings`` layer between two tile directories (T-4.2).

Run: ``uv run python tests/data/compare_buildings.py <baseline-dir> <new-dir>``

For each tile of either directory it hashes (sha256) what the buildings layer is made of: every
mesh named ``buildings`` or ``buildings#n`` (quantised positions, feature ids, indices, in file
order) and the ``buildings`` feature table (canonical JSON). The .glb file as a whole is not
compared, because adding the ``landmark_details`` mesh changes its bytes by design. Exit code 0
only when 0 tiles differ. Output: one line per tile and a summary.
"""

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tile_decode import decode_glb


def buildings_hash(tile_dir: Path, name: str) -> tuple[str, str]:
    """(mesh hash, feature-table hash) of tile ``name`` in ``tile_dir``."""
    h = hashlib.sha256()
    for m in decode_glb(tile_dir / f"{name}.glb"):
        if m["layer"] != "buildings":
            continue
        h.update(m["name"].encode())
        h.update(m["q"].tobytes())
        h.update(m["fid"].astype("<u4").tobytes())
        h.update(m["tris"].astype("<u4").tobytes())
    table = json.loads((tile_dir / f"{name}.json").read_text(encoding="utf-8"))["layers"]
    t = json.dumps(table.get("buildings", []), sort_keys=True, separators=(",", ":"))
    return h.hexdigest(), hashlib.sha256(t.encode()).hexdigest()


def tiles_in(d: Path) -> set[str]:
    return {p.stem for p in d.glob("*_*.glb")}


def compare(base: Path, new: Path) -> list[str]:
    changed = []
    names = sorted(tiles_in(base) | tiles_in(new))
    for n in names:
        if n not in tiles_in(base) or n not in tiles_in(new):
            print(f"{n}: present in only one directory")
            changed.append(n)
            continue
        a, b = buildings_hash(base, n), buildings_hash(new, n)
        same = a == b
        print(
            f"{n}: mesh {a[0][:12]} / {b[0][:12]}  table {a[1][:12]} / {b[1][:12]}  "
            f"{'same' if same else 'CHANGED'}"
        )
        if not same:
            changed.append(n)
    print(f"tiles compared: {len(names)}, changed: {len(changed)}")
    return changed


if __name__ == "__main__":
    sys.exit(1 if compare(Path(sys.argv[1]), Path(sys.argv[2])) else 0)
