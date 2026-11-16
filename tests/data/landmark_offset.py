"""Best-fit offset search for the rendered landmark check (ADR-0020).

Pure shapely/numpy, no data access, so it is unit-tested in tests/pipeline.

Given the OSM footprint F of a landmark and R, the union of the rendered footprints around it
(interior rings filled), find the translation t, within +/- ``max_shift_m``, that maximises
area((F + t) intersected with R). The search runs on a coarse grid, then on a fine grid around
the chosen coarse cell. When several translations come within ``plateau_frac`` of the maximum
overlap, the one with the smallest |t| is taken (so a landmark that sits well inside a large
block is not penalised for the block's flat overlap).
"""

import math
from dataclasses import dataclass

import numpy as np
import shapely

COARSE_STEP_M = 2.0
FINE_STEP_M = 0.25
MAX_SHIFT_M = 50.0
PLATEAU_FRAC = 0.005  # near-maximal = within 0.5% of the maximum overlap


@dataclass(frozen=True)
class BestOffset:
    e: float  # translation of F that best fits R, east (m)
    n: float  # north (m)
    magnitude_m: float
    overlap_ratio: float  # area((F + t) intersect R) / area(F)
    plateau_width_m: float  # largest distance between near-maximal coarse-grid translations


def fill_rings(geom):
    """Union of the exteriors of the polygons of ``geom`` (courtyards filled)."""
    parts = [
        shapely.Polygon(p.exterior) for p in shapely.get_parts(geom) if p.geom_type == "Polygon"
    ]
    return shapely.union_all(parts)


def _overlaps(f_local, r_local, shifts: np.ndarray) -> np.ndarray:
    moved = np.array([shapely.transform(f_local, lambda c, s=s: c + s) for s in shifts])
    return shapely.area(shapely.intersection(moved, r_local))


def _pick(shifts: np.ndarray, ov: np.ndarray, ref_max: float):
    """Index of the smallest-|t| shift among those within PLATEAU_FRAC of ``ref_max``."""
    near = np.flatnonzero(ov >= (1.0 - PLATEAU_FRAC) * ref_max)
    norms = np.hypot(shifts[near, 0], shifts[near, 1])
    # ties on |t| are broken by grid order, which is fixed (east, then north ascending)
    return near, int(near[np.argmin(norms)])


def _grid(centre, half, step, limit):
    lo = np.maximum(-limit, np.round(np.array(centre) - half, 6))
    hi = np.minimum(limit, np.round(np.array(centre) + half, 6))
    xs = np.arange(lo[0], hi[0] + step / 2, step)
    ys = np.arange(lo[1], hi[1] + step / 2, step)
    gx, gy = np.meshgrid(xs, ys, indexing="ij")
    return np.column_stack([gx.ravel(), gy.ravel()])


def best_offset(
    footprint,
    rendered,
    max_shift_m: float = MAX_SHIFT_M,
    coarse_m: float = COARSE_STEP_M,
    fine_m: float = FINE_STEP_M,
) -> BestOffset:
    """Best translation of ``footprint`` onto ``rendered`` (see the module docstring)."""
    origin = np.array(shapely.get_coordinates(footprint)[0], dtype=float)
    f = shapely.transform(footprint, lambda c: c - origin)
    r = shapely.transform(rendered, lambda c: c - origin)
    area_f = float(shapely.area(f))
    if area_f <= 0:
        raise ValueError("footprint has no area")

    coarse = _grid((0.0, 0.0), max_shift_m, coarse_m, max_shift_m)
    ov_c = _overlaps(f, r, coarse)
    max_c = float(ov_c.max())
    if max_c <= 0:
        return BestOffset(0.0, 0.0, 0.0, 0.0, 0.0)
    near, i = _pick(coarse, ov_c, max_c)
    pts = coarse[near]
    diff = pts[:, None, :] - pts[None, :, :]
    plateau = float(np.hypot(diff[..., 0], diff[..., 1]).max())

    fine = _grid(tuple(coarse[i]), coarse_m, fine_m, max_shift_m)
    ov_f = _overlaps(f, r, fine)
    ref = max(max_c, float(ov_f.max()))
    _, j = _pick(fine, ov_f, ref)
    t = fine[j]
    return BestOffset(
        e=float(t[0]),
        n=float(t[1]),
        magnitude_m=math.hypot(float(t[0]), float(t[1])),
        overlap_ratio=float(ov_f[j]) / area_f,
        plateau_width_m=plateau,
    )
