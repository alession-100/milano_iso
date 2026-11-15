# T-1.5 element choices

All QIDs were chosen by reading the saved Wikidata search responses (`responses/search_*.json`), then the
saved entity JSON. All OSM candidates are the elements Overpass returned for `wikidata=<QID>`
(`responses/overpass_<QID>.json`). Only the cases below needed a judgement.

## QID choices
- **CityLife towers.** Searching the English project names returns Wikidata items whose labels are the
  architect names: Q3995200 "Torre Isozaki" (en: Allianz Tower), Q3995195 "Torre Hadid" (en: Generali Tower),
  Q3995204 "Torre Libeskind" (en: Libeskind Tower), all "grattacielo di Milano". For PwC, the search "Torre PwC"
  also returns Q651643 (label "Torre PwC", description just "skyscraper", no city), plus PwC towers in Auckland and
  Berlin. Q3995204 was chosen because its description says Milan and it is the one OSM tags on the tower
  (Overpass for Q3995204 returns relation 18247388 "Torre Libeskind"). Q651643 was not fetched or examined.
- **Palazzo Reale.** The it/en search "Palazzo Reale Milano" returned nothing; "Palazzo Reale" (it) returns many cities;
  Q51105 "Palazzo Reale di Milano" (en: Royal Palace of Milan) was chosen.
- **Palazzo delle Assicurazioni Generali (Piazza Cordusio).** Many cities have a building with this name. Q28150806
  is the one described "edificio storico di Milano".
- **Bosco Verticale.** Only one item exists in the searches (Q2501413, "edificio di Milano"); the two towers share it.

## OSM element choices
- **Duomo di Milano:** relation/18017026, the only element; same one as ADR-0004 (centroid E 514978.51, N 5034535.58 reproduced).
- **Bosco Verticale (two towers):** Overpass returns four elements for Q2501413: node/11155707089 (tourism
  attraction point), relation/16020020 (`type=site`, groups the towers), way/179244686 "Torre Confalonieri"
  (`building=residential`, height 78), way/179244688 "Torre De Castillia" (`building=apartments`, height 111).
  Each tower is its own entry using its own building way. The node and the site relation are not footprints.
  The task says "each of its two towers"; which tower is called D or E in other sources was not checked, only the OSM names are used.
- **Stazione di Milano Centrale:** NOT the station building. Overpass returns only node/6067258870
  (`railway=station`, `public_transport=station`) and relation/11556082 (`type=public_transport`, `stop_area`. Its
  members were not inspected). No element with `building=*` carries the QID. The node is used
  (`method: node`). The node is 32.5 m from Wikidata P625. The task asked for the station building footprint, so this
  entry is a fallback and the orchestrator should decide whether to look for the building polygon (it would need an
  element not tagged with the QID, which the card's method does not cover).
- **Galleria Vittorio Emanuele II:** five ways carry the QID. Only way/166623705 is a closed way (area 4090 m2,
  `building=roof`, glass roof, 32 nodes). The others are open ways (way/163757278 and way/1261410658 have no
  `building` tag; way/166623693 and way/331883966 are `tourism=artwork` mosaics "Stemma dei Savoia"), so they are
  not polygons. The roof polygon is the footprint. Its P625 is 1.7 m away, consistent.
- **Stadio Giuseppe Meazza:** way/218520505 is the only element; it has `leisure=stadium` but no `building=*`.
  The closed outline of the stadium is used as the footprint.
- **Multipolygon relations** (Castello Sforzesco, Torre Velasca, Torre Hadid, Torre Libeskind, Palazzo Reale, Teatro alla
  Scala, Palazzo Marino, Palazzo delle Assicurazioni Generali): one element each; the centroid is the area-weighted
  centroid of the outer rings minus the inner rings. Castello Sforzesco relation/1918 is a
  multipolygon; its centroid is 73 m from P625.
- Remaining single-element ways (Grattacielo Pirelli, Torre Isozaki) are plain closed building ways.
