from milano_iso import config
from milano_iso.tiles import grid

E0, N0 = config.ORIGIN_E, config.ORIGIN_N


def test_origin_is_tile_zero_corner():
    assert grid.tile_ij(E0, N0) == (0, 0)


def test_exactly_on_tile_edge_belongs_to_upper_tile():
    assert grid.tile_ij(E0 + 500, N0) == (1, 0)
    assert grid.tile_ij(E0 + 499.999, N0) == (0, 0)
    assert grid.tile_ij(E0, N0 + 500) == (0, 1)


def test_negative_coordinates_use_floor():
    assert grid.tile_ij(E0 - 0.001, N0 - 0.001) == (-1, -1)
    assert grid.tile_ij(E0 - 500, N0 - 500) == (-1, -1)
    assert grid.tile_ij(E0 - 500.001, N0) == (-2, 0)


def test_tile_name_keeps_negative_numbers():
    assert grid.tile_name(-1, 0) == "-1_0"
    assert grid.tile_name(0, -1) == "0_-1"


def test_bbox_tiles_are_contiguous_without_overlap():
    a = grid.tile_bbox(-1, 0)
    b = grid.tile_bbox(0, 0)
    assert a[2] == b[0]
    assert a[3] - a[1] == grid.TILE_SIZE_M
    assert grid.tile_bbox_local(-1, -1) == (-500.0, -500.0, 0.0, 0.0)


def test_pilot_aoi_is_exactly_four_tiles():
    assert grid.tiles_covering(config.PILOT_AOI_BBOX) == [(-1, -1), (-1, 0), (0, -1), (0, 0)]
