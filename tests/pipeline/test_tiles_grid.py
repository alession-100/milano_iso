from milano_iso import config
from milano_iso.tiles import grid

E0, N0 = config.ORIGIN_E, config.ORIGIN_N


def test_origin_is_tile_zero_corner():
    assert grid.tile_ij(E0, N0) == (0, 0)


def test_exactly_on_tile_edge_belongs_to_upper_tile():
    assert grid.tile_ij(E0 + 250, N0) == (1, 0)
    assert grid.tile_ij(E0 + 249.999, N0) == (0, 0)
    assert grid.tile_ij(E0, N0 + 250) == (0, 1)


def test_negative_coordinates_use_floor():
    assert grid.tile_ij(E0 - 0.001, N0 - 0.001) == (-1, -1)
    assert grid.tile_ij(E0 - 250, N0 - 250) == (-1, -1)
    assert grid.tile_ij(E0 - 250.001, N0) == (-2, 0)


def test_tile_name_keeps_negative_numbers():
    assert grid.tile_name(-1, 0) == "-1_0"
    assert grid.tile_name(0, -1) == "0_-1"


def test_bbox_tiles_are_contiguous_without_overlap():
    a = grid.tile_bbox(-1, 0)
    b = grid.tile_bbox(0, 0)
    assert a[2] == b[0]
    assert a[3] - a[1] == config.TILE_SIZE_M
    assert grid.tile_bbox_local(-1, -1) == (-250.0, -250.0, 0.0, 0.0)


def test_tile_size_comes_from_config():
    assert config.TILE_SIZE_M == 250
    assert not hasattr(grid, "TILE_SIZE_M")


def test_pilot_aoi_is_sixteen_tiles():
    want = [(i, j) for i in range(-2, 2) for j in range(-2, 2)]
    assert grid.tiles_covering(config.PILOT_AOI_BBOX) == want
