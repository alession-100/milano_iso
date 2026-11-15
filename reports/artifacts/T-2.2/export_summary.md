# T-2.2 export summary

| tile | layer | features | vertices | triangles |
|---|---|---:|---:|---:|
| -1_-1 | buildings | 61 | 95160 | 31720 |
| -1_-1 | landuse | 2 | 18 | 6 |
| -1_-1 | green | 14 | 312 | 104 |
| -1_-1 | road_areas | 10 | 249 | 83 |
| -1_-1 | roads | 572 | 12108 | 4036 |
| -1_-1 | rail | 78 | 2880 | 960 |
| -1_0 | buildings | 41 | 84969 | 28323 |
| -1_0 | landuse | 6 | 372 | 124 |
| -1_0 | green | 15 | 492 | 164 |
| -1_0 | road_areas | 16 | 1164 | 388 |
| -1_0 | roads | 502 | 11049 | 3683 |
| -1_0 | rail | 40 | 2079 | 693 |
| 0_-1 | buildings | 69 | 65139 | 21713 |
| 0_-1 | landuse | 1 | 6 | 2 |
| 0_-1 | green | 37 | 780 | 260 |
| 0_-1 | water | 2 | 102 | 34 |
| 0_-1 | road_areas | 9 | 363 | 121 |
| 0_-1 | roads | 445 | 10437 | 3479 |
| 0_-1 | rail | 41 | 1365 | 455 |
| 0_0 | buildings | 39 | 128763 | 42921 |
| 0_0 | landuse | 4 | 117 | 39 |
| 0_0 | green | 13 | 420 | 140 |
| 0_0 | water | 2 | 81 | 27 |
| 0_0 | road_areas | 10 | 537 | 179 |
| 0_0 | roads | 425 | 9603 | 3201 |

| tile | glb bytes | gzip-9 bytes | brotli bytes | max Hausdorff m | gzip > 250 KB |
|---|---:|---:|---:|---:|---|
| -1_-1 | 3548324 | 527468 | n/a | 0.252527 | YES |
| -1_0 | 3209100 | 476956 | n/a | 0.263903 | YES |
| 0_-1 | 2508000 | 378851 | n/a | 0.203139 | YES |
| 0_0 | 4469760 | 661914 | n/a | 0.26992 | YES |

Total: glb 13735184 bytes, gzip-9 2045189 bytes, max Hausdorff 0.26992 m. Budget per tile: 256000 bytes gzip.

## Checks

- buildings_total_in_layer: 240
- buildings_rendered: 233
- buildings_in_tiles: 210
- buildings_count_matches: False
- buildings_outside_exported_tiles: 23
- buildings_in_tiles_plus_outside_equals_rendered: True
- include_outside: False
- buildings_in_two_tiles: []
- rendered_volumes_without_rendered_building: 0
- tiles_outside_pilot_aoi: []
