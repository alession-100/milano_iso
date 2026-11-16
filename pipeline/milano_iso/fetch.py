"""Generic, idempotent download helper (ADR-0013).

Streams a file into ``RAW_DIR/<source>/``, computes its sha256 and writes or verifies
``pipeline/manifests/<source>.json``. Call ``fetch`` again and it skips the download when the
file exists and matches the manifest; a mismatch raises ``FetchError``.
"""

import hashlib
import json
import logging
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from milano_iso import config

USER_AGENT = "milano-iso-pipeline/0.1"
MANIFEST_DIR = config.REPO_ROOT / "pipeline" / "manifests"
CHUNK = 1 << 20

log = logging.getLogger("milano_iso.fetch")


class FetchError(RuntimeError):
    """Download or verification failure."""


def _hash_file(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def sha256_file(path: Path) -> str:
    return _hash_file(path, "sha256")


def _open(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=120)


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    with _open(url) as resp, part.open("wb") as out:
        while chunk := resp.read(CHUNK):
            out.write(chunk)
    part.replace(dest)


def _read_md5(md5_path: Path, filename: str) -> str:
    """First token of an ``md5sum``-style file; the file name, if present, must match."""
    parts = md5_path.read_text(encoding="utf-8").split()
    if not parts:
        raise FetchError(f"empty md5 file {md5_path}")
    if len(parts) > 1 and parts[1].lstrip("*") != filename:
        raise FetchError(f"md5 file names {parts[1]!r}, expected {filename!r}")
    return parts[0].lower()


def fetch(
    source: str,
    url: str,
    filename: str,
    md5_url: str | None = None,
    manifest_dir: Path | None = None,
) -> dict:
    """Fetch ``url`` to ``RAW_DIR/source/filename``; return the manifest dict."""
    dest = config.RAW_DIR / source / filename
    manifest_path = (manifest_dir or MANIFEST_DIR) / f"{source}.json"
    manifest = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("url") != url:
            raise FetchError(f"{manifest_path} records url {manifest.get('url')}, asked for {url}")

    downloaded = False
    if not dest.exists():
        log.info("%s: downloading %s", source, url)
        _download(url, dest)
        downloaded = True
    sha = sha256_file(dest)

    if manifest is not None:
        if sha != manifest["sha256"]:
            raise FetchError(
                f"sha256 mismatch for {dest}: file {sha}, manifest {manifest['sha256']}"
            )
        log.info("%s: %s, sha256 ok (%s)", source, "downloaded" if downloaded else "skip", sha)
        return manifest

    log.info("%s: no manifest yet, writing it", source)
    new = {
        "source": source,
        "url": url,
        "file": f"{source}/{filename}",
        "retrieved_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bytes": dest.stat().st_size,
        "sha256": sha,
    }
    if md5_url is not None:
        md5_path = dest.with_name(filename + ".md5")
        _download(md5_url, md5_path)
        expected = _read_md5(md5_path, filename)
        actual = _hash_file(dest, "md5")
        if actual != expected:
            raise FetchError(f"md5 mismatch for {dest}: file {actual}, published {expected}")
        new["md5_url"] = md5_url
        new["md5"] = actual
        new["md5_verified"] = True
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(new, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    log.info("%s: manifest written to %s", source, manifest_path)
    return new


GEOFABRIK_URL = "https://download.geofabrik.de/europe/italy/nord-ovest-261114.osm.pbf"
BOUNDARY_URL = (
    "https://dati.comune.milano.it/dataset/e75d91fa-eca6-4ee5-b96e-08bcdbb8d6f0/resource/"
    "f56cb432-83e6-48de-ae30-d39b4be61e85/download/"
    "confine_comune_milano_layer_0_confine_comune_milano.geojson"
)
OSM_PBF = "nord-ovest-261114.osm.pbf"
BOUNDARY_FILE = "confine.geojson"


def fetch_osm() -> dict:
    return fetch("osm_geofabrik", GEOFABRIK_URL, OSM_PBF, md5_url=GEOFABRIK_URL + ".md5")


def fetch_boundary() -> dict:
    return fetch("comune_boundary", BOUNDARY_URL, BOUNDARY_FILE)


def main(argv=None) -> int:
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", choices=["osm_geofabrik", "comune_boundary"])
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    {"osm_geofabrik": fetch_osm, "comune_boundary": fetch_boundary}[args.source]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
