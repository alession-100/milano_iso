# T-0.3 evidence index

All files fetched 2026-11-15 with `curl -A "milano-iso-audit/0.1"`. Paths are relative to this folder.

| Claim (DATA_SOURCES.md) | File or URL |
|---|---|
| Geofabrik has Nord-Ovest and no Lombardia sub-region | `geofabrik_italy.html`, `geofabrik_nord-ovest.html` ("No sub regions are defined") |
| Nord-Ovest extract: URL, redirect to dated file | `geofabrik_nord-ovest_head.txt` (307, Location `nord-ovest-261114.osm.pbf`) |
| Size 595,473,987 bytes; Last-Modified 2026-11-15 04:01:16 GMT | `geofabrik_nord-ovest_dated_head.txt` |
| OSM data up to 2026-11-14T21:20:41Z; "License: ODbL 1.0"; 567 MB | `geofabrik_nord-ovest.html` |
| Clip polygon | `nord-ovest.poly` (fetched, 15.5 KB) |
| OSM licence ODbL and attribution requirements | `osm_copyright.html` (https://www.openstreetmap.org/copyright); `osm_attribution_guidelines.html` (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines): accepts "(c) OpenStreetMap contributors" |
| Overture latest release 2026-10-21.0, schema v2.0.0 | `overture_stac_catalog.json` (`"latest":"2026-10-21.0"`), `overture_release_calendar.html` |
| Overture buildings S3/Azure paths, sources, OSM primary source, height merge | `overture_buildings_guide.html` (https://docs.overturemaps.org/guides/buildings/) |
| Overture buildings licence ODbL | `overture_attribution.html` (https://docs.overturemaps.org/attribution/) |
| Overture PMTiles link | `overture_buildings_catalog.json` |
| Overture buildings total size 276,943,764,116 bytes, 512 files | `overture_s3_listing.xml` (S3 ListObjectsV2, IsTruncated false; sum of `<Size>` computed with a one-line Python snippet) |
| Overture schema has height/num_floors | `overture_schema_building.html` |
| DBT spec page and file links | `dbt_specifiche_page.html`, `geoportale_home.html`, `dbt_spec_pdf_head.txt` (12,386,999 bytes) |
| `UN_VOL_AV` = "altezza volume", `UN_VOL_QE` | `dbt_mapping_UN_VOL_excerpt.txt` (text extracted from `Mapping_Dataset_Specifica_Completa.pdf` inside `Shp_Flat_Schema.zip`, 1,926,094 bytes, downloaded in full to a scratch dir outside the repo and not kept) |
| Milano DBT 2020 `UN_VOL.dbf` fields, record count, height statistics | `dbt_milano_UN_VOL_probe.txt`, produced by `dbt_dbf_probe.py` on the 4,088,379 bytes range-read from the Comune ZIP (central directory read via HTTP range on the last 533,009 bytes) |
| Regional open DBT datasets exist only for Lecco and Sondrio; licences | `dati_lombardia_dbt_search.json` (Socrata catalog, query "DBT") |
| Milano covered in regional DBT progress list (survey 2020, "Iniziativa comunale") | `dbt_stato_avanzamento_milano.json`; licence CC0 in `dbt_82bu_view.json` |
| Comune di Milano DBT 2020 dataset, licence `cc-by`, resources, WMS, notes | `comune_pkg_ds2889_database-topografico-dbt-2020-shp.json`, `comune_dbt2020_page.html` |
| DBT 2020 ZIP size 596,533,009 bytes, Last-Modified 2023-04-06 | `comune_dbt2020_zip_head.txt` |
| Comune CKAN search for DBT datasets (2012/2020, SHP/DWG) | `comune_ckan_dbt_search.json` |
| Comune boundary dataset, GeoJSON resource, size 1,917,280 (CKAN), last modified 2024-11-04 | `comune_pkg_ds2841-confini-amministrativi-del-comune-di-milano.json`, `comune_confine_geojson_head.txt` (no Content-Length returned), `comune_ckan_boundary_search.json` |
| Green-area candidates | `comune_ckan_green_search.json` |
| Duomo OSM element relation/18017026 with geometry | `overpass_wikidata_Q18068.json` (query: `nwr["wikidata"="Q18068"](45.45,9.17,45.48,9.21);out geom;`) |
| Wikidata Q18068 P625 = 45.463968, 9.190578 | `wikidata_Q18068.json`; QID found with `wikidata_search_duomo.json` |
| Origin, AOI bbox, distance | `python pipeline/scripts/origin_from_sources.py` (output in report R-0.3) |
| GitHub Pages limits (1 GB site, 1 GB repo, 10 min, 100 GB/month, 10 builds/h) | `pages_limits.html` (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| Repository file limits 50 MiB warning / 100 MiB block | `large_files.html` (https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) |
| Custom headers: no statement found | `what_is_pages.html`, `docs_search_headers.json` (search hits contain no header statement) |
| DTM: out of scope, not audited | no fetch |

Notes on process: one first Overpass request (a global `wikidata=Q18068` filter without bbox) returned HTTP 502 and its response was overwritten by the bbox-limited retry. An earlier Overpass request was a mistaken tag-count query whose output was discarded. Total Overpass requests: 3, spaced by more than 1 s.
