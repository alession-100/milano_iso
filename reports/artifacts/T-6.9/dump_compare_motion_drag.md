early: ../reports/artifacts/T-6.9/motion_drag.json.dump200.json (t=203s, pid 9176)  late: ../reports/artifacts/T-6.9/motion_drag.json.dump610.json (t=616s, pid 9176)
same pid: true
private footprint (memory-infra): early 167.8 MB, late 290.8 MB, change 123.0 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| partition_alloc |    109.1 |    223.2 |    114.1 |  16.57 |
| blink_gc |      5.5 |     10.9 |      5.4 |   0.79 |
| malloc |     23.2 |     24.5 |      1.3 |   0.19 |
| blink_objects |      1.2 |      1.8 |      0.6 |   0.09 |
| webgl |     20.0 |     20.4 |      0.3 |   0.05 |
| v8 |      9.6 |      9.8 |      0.3 |   0.04 |
| shared_memory |      0.8 |      0.9 |      0.2 |   0.02 |
| cc |     16.5 |     16.5 |      0.0 |   0.00 |
| gpu |     25.2 |     25.2 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| partition_alloc |    109.1 |    223.2 |    114.1 |  16.57 |
| partition_alloc/allocated_objects |    106.3 |    219.1 |    112.7 |  16.38 |
| partition_alloc/allocated_objects/partitions |    106.3 |    219.1 |    112.7 |  16.38 |
| partition_alloc/allocated_objects/partitions/buffer |     98.5 |    211.0 |    112.4 |  16.33 |
| gpu/transfer_buffer_memory/buffer_0x23 |      0.0 |     16.0 |     16.0 |   2.32 |
| shared_memory/109FBCD65120675FB636EFF38CE793DE |      0.0 |     16.0 |     16.0 |   2.32 |
| blink_gc |      5.5 |     10.9 |      5.4 |   0.79 |
| blink_gc/main |      5.5 |     10.9 |      5.4 |   0.79 |
| blink_gc/main/heap |      5.5 |     10.9 |      5.4 |   0.79 |
| blink_gc/main/heap/NormalPageSpace3 |      3.3 |      7.5 |      4.2 |   0.61 |
| gpu/transfer_buffer_memory/buffer_0x14 |     16.0 |      0.0 |    -16.0 |  -2.32 |
| shared_memory/932DF7506708E3E28B2E21D513AEA2B3 |     16.0 |      0.0 |    -16.0 |  -2.32 |
