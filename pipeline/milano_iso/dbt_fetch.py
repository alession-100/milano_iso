"""Download the Comune di Milano DBT 2020 ZIP and the regional DBGT specification PDF.

Idempotent: a file is skipped when it exists and its sha256 matches the committed
manifest (ADR-0013). A mismatch fails loudly. Run: python -m milano_iso.dbt_fetch
"""

import logging
import sys
from pathlib import Path

from milano_iso import config
from milano_iso import fetch as fetch_helper
from milano_iso.fetch import FetchError

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


def fetch(key: str) -> Path:
    """Download (or skip) one source via the shared ``milano_iso.fetch`` helper (ADR-0013)."""
    s = SOURCES[key]
    dest = target_path(key)
    existed = dest.exists()
    try:
        fetch_helper.fetch(s["dir"], s["url"], s["filename"], manifest_dir=MANIFEST_DIR)
    except FetchError as e:
        sys.exit(f"{key}: {e}")
    size = dest.stat().st_size
    if not existed and size != s["expected_bytes"]:
        manifest_path(key).unlink(missing_ok=True)
        sys.exit(f"{key}: size {size} differs from DATA_SOURCES {s['expected_bytes']}")
    return dest


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for key in SOURCES:
        fetch(key)


if __name__ == "__main__":
    main()
