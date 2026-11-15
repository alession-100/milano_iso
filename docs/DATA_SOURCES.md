# Data sources

Everything marked **TO VERIFY** must be confirmed in task T-0.3 (URL, format, licence text, size, retrieval date). Do not rely on this table's licence column until then.

| Source | Use | Expected content | Licence | Status |
|---|---|---|---|---|
| OpenStreetMap, via a regional extract (e.g. Geofabrik) or Overpass | Base layers: buildings, roads, rail, water, parks, named features | Footprints, `height`, `building:levels`, `building`, `name`, road classes | ODbL; attribution "(c) OpenStreetMap contributors" required | TO VERIFY (details) |
| Overture Maps (buildings) | Alternative/complementary building footprints and heights | Footprints, height where available | TO VERIFY | TO VERIFY |
| Geoportale Lombardia, topographic database (DBT) | Authoritative building heights/volumes where available | Building polygons, height attributes | TO VERIFY | TO VERIFY |
| Open data of the Comune di Milano | Municipal boundary, green areas, transport, other layers | Various | TO VERIFY (per dataset) | TO VERIFY |
| Terrain model (DTM) from the region | Terrain | Elevation grid | TO VERIFY | Out of scope for v1: Milan is essentially flat. Revisit only if needed |

## Height fallback chain (per building, first available wins)
1. Explicit height from the authoritative source (DBT), if licence and coverage allow.
2. OSM `height` tag (parse units; reject non-numeric values).
3. OSM `building:levels` x 3.0 m (+ roof allowance only if documented).
4. Overture height, if present.
5. Default per `building` type (table in the pipeline config, justified in an ADR).

Every building stores `height_m` and `height_source` in {`dbt`, `osm_height`, `osm_levels`, `overture`, `default`}.

## Data hygiene
- Raw data in `data/raw/`, never committed. Record: source URL, retrieval date, file size, SHA-256.
- One script per transformation; no manual edits to data files.
- Landmark coordinates (`tests/landmarks.yaml`) must each cite a source; never type them from memory.
