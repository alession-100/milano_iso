early: ../reports/artifacts/T-6.9/motion_still.json.dump200.json (t=203s, pid 35752)  late: ../reports/artifacts/T-6.9/motion_still.json.dump610.json (t=616s, pid 35752)
same pid: true
private footprint (memory-infra): early 69.9 MB, late 70.2 MB, change 0.3 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| shared_memory |      0.6 |      0.6 |      0.0 |   0.01 |
| blink_gc |      2.5 |      2.5 |      0.0 |   0.00 |
| blink_objects |      0.8 |      0.8 |      0.0 |   0.00 |
| cc |      1.7 |      1.7 |      0.0 |   0.00 |
| gpu |      7.1 |      7.1 |      0.0 |   0.00 |
| partition_alloc |     24.7 |     24.7 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| v8 |      7.8 |      7.8 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |
| webgl |     19.1 |     19.1 |      0.0 |   0.00 |
| malloc |     16.3 |     16.3 |     -0.1 |  -0.01 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
