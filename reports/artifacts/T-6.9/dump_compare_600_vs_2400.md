early: ../reports/artifacts/T-6.9/memory_40min.json.dump600.json (t=602s, pid 30312)  late: ../reports/artifacts/T-6.9/memory_40min.json.dump2400.json (t=2407s, pid 30312)
same pid: true
private footprint (memory-infra): early 322.4 MB, late 431.8 MB, change 109.4 MB

### Top-level allocators

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     31.9 |    114.8 |     82.9 |   2.76 |
| blink_objects |      4.9 |     17.8 |     12.9 |   0.43 |
| gpu |     25.2 |     37.2 |     12.0 |   0.40 |
| partition_alloc |    218.9 |    227.6 |      8.7 |   0.29 |
| malloc |     31.4 |     37.6 |      6.3 |   0.21 |
| v8 |     11.8 |     12.3 |      0.5 |   0.02 |
| shared_memory |      0.9 |      1.1 |      0.3 |   0.01 |
| skia |      0.0 |      0.0 |      0.0 |   0.00 |
| web_cache |      1.4 |      1.4 |      0.0 |   0.00 |
| webgl |     18.6 |     18.5 |     -0.1 |  -0.00 |
| cc |     16.9 |     16.5 |     -0.4 |  -0.01 |

### All allocators (depth <= 4) with |change| >= 0.5 MB

