early: ../reports/artifacts/T-6.9/nodriver2_closed_60min.json.dump600.json (t=602s, pid 24740)  late: ../reports/artifacts/T-6.9/nodriver2_closed_60min.json.dump3590.json (t=3591s, pid 24740)
same pid: true
private footprint (memory-infra): early 71.9 MB, late 80.7 MB, change 8.8 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| partition_alloc |      9.3 |     16.4 |      7.1 |   0.14 |
| webgl |     21.6 |     28.2 |      6.6 |   0.13 |
| malloc |     25.8 |     31.2 |      5.5 |   0.11 |
| gpu |     25.2 |     29.2 |      4.0 |   0.08 |
| cc |      2.5 |      2.9 |      0.4 |   0.01 |
| shared_memory |      0.8 |      1.0 |      0.3 |   0.01 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| blink_objects |      0.8 |      0.7 |     -0.0 |  -0.00 |
| v8 |     11.3 |     10.5 |     -0.8 |  -0.02 |
| blink_gc |      9.7 |      8.0 |     -1.7 |  -0.03 |

### All allocators (depth <= 4) with |change| >= 3 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| gpu/transfer_buffer_memory/buffer_0x30 |      0.0 |     16.0 |     16.0 |   0.32 |
| shared_memory/F641D21D706527B5E4F1BE309BFA436F |      0.0 |     16.0 |     16.0 |   0.32 |
| gpu/transfer_buffer_memory/buffer_0x1d |      0.0 |      8.0 |      8.0 |   0.16 |
| partition_alloc/allocated_objects |      5.7 |     13.0 |      7.3 |   0.15 |
| partition_alloc/allocated_objects/partitions |      5.7 |     13.0 |      7.3 |   0.15 |
| partition_alloc/allocated_objects/partitions/array_buffer |      2.4 |      9.7 |      7.3 |   0.15 |
| partition_alloc |      9.3 |     16.4 |      7.1 |   0.14 |
| webgl |     21.6 |     28.2 |      6.6 |   0.13 |
| webgl/context_0x32B40214F798 |     21.6 |     28.2 |      6.6 |   0.13 |
| webgl/context_0x32B40214F798/buffers |      1.1 |      7.7 |      6.6 |   0.13 |
| malloc |     25.8 |     31.2 |      5.5 |   0.11 |
| gpu |     25.2 |     29.2 |      4.0 |   0.08 |
| gpu/transfer_buffer_memory |     20.1 |     24.1 |      4.0 |   0.08 |
| malloc/allocated_objects/partitions/allocator |     18.1 |     21.9 |      3.8 |   0.08 |
| malloc/allocated_objects/partitions |     18.2 |     22.0 |      3.8 |   0.08 |
| malloc/allocated_objects |     18.6 |     22.4 |      3.8 |   0.08 |
| gpu/transfer_buffer_memory/buffer_0x14 |      4.0 |      0.0 |     -4.0 |  -0.08 |
| gpu/transfer_buffer_memory/buffer_0x1c |     16.0 |      0.0 |    -16.0 |  -0.32 |
| shared_memory/8F4E5B9B6476561C254187ADD7191B6C |     16.0 |      0.0 |    -16.0 |  -0.32 |
