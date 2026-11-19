"""Tile grid (ADR-0021, ADR-0023): square tiles of config.TILE_SIZE_M in EPSG:32632, origin-aligned."""

import math

from milano_iso import config


def tile_ij(
    e: float,
    n: float,
    e0: float = config.ORIGIN_E,
    n0: float = config.ORIGIN_N,
    size: float = config.TILE_SIZE_M,
) -> tuple[int, int]:
    """Tile indices of a point. Lower and left edges belong to the tile (floor).

    ``size`` is the cell size; the default is the base tile (coarse levels, T-6.2, pass their block).
    """
    return math.floor((e - e0) / size), math.floor((n - n0) / size)


def tile_name(i: int, j: int) -> str:
    return f"{i}_{j}"


def tile_bbox(
    i: int,
    j: int,
    e0: float = config.ORIGIN_E,
    n0: float = config.ORIGIN_N,
    size: float = config.TILE_SIZE_M,
) -> tuple[float, float, float, float]:
    """Tile bbox (xmin, ymin, xmax, ymax) in EPSG:32632."""
    return (
        e0 + size * i,
        n0 + size * j,
        e0 + size * (i + 1),
        n0 + size * (j + 1),
    )


def tile_bbox_local(
    i: int, j: int, size: float = config.TILE_SIZE_M
) -> tuple[float, float, float, float]:
    """Tile bbox in metres relative to the origin (E - E0, N - N0)."""
    return (float(size * i), float(size * j), float(size * (i + 1)), float(size * (j + 1)))


def tiles_covering(
    bbox: tuple[float, float, float, float], size: float = config.TILE_SIZE_M
) -> list[tuple[int, int]]:
    """Sorted tiles covering a bbox (xmin, ymin, xmax, ymax); the max edge is exclusive."""
    i0, j0 = tile_ij(bbox[0], bbox[1], size=size)
    i1 = math.ceil((bbox[2] - config.ORIGIN_E) / size) - 1
    j1 = math.ceil((bbox[3] - config.ORIGIN_N) / size) - 1
    return [(i, j) for i in range(i0, i1 + 1) for j in range(j0, j1 + 1)]