| allocator | early MB | late MB | change MB | MB/min |
|---|---|---|---|---|
| blink_gc |     31.9 |    114.8 |     82.9 |   2.76 |
| blink_gc/main |     31.9 |    114.8 |     82.9 |   2.76 |
| blink_gc/main/heap |     31.9 |    114.8 |     82.9 |   2.76 |
| blink_gc/main/heap/NormalPageSpace3 |     28.4 |    110.6 |     82.2 |   2.73 |
| gpu/transfer_buffer_memory/buffer_0x16 |      0.0 |     16.0 |     16.0 |   0.53 |
| gpu/transfer_buffer_memory/buffer_0x34 |      0.0 |     16.0 |     16.0 |   0.53 |
| shared_memory/17AA6FF7AFF573073A755A8B8ABAE1F4 |      0.0 |     16.0 |     16.0 |   0.53 |
| shared_memory/D22E70F1F128B90DB0D6B574CCAA87CF |      0.0 |     16.0 |     16.0 |   0.53 |
| blink_gc/main/allocated_objects |      4.9 |     17.8 |     12.9 |   0.43 |
| blink_objects |      4.9 |     17.8 |     12.9 |   0.43 |
| blink_objects/blink_gc |      4.9 |     17.8 |     12.9 |   0.43 |
| blink_objects/blink_gc/main |      4.9 |     17.8 |     12.9 |   0.43 |
| gpu |     25.2 |     37.2 |     12.0 |   0.40 |
| gpu/transfer_buffer_memory |     20.1 |     32.1 |     12.0 |   0.40 |
| blink_gc/main/allocated_objects/__43fb8c907ab56372 |      3.6 |     14.0 |     10.4 |   0.35 |
| blink_objects/blink_gc/main/blink::NetworkResourcesData::ResourceData (0x1bb) |      3.6 |     14.0 |     10.4 |   0.35 |
| malloc/partitions |      7.3 |     16.9 |      9.7 |   0.32 |
| malloc/partitions/allocator |      7.2 |     16.9 |      9.7 |   0.32 |
| partition_alloc |    218.9 |    227.6 |      8.7 |   0.29 |
| malloc/partitions/allocator/buckets |      4.5 |     13.2 |      8.7 |   0.29 |
| malloc |     31.4 |     37.6 |      6.3 |   0.21 |
| partition_alloc/partitions |      1.9 |      7.5 |      5.6 |   0.19 |
| partition_alloc/partitions/buffer |      1.2 |      6.2 |      5.0 |   0.17 |
| partition_alloc/partitions/buffer/buckets |      1.2 |      6.2 |      5.0 |   0.17 |
| webgl/context_0x35340216C9A8/drawing_buffer/shared_image_pool_9437D10669B99B92FFC908C40468F8A6 |      0.0 |      3.5 |      3.5 |   0.12 |
| partition_alloc/allocated_objects |    216.9 |    220.1 |      3.1 |   0.10 |
| partition_alloc/allocated_objects/partitions |    216.9 |    220.1 |      3.1 |   0.10 |
| partition_alloc/allocated_objects/partitions/buffer |    215.4 |    218.1 |      2.7 |   0.09 |
| gpu/mapped_memory/manager_0x0/chunk_0x30 |      0.0 |      2.0 |      2.0 |   0.07 |
| shared_memory/259D300517C789E74E03E6737493D8AB |      0.0 |      2.0 |      2.0 |   0.07 |
| blink_gc/main/allocated_objects/__fd587a7a37e335b |      0.5 |      2.0 |      1.5 |   0.05 |
| blink_objects/blink_gc/main/blink::HeapHashTableBacking<blink::HashTable<blink::String, blink::KeyValuePair<blink::String, cppgc::internal::BasicMember<blink::NetworkResourcesData::ResourceData, cppgc::internal::StrongMemberTag, cppgc::internal::DijkstraWriteBarrierPolicy>>, blink::KeyValuePairExtractor, blink::HashMapValueTraits<blink::HashTraits<String>, blink::HashTraits<cppgc::internal::BasicMember<blink::NetworkResourcesData::ResourceData, cppgc::internal::StrongMemberTag, cppgc::internal::DijkstraWriteBarrierPolicy>>>, blink::HashTraits<String>, blink::HeapAllocator>> (0x27e) |      0.5 |      2.0 |      1.5 |   0.05 |
| blink_gc/main/heap/LargePageSpace |      0.4 |      1.7 |      1.3 |   0.04 |
| malloc/partitions/allocator/thread_cache |      2.7 |      3.7 |      1.0 |   0.03 |
| v8/main/heap/old_space |      7.8 |      8.5 |      0.8 |   0.02 |
| blink_gc/main/allocated_objects/__5fc1c024e2ff6827 |      0.0 |      0.7 |      0.7 |   0.02 |
| blink_objects/blink_gc/main/PerformanceEventTiming (0x1d5) |      0.0 |      0.7 |      0.7 |   0.02 |
| partition_alloc/partitions/array_buffer |      0.8 |      1.3 |      0.5 |   0.02 |
| partition_alloc/partitions/array_buffer/buckets |      0.8 |      1.3 |      0.5 |   0.02 |
| v8 |     11.8 |     12.3 |      0.5 |   0.02 |
| v8/main |     11.8 |     12.3 |      0.5 |   0.02 |
| v8/main/heap |     11.6 |     12.1 |      0.5 |   0.02 |
| blink_gc/main/heap/NormalPageSpace2 |      1.4 |      0.9 |     -0.5 |  -0.02 |
| gpu/mapped_memory/manager_0x0/chunk_0xa |      2.0 |      0.0 |     -2.0 |  -0.07 |
| shared_memory/5251C5FD2A87F31C15325850FE368D24 |      2.0 |      0.0 |     -2.0 |  -0.07 |
| malloc/allocated_objects/partitions/allocator |     21.8 |     18.5 |     -3.4 |  -0.11 |
| malloc/allocated_objects/partitions |     22.0 |     18.6 |     -3.4 |  -0.11 |
| malloc/allocated_objects |     23.9 |     20.5 |     -3.4 |  -0.11 |
| webgl/context_0x35340216C9A8/drawing_buffer/exported_color_buffers |     10.5 |      7.0 |     -3.5 |  -0.12 |
| gpu/transfer_buffer_memory/buffer_0x14 |      4.0 |      0.0 |     -4.0 |  -0.13 |
| gpu/transfer_buffer_memory/buffer_0x13 |     16.0 |      0.0 |    -16.0 |  -0.53 |
| shared_memory/4C06203E387B851526D98B2715A0035C |     16.0 |      0.0 |    -16.0 |  -0.53 |
