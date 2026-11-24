early: ../reports/artifacts/T-6.9/motion_zoom.json.dump200.json (t=203s, pid 29968)  late: ../reports/artifacts/T-6.9/motion_zoom.json.dump610.json (t=616s, pid 29968)
same pid: true
private footprint (memory-infra): early 286.9 MB, late 308.6 MB, change 21.6 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |      8.1 |     17.7 |      9.6 |   1.39 |
| partition_alloc |    225.2 |    231.6 |      6.4 |   0.93 |
| malloc |     23.4 |     27.9 |      4.5 |   0.65 |
| webgl |     26.5 |     29.0 |      2.5 |   0.37 |
| blink_objects |      1.5 |      3.0 |      1.4 |   0.20 |
| cc |      2.1 |      2.5 |      0.4 |   0.06 |
| shared_memory |      0.8 |      0.9 |      0.2 |   0.02 |
| gpu |     29.2 |     29.2 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |
| v8 |      9.8 |      9.6 |     -0.3 |  -0.04 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| gpu/transfer_buffer_memory/buffer_0x2a |      0.0 |     16.0 |     16.0 |   2.32 |
| shared_memory/9CA5ED798B28A74C349F54F1D5AEE3ED |      0.0 |     16.0 |     16.0 |   2.32 |
| blink_gc |      8.1 |     17.7 |      9.6 |   1.39 |
| blink_gc/main |      8.1 |     17.7 |      9.6 |   1.39 |
| blink_gc/main/heap |      8.1 |     17.7 |      9.6 |   1.39 |
| blink_gc/main/heap/NormalPageSpace3 |      5.7 |     15.1 |      9.4 |   1.37 |
| partition_alloc |    225.2 |    231.6 |      6.4 |   0.93 |
| malloc/partitions |      4.8 |     10.8 |      6.0 |   0.88 |
| malloc/partitions/allocator |      4.7 |     10.7 |      6.0 |   0.88 |
| malloc/partitions/allocator/buckets |      2.7 |      7.9 |      5.2 |   0.76 |
| malloc |     23.4 |     27.9 |      4.5 |   0.65 |
| partition_alloc/partitions |      0.3 |      4.2 |      3.9 |   0.57 |
| gpu/transfer_buffer_memory/buffer_0x13 |     16.0 |      0.0 |    -16.0 |  -2.32 |
| shared_memory/07898D3FE694B821641F05C771333E5E |     16.0 |      0.0 |    -16.0 |  -2.32 |
