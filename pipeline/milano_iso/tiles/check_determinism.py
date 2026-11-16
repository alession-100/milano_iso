"""Tile determinism check (T-2.3): export twice into scratch dirs, compare every file byte for byte.

Run: ``python -m milano_iso.tiles.check_determinism`` (``make check-tiles-determinism``).
Scratch dirs live under $MILANO_ISO_DATA/_determinism_tiles; summaries go there too, so the
committed artifacts are not touched. Exits non-zero on any difference.
"""

import hashlib
import shutil
import sys
from pathlib import Path

from milano_iso import config
from milano_iso.tiles import export


def _hashes(d: Path) -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.iterdir())}


def main() -> int:
    work = config.DATA_DIR / "_determinism_tiles"
    if work.exists():
        shutil.rmtree(work)
    runs = []
    for n in (1, 2):
        out = work / f"run{n}" / "tiles"
        export.build("pilot", out_dir=out, summary_dir=work / f"run{n}" / "summary")
        runs.append(_hashes(out))
    a, b = runs
    bad = sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))
    if "tiles.json" not in a:
        bad.append("tiles.json missing")
    for name in sorted(a):
        print(f"{'OK  ' if name not in bad else 'DIFF'} {name} {a[name]}")
    print(f"files: run1={len(a)} run2={len(b)}; differences: {len(bad)}")
    if bad:
        print("DETERMINISM FAILED: " + ", ".join(bad))
        return 1
    shutil.rmtree(work)
    print("tiles are byte-identical across two builds")
    return 0


if __name__ == "__main__":
    sys.exit(main())
