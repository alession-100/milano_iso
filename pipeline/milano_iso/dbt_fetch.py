"""Download the Comune di Milano DBT 2020 ZIP and the regional DBGT specification PDF.

Idempotent: a file is skipped when it exists and its sha256 matches the committed
manifest (ADR-0013). A mismatch fails loudly. Run: python -m milano_iso.dbt_fetch
"""

import hashlib
import json
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from milano_iso import config

USER_AGENT = "milano-iso-pipeline/0.1"
MANIFEST_DIR = config.REPO_ROOT / "pipeline" / "manifests"

SOURCES = {
    "dbt2020": {
        "url": "https://gisportal.comune.milano.it/download/area_download/SIT/DBT2020/DBT_2020.zip",
        "dir": "dbt2020",
        "filename": "DBT_2020.zip",
        "expected_bytes": 596_533_009,  # docs/DATA_SOURCES.md row 3b
    },
    "dbt_spec": {
        "url": (
            "https://www.geoportale.regione.lombardia.it/documents/10180/0/"
            "Specifiche_Contenuto_Regionali_DBGT.pdf/"
            "19458997-44c0-4d54-b07d-d26ae5d4c6d8?t=1681218372225"
        ),
        "dir": "dbt_spec",
        "filename": "Specifiche_Contenuto_Regionali_DBGT.pdf",
        "expected_bytes": 12_386_999,  # docs/DATA_SOURCES.md row 3a
    },
}


def target_path(key: str) -> Path:
    s = SOURCES[key]
    return config.RAW_DIR / s["dir"] / s["filename"]


def manifest_path(key: str) -> Path:
    return MANIFEST_DIR / f"{key}.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)


def fetch(key: str) -> Path:
    s = SOURCES[key]
    dest = target_path(key)
    mpath = manifest_path(key)
    if dest.exists() and mpath.exists():
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
        actual = sha256_file(dest)
        if actual != manifest["sha256"]:
            sys.exit(f"{key}: sha256 mismatch: file {actual} vs manifest {manifest['sha256']}")
        print(f"{key}: skip download (sha256 matches manifest)")
        return dest
    retrieved = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{key}: downloading {s['url']}")
    _download(s["url"], dest)
    size = dest.stat().st_size
    if size != s["expected_bytes"]:
        sys.exit(f"{key}: size {size} differs from DATA_SOURCES {s['expected_bytes']}")
    manifest = {
        "url": s["url"],
        "retrieved_utc": retrieved,
        "bytes": size,
        "sha256": sha256_file(dest),
    }
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    mpath.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return dest


def main() -> None:
    for key in SOURCES:
        fetch(key)


if __name__ == "__main__":
    main()
