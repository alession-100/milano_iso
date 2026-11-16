"""Unit tests for the ADR-0020 best-fit offset search (synthetic data, no real data)."""

import math
import sys
from pathlib import Path

import pytest
import shapely
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
from landmark_offset import best_offset, fill_rings

E0, N0 = 514_000.0, 5_036_000.0  # realistic magnitudes: coordinates are about 5e6 m


def _square(e, n, side=30.0):
    return box(E0 + e, N0 + n, E0 + e + side, N0 + n + side)


@pytest.mark.parametrize(
    "shift", [(0.0, 0.0), (7.3, -3.1), (-12.4, 9.9), (40.0, 0.0), (-33.7, -21.2), (0.4, 0.2)]
)
def test_recovers_known_shift_within_quarter_metre(shift):
    f = _square(0, 0)
    r = _square(*shift)  # rendered building is F moved by `shift`
    res = best_offset(f, r)
    assert math.hypot(res.e - shift[0], res.n - shift[1]) <= 0.25
    assert res.magnitude_m == pytest.approx(math.hypot(*shift), abs=0.25)
    assert res.overlap_ratio > 0.99


def test_no_overlap_in_range_gives_zero_ratio():
    res = best_offset(_square(0, 0), _square(200, 0))
    assert res.overlap_ratio == 0.0 and res.magnitude_m == 0.0


def test_footprint_inside_large_block_takes_smallest_offset_and_wide_plateau():
    f = _square(0, 0, side=20.0)
    r = _square(-40, -40, side=100.0)  # F lies well inside R: every small shift fits fully
    res = best_offset(f, r)
    assert res.magnitude_m == 0.0 and res.overlap_ratio == pytest.approx(1.0)
    assert res.plateau_width_m > 20.0  # the weakness is visible, not hidden


def test_fill_rings_removes_courtyards():
    ring = shapely.Polygon(
        [(0, 0), (40, 0), (40, 40), (0, 40)], holes=[[(10, 10), (30, 10), (30, 30), (10, 30)]]
    )
    assert shapely.area(fill_rings(ring)) == pytest.approx(1600.0)
