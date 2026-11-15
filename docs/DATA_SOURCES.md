# Data sources

Audited in task T-0.3 (retrieval date of every value below: **2026-11-15**, `date -u`). Evidence files are in `reports/artifacts/T-0.3/`; `evidence.md` there maps each claim to a file or URL. Nothing was downloaded beyond small API responses, HTTP HEAD requests and HTTP range reads (no dataset over 5 MB was fetched). The audit reports findings; which source is used is decided by the orchestrator.

## Source table

| # | Source | URL (download / API) | Format | Licence (name) | Licence statement URL and key quote | Size | Dataset date / version | Retrieved |
|---|---|---|---|---|---|---|---|---|
| 1 | OpenStreetMap via Geofabrik extract "Nord-Ovest" (smallest Geofabrik extract containing Milan; Geofabrik defines no Lombardia sub-region, see note 1) | `https://download.geofabrik.de/europe/italy/nord-ovest-latest.osm.pbf` (HTTP 307 to the dated file `https://download.geofabrik.de/europe/italy/nord-ovest-261114.osm.pbf`); region page `https://download.geofabrik.de/europe/italy/nord-ovest.html`; clip polygon `.../nord-ovest.poly` | OSM PBF | ODbL 1.0 | `https://www.openstreetmap.org/copyright`: "licensed under the Open Data Commons Open Database License (ODbL)" | 595,473,987 bytes (dated file, `Content-Length`; the page says 567 MB) | Contains OSM data up to 2026-11-14T21:20:41Z (Geofabrik page); file Last-Modified 2026-11-15 04:01:16 GMT | 2026-11-15 |
| 1b | OpenStreetMap via Overpass API (used only for the Duomo element in the origin section) | `https://overpass-api.de/api/interpreter` | JSON | ODbL 1.0 | same as row 1; the response carries "made available under ODbL" | 25,408 bytes (response saved) | `timestamp_osm_base` 2026-11-15T19:00:21Z | 2026-11-15 |
| 2 | Overture Maps, theme `buildings`, type `building` | S3 `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*`; Azure `https://overturemapswestus2.blob.core.windows.net/release/2026-10-21.0/theme=buildings/type=building/*`; PMTiles `https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles` | GeoParquet (spatially filtered reads possible) | ODbL (theme licence) | `https://docs.overturemaps.org/attribution/` (section "Buildings": "License for theme: ODbL"). Buildings attribution list on that page (saved `reports/artifacts/T-0.3/overture_attribution.html`): "© OpenStreetMap contributors" (Open Database License); Esri Community Maps contributors (CC BY 4.0); Global ML Building Footprints, licensed by Microsoft (Open Database License); Google Open Buildings (CC BY 4.0); USGS 3D Elevation Program Digital Elevation Program (no licence stated on the page); Qian Shi et al., East Asian buildings, doi:10.5281/zenodo.8174931 (CC BY 4.0); work derived from BTN 2024, ign.es (CC BY 4.0) | Whole planet: 512 files, 276,943,764,116 bytes (sum of `Size` in the S3 listing). The pilot AOI would be a bbox-filtered read, not the full files | Release `2026-10-21.0` (latest per `https://stac.overturemaps.org/catalog.json`; schema v2.0.0) | 2026-11-15 |
| 3a | Geoportale Lombardia, DBT as a regional dataset | Technical specification page `https://www.geoportale.regione.lombardia.it/specifiche-tecniche`; progress list (Socrata) `https://www.dati.lombardia.it/resource/82bu-bgvn.json`. Open DBT building downloads on `dati.lombardia.it` exist only for Lecco (`sh4u-buxa`) and Sondrio (`sgqp-huet`, `9giu-ksif`); NOT FOUND for Milano (tried: `dati.lombardia.it` catalog search for "DBT", "topografico", "edifici", "DBTR") | Spec: PDF + Shapefile templates; progress list: JSON/CSV | Progress list: CC0 1.0. Lecco/Sondrio building datasets: CC BY 4.0 (dataset metadata) | `https://www.dati.lombardia.it/api/views/82bu-bgvn.json` (`license.termsLink` = `http://creativecommons.org/publicdomain/zero/1.0/legalcode`) | Spec zip `Shp_Flat_Schema.zip` 1,926,094 bytes; spec PDF `Specifiche_Contenuto_Regionali_DBGT.pdf` 12,386,999 bytes (not downloaded) | Spec PDF Last-Modified 2023-04-11; progress list last updated 2025-02-27 | 2026-11-15 |
| 3b | DBT 2020 of the Comune di Milano (the DBT copy that covers Milan and is openly downloadable; published by the Comune, see row 4) | `https://gisportal.comune.milano.it/download/area_download/SIT/DBT2020/DBT_2020.zip` (also `DBT_2020_Gauss-Boaga.zip`); dataset page `https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp`; WMS `https://gisportal.comune.milano.it/federated/services/DBGT/Milano_2020_DBGT/MapServer/WMSServer` | Shapefile in a ZIP, EPSG:7791 (RDN2008 / UTM 32N) or EPSG:3003 | Creative Commons Attribution (CKAN `cc-by`); the portal states CC BY 4.0 as the default for its content (note 3) | `https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp` (field "Licenza: Creative Commons Attribution"; page text: "licenza Creative Commons Attribuzione 4.0 Internazionale (CC BY 4.0)") | 596,533,009 bytes (`Content-Length`) | Flight March/April 2020, nominal scale 1:1,000; ZIP Last-Modified 2023-04-06; inserted in the regional DBGT 2023-02-01 | 2026-11-15 |
| 4a | Comune di Milano open data: administrative boundary | `https://dati.comune.milano.it/dataset/ds2841-confini-amministrativi-del-comune-di-milano`; GeoJSON `https://dati.comune.milano.it/dataset/e75d91fa-eca6-4ee5-b96e-08bcdbb8d6f0/resource/f56cb432-83e6-48de-ae30-d39b4be61e85/download/confine_comune_milano_layer_0_confine_comune_milano.geojson`; CKAN API `https://dati.comune.milano.it/api/3/action/package_show?id=ds2841-confini-amministrativi-del-comune-di-milano` | GeoJSON (also CSV, JSON) | Creative Commons Attribution (CKAN `cc-by`; portal default CC BY 4.0) | `https://dati.comune.milano.it/dataset/ds2841-confini-amministrativi-del-comune-di-milano` (same wording as 3b) | 1,917,280 bytes (CKAN resource `size`; HEAD returns no `Content-Length`) | Resource last modified 2024-11-04 | 2026-11-15 |
| 4b | Comune di Milano open data: green areas | NOT AUDITED in detail. CKAN search (`https://dati.comune.milano.it/api/3/action/package_search?q=verde+aree`) lists, among 31 hits, `ds3018-spazi-freschi-parchi-ed-aree-verdi` (CSV, JSON, GeoJSON, licence `cc-by`). Geometry type and coverage not checked. The DBT 2020 (row 3b) also has a vegetation layer ("STRATO 06 VEGETAZIONE") | n/a | `cc-by` (CKAN field) | same portal statement as 3b | not checked | not checked | 2026-11-15 |
| 5 | Terrain model (DTM) | Out of scope for v1 (Milan is essentially flat), not audited | n/a | n/a | n/a | n/a | n/a | n/a |

