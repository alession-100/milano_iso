early: ../reports/artifacts/T-6.9/nodriver_closed_20min.json.dump200.json (t=203s, pid 29012)  late: ../reports/artifacts/T-6.9/nodriver_closed_20min.json.dump1190.json (t=1190s, pid 29012)
same pid: true
private footprint (memory-infra): early 59.3 MB, late 60.0 MB, change 0.7 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| v8 |     10.0 |     10.8 |      0.7 |   0.04 |
| partition_alloc |     10.0 |     10.6 |      0.6 |   0.04 |
| cc |      1.7 |      1.7 |      0.0 |   0.00 |
| gpu |      3.0 |      3.0 |      0.0 |   0.00 |
| skia |      0.0 |      0.0 |     -0.0 |  -0.00 |
| blink_objects |      0.7 |      0.7 |     -0.1 |  -0.00 |
| blink_gc |      4.9 |      4.7 |     -0.2 |  -0.01 |
| malloc |     18.0 |     17.5 |     -0.4 |  -0.03 |
| webgl |     17.6 |     13.7 |     -3.9 |  -0.23 |
| shared_memory |      8.7 |      0.8 |     -7.9 |  -0.48 |

### All allocators (depth <= 4) with |change| >= 1 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| gpu/command_buffer_memory/buffer_0x25 |      0.0 |      1.0 |      1.0 |   0.06 |
| shared_memory/ACEF8CA4128388FE93CB01C5924E4B05 |      0.0 |      1.0 |      1.0 |   0.06 |
| gpu/command_buffer_memory/buffer_0x15 |      1.0 |      0.0 |     -1.0 |  -0.06 |
| shared_memory/79D8693C7C1E1019C9C44F71EB754217 |      1.0 |      0.0 |     -1.0 |  -0.06 |
| webgl/context_0x622C02150918/drawing_buffer |     13.7 |     10.3 |     -3.4 |  -0.21 |
| webgl/context_0x622C02150918/drawing_buffer/exported_color_buffers |      6.8 |      3.4 |     -3.4 |  -0.21 |
| webgl |     17.6 |     13.7 |     -3.9 |  -0.23 |
| webgl/context_0x622C02150918 |     17.6 |     13.7 |     -3.9 |  -0.23 |
| shared_memory |      8.7 |      0.8 |     -7.9 |  -0.48 |
| shared_memory/FC5F22193B8EFB6A2050BF1712958986 |      8.0 |      0.0 |     -8.0 |  -0.49 |
