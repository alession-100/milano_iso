"""Determinism check (VERIFICATION section 3): run the data steps twice, compare hashes.

Usage: python tests/data/check_determinism.py <DATA_STEPS...>   (via `make check-determinism`)

Each step is run twice into scratch directories under $MILANO_ISO_DATA/_determinism, calling
the same functions the Make targets call, with the same inputs: the raw downloads are read
as they are (the fetch steps only check and skip downloads, so they produce no GeoPackage),
interim outputs of run N feed the normalise and heights steps of run N. Report artifacts go
to the scratch directories, so the real interim/processed data and the committed artifacts
are not modified. The canonical sha256 (milano_iso.geo.canonical_dump_sha256) of every
GeoPackage produced is printed for both runs; any difference exits non-zero.
"""

import shutil
import sys
import time
from pathlib import Path

from milano_iso import config, dbt_extract, decor, fetch, heights, normalise, osm_extract
from milano_iso.dbt_fetch import target_path
from milano_iso.geo import canonical_dump_sha256

KNOWN = {"data-boundary", "data-osm", "data-dbt", "data-normalise", "data-heights", "data-decor"}


def _pbf() -> Path:
    import json

    manifest = json.loads(
        (config.REPO_ROOT / "pipeline" / "manifests" / "osm_geofabrik.json").read_text()
    )
    return config.RAW_DIR / manifest["file"]


def run_once(steps: list[str], work: Path) -> dict[str, str]:
    """Run all steps into ``work``; return {gpkg name: canonical sha256}."""
    if work.exists():
        shutil.rmtree(work)
    interim, processed, art = work / "interim", work / "processed", work / "artifacts"
    for d in (interim, processed, art):
        d.mkdir(parents=True)
    osm_gpkg, dbt_gpkg = interim / "osm_pilot.gpkg", interim / "dbt_pilot.gpkg"
    out = processed / "pilot.gpkg"
    boundary = config.RAW_DIR / "comune_boundary" / fetch.BOUNDARY_FILE
    hashes: dict[str, str] = {}
    for step in steps:  # DATA_STEPS order: boundary, osm, dbt, normalise, heights, decor
        t = time.time()
        if step == "data-boundary":
            if not boundary.exists():
                sys.exit(f"missing {boundary}: run `make data-boundary` first")
        elif step == "data-osm":
            osm_extract.extract(_pbf(), osm_extract.pilot_extent_wgs84(), osm_gpkg)
            hashes[osm_gpkg.name] = canonical_dump_sha256(osm_gpkg)
        elif step == "data-dbt":
            zip_path = target_path("dbt2020")
            dbt_extract.extract_pilot(zip_path, dbt_gpkg)
            hashes[dbt_gpkg.name] = canonical_dump_sha256(dbt_gpkg)
        elif step == "data-normalise":
            normalise.run(osm_gpkg, dbt_gpkg, boundary, out, config.PILOT_AOI_BBOX)
            hashes["pilot.gpkg (after normalise)"] = canonical_dump_sha256(out)
        elif step == "data-heights":
            heights.run(out, art)
            hashes[out.name] = canonical_dump_sha256(out)
        elif step == "data-decor":
            decor.run(out, osm_gpkg, art)
            hashes["pilot.gpkg (after decor)"] = canonical_dump_sha256(out)
        print(f"  {step}: {time.time() - t:.0f} s", flush=True)
    return hashes


def main(argv: list[str]) -> int:
    steps = list(argv)
    unknown = [s for s in steps if s not in KNOWN]
    if unknown or not steps:
        print(
            f"unknown or missing DATA_STEPS {unknown or steps}; update {__file__}", file=sys.stderr
        )
        return 2
    scratch = config.DATA_DIR / "_determinism"
    results = []
    for n in (1, 2):
        print(f"run {n}: {' '.join(steps)}", flush=True)
        results.append(run_once(steps, scratch / f"run{n}"))
    shutil.rmtree(scratch)
    ok = True
    print()
    for name in results[0]:
        a, b = results[0][name], results[1].get(name)
        same = a == b
        ok &= same
        print(f"{name}\n  run1 {a}\n  run2 {b}\n  {'MATCH' if same else 'DIFFERENT'}")
    print("determinism:", "OK, all hashes match" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