Notes
1. Geofabrik page `europe/italy.html` lists the sub-regions Nord-Est and Nord-Ovest (among others); the Nord-Ovest page states "No sub regions are defined for this region." Nord-Ovest is therefore the smallest Geofabrik extract that can contain Milan. That Milan lies inside it was not checked against the `.poly` geometry.
2. Overture (row 2): its documentation says the primary source of the buildings theme is OpenStreetMap, "given the highest conflation priority", with other sources (Esri Community Maps, national/municipal datasets for Spain and Vancouver, Microsoft and Google ML footprints) filling gaps, and "height attributes are merged between matches" (IoU > 0.5). Source page: `https://docs.overturemaps.org/guides/buildings/`. The docs do not list per-feature height origins for Milan. Consequence for the height fallback chain: step 4 (Overture) is largely derived from the same OSM data as steps 2 and 3, so it adds information mainly where a building comes from a non-OSM source. Overture's licence for the theme is ODbL, consistent with ADR-0009.
3. DBT (rows 3a/3b): the regional specification (`Shp_Flat_Schema.zip`, file `Mapping_Dataset_Specifica_Completa.pdf`) defines class `UN_VOL` (Unita' volumetrica, code 020101) with attribute `UN_VOL_AV` described as "altezza volume" (height of the volume), plus `UN_VOL_QE` ("quota estrusione", extrusion elevation). Building class `EDIFC` has no height field. Confirmed on the real Milano file by reading only `UN_VOL.dbf` (4 MB, via HTTP range request on the ZIP): fields `UN_VOL_QE, UN_VOL_POR, CLASSID, UN_VOL_AV, UN_VOL_EX, CEDIUV, SCRIL`; 237,743 records; `UN_VOL_AV` filled in all records, min -0.001, median 13.226, max 200.738 (zero in 287 records). Milan city is covered: the regional progress list has MILANO (ISTAT 15146), project "Iniziativa comunale", survey year 2020 (`reports/artifacts/T-0.3/dbt_stato_avanzamento_milano.json`). Whether `UN_VOL_AV` is a roof or eave height, and how volumes join to `EDIFC` footprints (key `CEDIUV` / `CLASSID`), is not established and must be checked before use. The Regione Lombardia licence for the Milano DBT was not found; the Comune's own publication (CC BY) is the one with a recorded licence. Overture describes CC BY 4.0 as a compatible licence for ODbL ("such as CC BY 4.0"); using it still requires visible attribution to the Comune di Milano (ADR-0009, hard rule 10).

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

## Map origin and pilot AOI (ADR-0004)

Computed by `pipeline/scripts/origin_from_sources.py` from `reports/artifacts/T-0.3/overpass_wikidata_Q18068.json` (Overpass `out geom`, OSM base timestamp 2026-11-15T19:00:21Z) and `reports/artifacts/T-0.3/wikidata_Q18068.json` (entity last modified 2026-11-14T13:04:20Z). Retrieved 2026-11-15.

| Item | Value |
|---|---|
| OSM element | relation/18017026, `name=Duomo di Milano`, `building=cathedral`, `wikidata=Q18068`, multipolygon of 88 outer ways, footprint area 10,260.9 m2 (EPSG:32632) |
| OSM centroid, WGS84 | lat 45.4641864, lon 9.1915991 |
| OSM centroid, EPSG:32632 | E 514978.51, N 5034535.58 |
| Wikidata | Q18068 (Milan Cathedral), property P625 |
| Wikidata, WGS84 | lat 45.463968, lon 9.190578 |
| Wikidata, EPSG:32632 | E 514898.74, N 5034511.13 |
| Distance OSM centroid to Wikidata | 83.4 m (exceeds the 50 m escalation threshold of T-0.3; see the report R-0.3) |
| **Origin (OSM centroid, EPSG:32632, rounded)** | **E 514979, N 5034536** |
| **AOI bbox, EPSG:32632 (xmin, ymin, xmax, ymax)** | **514479, 5034036, 515479, 5035036** |
| AOI corners, WGS84 (lat, lon) | SW 45.459700, 9.185195; SE 45.459679, 9.197985; NE 45.468680, 9.198017; NW 45.468701, 9.185224 |

The OSM bounds of the element are lon 9.1906066 to 9.1926144 and lat 45.4637835 to 45.4645853; the Wikidata point lies at the western edge of that extent, the OSM centroid near the middle. Reproduce with: `uv run python pipeline/scripts/origin_from_sources.py`. The values are frozen in `pipeline/milano_iso/config.py` and protected by `tests/pipeline/test_origin.py`.

Correction 2026-11-15 (T-0.3a): the first version of this section used a numerically unstable centroid (shoelace on raw coordinates of about 5e6 m), which shifted the centroid by about 0.27 m in northing and rounded the origin to E 514978, N 5034535. The values above are corrected and agree with shapely `Polygon.centroid`.

## Hosting limits (ADR-0005)

Source: `https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits` (saved as `reports/artifacts/T-0.3/pages_limits.html`), retrieved 2026-11-15.

| Limit | Quote | URL |
|---|---|---|
| Published site size | "Published GitHub Pages sites may be no larger than 1 GB." | Pages limits URL above |
| Source repository size | "GitHub Pages source repositories have a recommended limit of 1 GB." | Pages limits URL above |
| Deployment time | "GitHub Pages deployments will timeout if they take longer than 10 minutes." | Pages limits URL above |
| Bandwidth | "GitHub Pages sites have a soft bandwidth limit of 100 GB per month." | Pages limits URL above |
| Builds | "GitHub Pages sites have a soft limit of 10 builds per hour." The page adds that this limit does not apply when the site is built and published with a custom Actions workflow | Pages limits URL above |
| Single file size | The Pages limits page gives no per-file limit. The repository file limit is: "GitHub blocks files larger than 100 MiB." (a warning from 50 MiB) | `https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github` |
| Custom response headers | NOT FOUND (tried: the Pages limits page; "What is GitHub Pages?" page `https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages`; docs search API with query "pages custom http headers"). No docs statement about custom headers was found, so ADR-0005's "no custom headers" remains unconfirmed from the provider's documentation | n/a |
