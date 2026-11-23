early: ../reports/artifacts/T-6.9/motion_pan.json.dump200.json (t=203s, pid 32712)  late: ../reports/artifacts/T-6.9/motion_pan.json.dump610.json (t=616s, pid 32712)
same pid: true
private footprint (memory-infra): early 282.1 MB, late 309.5 MB, change 27.4 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| partition_alloc |    220.6 |    231.0 |     10.4 |   1.51 |
| blink_gc |      8.5 |     17.4 |      9.0 |   1.30 |
| malloc |     23.3 |     30.1 |      6.8 |   0.99 |
| webgl |     22.5 |     28.3 |      5.8 |   0.85 |
| blink_objects |      1.5 |      2.8 |      1.3 |   0.19 |
| v8 |      9.6 |     10.1 |      0.5 |   0.07 |
| shared_memory |      0.7 |      0.9 |      0.1 |   0.02 |
| cc |      2.1 |      2.1 |      0.0 |   0.00 |
| gpu |     25.2 |     25.2 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| partition_alloc |    220.6 |    231.0 |     10.4 |   1.51 |
| blink_gc |      8.5 |     17.4 |      9.0 |   1.30 |
| blink_gc/main |      8.5 |     17.4 |      9.0 |   1.30 |
| blink_gc/main/heap |      8.5 |     17.4 |      9.0 |   1.30 |
| blink_gc/main/heap/NormalPageSpace3 |      5.6 |     14.4 |      8.8 |   1.28 |
| partition_alloc/allocated_objects |    218.7 |    226.2 |      7.5 |   1.09 |
| partition_alloc/allocated_objects/partitions |    218.7 |    226.2 |      7.5 |   1.09 |
| partition_alloc/allocated_objects/partitions/array_buffer |      5.7 |     12.8 |      7.1 |   1.03 |
| malloc |     23.3 |     30.1 |      6.8 |   0.99 |
| webgl |     22.5 |     28.3 |      5.8 |   0.85 |
| webgl/context_0x209C0216C248 |     22.5 |     28.3 |      5.8 |   0.85 |
| webgl/context_0x209C0216C248/buffers |      4.9 |     10.7 |      5.8 |   0.85 |
| malloc/allocated_objects |     18.1 |     22.7 |      4.6 |   0.66 |
| malloc/allocated_objects/partitions |     16.2 |     20.8 |      4.5 |   0.66 |
| malloc/allocated_objects/partitions/allocator |     16.1 |     20.6 |      4.5 |   0.66 |
