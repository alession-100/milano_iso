early: ../reports/artifacts/T-6.9/playwright_path_closed_20min.json.dump200.json (t=203s, pid 36304)  late: ../reports/artifacts/T-6.9/playwright_path_closed_20min.json.dump1190.json (t=1190s, pid 36304)
same pid: true
private footprint (memory-infra): early 299.6 MB, late 366.4 MB, change 66.8 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     14.6 |     65.7 |     51.1 |   3.11 |
| blink_objects |      2.4 |      9.8 |      7.4 |   0.45 |
| webgl |     18.4 |     24.3 |      5.8 |   0.35 |
| partition_alloc |    224.1 |    227.8 |      3.7 |   0.23 |
| malloc |     27.0 |     30.6 |      3.5 |   0.21 |
| shared_memory |      0.8 |      1.0 |      0.2 |   0.01 |
| v8 |     11.3 |     11.3 |      0.0 |   0.00 |
| cc |      2.1 |      2.1 |      0.0 |   0.00 |
| gpu |     25.2 |     25.2 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     14.6 |     65.7 |     51.1 |   3.11 |
| blink_gc/main |     14.6 |     65.7 |     51.1 |   3.11 |
| blink_gc/main/heap |     14.6 |     65.7 |     51.1 |   3.11 |
| blink_gc/main/heap/NormalPageSpace3 |     11.7 |     62.3 |     50.6 |   3.07 |
| blink_gc/main/allocated_objects/__eb4b411956c0ce01 |      0.0 |      8.0 |      8.0 |   0.49 |
| blink_objects/blink_gc/main/blink::NetworkResourcesData::ResourceData (0x1b4) |      0.0 |      8.0 |      8.0 |   0.49 |
| partition_alloc/allocated_objects |    216.2 |    223.9 |      7.7 |   0.47 |
| partition_alloc/allocated_objects/partitions |    216.2 |    223.9 |      7.7 |   0.47 |
| blink_gc/main/allocated_objects |      2.4 |      9.8 |      7.4 |   0.45 |
| blink_objects |      2.4 |      9.8 |      7.4 |   0.45 |
| blink_objects/blink_gc |      2.4 |      9.8 |      7.4 |   0.45 |
| blink_objects/blink_gc/main |      2.4 |      9.8 |      7.4 |   0.45 |
| partition_alloc/allocated_objects/partitions/array_buffer |      1.9 |      8.2 |      6.3 |   0.38 |
| webgl |     18.4 |     24.3 |      5.8 |   0.35 |
| webgl/context_0x2F640216C248 |     18.4 |     24.3 |      5.8 |   0.35 |
| webgl/context_0x2F640216C248/buffers |      0.9 |      6.7 |      5.8 |   0.35 |
| malloc/allocated_objects |     20.0 |     24.0 |      3.9 |   0.24 |
| malloc/allocated_objects/partitions/allocator |     18.0 |     21.9 |      3.9 |   0.24 |
| malloc/allocated_objects/partitions |     18.2 |     22.1 |      3.9 |   0.24 |
| partition_alloc |    224.1 |    227.8 |      3.7 |   0.23 |
| malloc |     27.0 |     30.6 |      3.5 |   0.21 |
| partition_alloc/partitions/buffer |      5.8 |      2.5 |     -3.4 |  -0.20 |
| partition_alloc/partitions/buffer/buckets |      5.8 |      2.5 |     -3.4 |  -0.20 |
| partition_alloc/partitions |      7.9 |      3.9 |     -4.0 |  -0.24 |
