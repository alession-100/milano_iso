# Tile export summary (T-2.2, T-2.2a)

| tile | layer | features | vertices | triangles |
|---|---|---:|---:|---:|
| -2_-2 | buildings | 1 | 692 | 1218 |
| -2_-1 | buildings | 4 | 2577 | 4462 |
| -2_0 | buildings | 4 | 3027 | 5326 |
| -1_-2 | buildings | 5 | 3818 | 6750 |
| -1_-1 | buildings | 61 | 17793 | 31720 |
| -1_-1 | landuse | 2 | 10 | 6 |
| -1_-1 | green | 14 | 132 | 104 |
| -1_-1 | road_areas | 10 | 103 | 83 |
| -1_-1 | roads | 572 | 5182 | 4036 |
| -1_-1 | rail | 78 | 1116 | 960 |
| -1_0 | buildings | 41 | 15911 | 28323 |
| -1_0 | landuse | 6 | 136 | 124 |
| -1_0 | green | 15 | 194 | 164 |
| -1_0 | road_areas | 16 | 406 | 388 |
| -1_0 | roads | 502 | 4681 | 3683 |
| -1_0 | rail | 40 | 773 | 693 |
| -1_1 | buildings | 3 | 2134 | 3782 |
| 0_-1 | buildings | 69 | 12347 | 21713 |
| 0_-1 | landuse | 1 | 4 | 2 |
| 0_-1 | green | 37 | 334 | 260 |
| 0_-1 | water | 2 | 38 | 34 |
| 0_-1 | road_areas | 9 | 129 | 121 |
| 0_-1 | roads | 445 | 4341 | 3479 |
| 0_-1 | rail | 41 | 537 | 455 |
| 0_0 | buildings | 39 | 24056 | 42921 |
| 0_0 | landuse | 4 | 47 | 39 |
| 0_0 | green | 13 | 168 | 140 |
| 0_0 | water | 2 | 31 | 27 |
| 0_0 | road_areas | 10 | 199 | 179 |
| 0_0 | roads | 425 | 4039 | 3201 |
| 0_1 | buildings | 2 | 4221 | 7275 |
| 1_-1 | buildings | 2 | 172 | 290 |
| 1_0 | buildings | 2 | 2601 | 4660 |

| tile | glb bytes | gzip-9 before (T-2.2) | gzip-9 after | brotli bytes | max Hausdorff m | gzip > 250 KB |
|---|---:|---:|---:|---:|---:|---|
| -2_-2 | 15204 | n/a | 7891 | n/a | 0.192387 | no |
| -2_-1 | 53528 | n/a | 27263 | n/a | 0.249238 | no |
| -2_0 | 63212 | n/a | 32054 | n/a | 0.19216 | no |
| -1_-2 | 79668 | n/a | 40365 | n/a | 0.199459 | no |
| -1_-1 | 469192 | 527468 | 235225 | n/a | 0.252527 | no |
| -1_0 | 425660 | 476956 | 213446 | n/a | 0.263903 | no |
| -1_1 | 45016 | n/a | 23081 | n/a | 0.197919 | no |
| 0_-1 | 338720 | 378851 | 169821 | n/a | 0.203139 | no |
| 0_0 | 568824 | 661914 | 287667 | n/a | 0.26992 | YES |
| 0_1 | 86848 | n/a | 43751 | n/a | 0.203141 | no |
| 1_-1 | 4436 | n/a | 2259 | n/a | 0.185106 | no |
| 1_0 | 54956 | n/a | 27961 | n/a | 0.202329 | no |

Worst offset from a tile centre: 358.893 m; int16 range +/-655.34 m (2 cm unit), headroom 296.447 m.

Total: glb 2205264 bytes, gzip-9 1110784 bytes, max Hausdorff 0.26992 m. Budget per tile: 256000 bytes gzip.

## Checks

- buildings_total_in_layer: 240
- buildings_rendered: 233
- buildings_in_tiles: 233
- buildings_count_matches: True
- buildings_in_two_tiles: []
- rendered_volumes_without_rendered_building: 0
- tiles_outside_pilot_aoi: ['-1_-2', '-1_1', '-2_-1', '-2_-2', '-2_0', '0_1', '1_-1', '1_0']
