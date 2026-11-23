early: ../reports/artifacts/T-6.9/playwright2_path_closed_20min.json.dump600.json (t=602s, pid 30584)  late: ../reports/artifacts/T-6.9/playwright2_path_closed_20min.json.dump1190.json (t=1190s, pid 30584)
same pid: true
private footprint (memory-infra): early 327.4 MB, late 376.4 MB, change 49.0 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     35.2 |     66.1 |     30.9 |   3.16 |
| partition_alloc |    221.9 |    234.9 |     13.0 |   1.33 |
| webgl |     18.7 |     24.3 |      5.6 |   0.57 |
| blink_objects |      5.3 |      9.8 |      4.4 |   0.45 |
| malloc |     30.3 |     30.5 |      0.3 |   0.03 |
| shared_memory |      0.8 |      0.9 |      0.1 |   0.01 |
| v8 |     11.3 |     11.3 |      0.0 |   0.00 |
| cc |      2.1 |      2.1 |      0.0 |   0.00 |
| gpu |     25.2 |     25.2 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     35.2 |     66.1 |     30.9 |   3.16 |
| blink_gc/main |     35.2 |     66.1 |     30.9 |   3.16 |
| blink_gc/main/heap |     35.2 |     66.1 |     30.9 |   3.16 |
| blink_gc/main/heap/NormalPageSpace3 |     32.1 |     62.7 |     30.6 |   3.12 |
| partition_alloc |    221.9 |    234.9 |     13.0 |   1.33 |
| blink_gc/main/allocated_objects/__f214cd63d376c8b7 |      0.0 |      8.0 |      8.0 |   0.82 |
| blink_objects/blink_gc/main/blink::NetworkResourcesData::ResourceData (0x1b4) |      0.0 |      8.0 |      8.0 |   0.82 |
| partition_alloc/allocated_objects |    217.3 |    223.9 |      6.6 |   0.67 |
| partition_alloc/allocated_objects/partitions |    217.3 |    223.9 |      6.6 |   0.67 |
| partition_alloc/partitions |      4.6 |     11.0 |      6.4 |   0.65 |
| partition_alloc/partitions/buffer |      2.9 |      9.2 |      6.3 |   0.64 |
| partition_alloc/partitions/buffer/buckets |      2.9 |      9.2 |      6.3 |   0.64 |
| partition_alloc/allocated_objects/partitions/array_buffer |      2.3 |      8.2 |      5.8 |   0.59 |
| webgl |     18.7 |     24.3 |      5.6 |   0.57 |
| webgl/context_0x41EC0216C248 |     18.7 |     24.3 |      5.6 |   0.57 |
| webgl/context_0x41EC0216C248/buffers |      1.1 |      6.7 |      5.6 |   0.57 |
| blink_gc/main/allocated_objects |      5.3 |      9.8 |      4.4 |   0.45 |
| blink_objects |      5.3 |      9.8 |      4.4 |   0.45 |
| blink_objects/blink_gc |      5.3 |      9.8 |      4.4 |   0.45 |
| blink_objects/blink_gc/main |      5.3 |      9.8 |      4.4 |   0.45 |
| malloc/allocated_objects/partitions/allocator |     19.0 |     22.0 |      3.0 |   0.31 |
| malloc/allocated_objects/partitions |     19.2 |     22.2 |      3.0 |   0.31 |
| blink_gc/main/allocated_objects/__a37c00e579efd0a6 |      4.1 |      0.0 |     -4.1 |  -0.42 |
| blink_objects/blink_gc/main/blink::NetworkResourcesData::ResourceData (0x1b8) |      4.1 |      0.0 |     -4.1 |  -0.42 |
