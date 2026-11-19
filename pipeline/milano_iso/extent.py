"""Processing extents and the per-extent paths (T-6.1, ADR-0035).

Two extents: ``pilot`` (the 1 km square AOI of ADR-0004) and ``city`` (the comune di Milano
boundary of ADR-0013). The pilot paths are the historical ones and must not change; every other
extent gets ``_<extent>`` suffixed names. Features intersecting the extent are kept whole
(ADR-0013); the tile grid (origin, 250 m) is the same for every extent (ADR-0021).
"""

from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import box

from milano_iso import config, fetch

EXTENTS = ("pilot", "city")
METRIC_CRS = "EPSG:32632"
CITY_ARTIFACT_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-6.1"


def check(extent: str) -> str:
    if extent not in EXTENTS:
        raise ValueError(f"unknown extent {extent!r}; expected one of {EXTENTS}")
    return extent


def _suffix(extent: str) -> str:
    return "" if check(extent) == "pilot" else f"_{extent}"


def interim_osm(extent: str) -> Path:
    return config.INTERIM_DIR / f"osm_{check(extent)}.gpkg"


def interim_dbt(extent: str) -> Path:
    return config.INTERIM_DIR / f"dbt_{check(extent)}.gpkg"


def processed_gpkg(extent: str) -> Path:
    return config.PROCESSED_DIR / f"{check(extent)}.gpkg"


def drop_log(extent: str) -> Path:
    return config.PROCESSED_DIR / f"drop_log{_suffix(extent)}.csv"


def tiles_dir(extent: str) -> Path:
    return config.DATA_DIR / "tiles" / check(extent)


def artifact_dir(extent: str, pilot_dir: Path) -> Path:
    """The committed pilot artefact directory, or ``reports/artifacts/T-6.1/<extent>/<name>``."""
    if check(extent) == "pilot":
        return pilot_dir
    return CITY_ARTIFACT_DIR / extent / pilot_dir.name


def boundary_metric() -> shapely.Geometry:
    """Comune di Milano boundary (raw/comune_boundary) in EPSG:32632, one geometry."""
    gdf = gpd.read_file(config.RAW_DIR / "comune_boundary" / fetch.BOUNDARY_FILE)
    src = gdf.crs.to_string() if gdf.crs is not None else "EPSG:4326"
    t = Transformer.from_crs(src, METRIC_CRS, always_xy=True)
    g = shapely.force_2d(gdf.geometry.union_all())
    return shapely.transform(g, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))


def polygon(extent: str) -> shapely.Geometry:
    """The extent as a geometry in EPSG:32632 (pilot: the AOI box; city: the comune boundary)."""
    if check(extent) == "pilot":
        return box(*config.PILOT_AOI_BBOX)
    return boundary_metric()


def bbox(extent: str) -> tuple[float, float, float, float]:
    """Bounding box (xmin, ymin, xmax, ymax) of the extent, EPSG:32632."""
    if check(extent) == "pilot":
        return config.PILOT_AOI_BBOX
    return tuple(float(v) for v in shapely.bounds(polygon(extent)))
