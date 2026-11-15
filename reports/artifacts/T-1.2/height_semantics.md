# DBT 2020: height semantics of UN_VOL (T-1.2)

Specification: `Specifiche_Contenuto_Regionali_DBGT.pdf` (manifest `pipeline/manifests/dbt_spec.json`,
12,386,999 bytes), Regione Lombardia, Strato 02 "Immobili ed antropizzazioni". Page numbers are the
printed "pag.N di 456" footers, which equal the PDF page index (checked on pp. 129-135). Quotes are
Italian, verbatim from the PDF text (pdftotext), each under 15 words. Empirical numbers come from
`summary.json` (pilot extract, `data/interim/dbt_pilot.gpkg`) unless marked "citywide" (the whole ZIP).

Shapefile layer names in the ZIP: `UN_VOL`; the class `EDIFC` is split over `EDIFC_CR_EDF_IS` (ground
footprint), `EDIFC_CR_EDF_ME` (maximum extent) and `EDIFC_CR_EDF_ME_SR` (see `schema.md`).
The field names `CLASSID`, `CLASSREF`, `CEDIUV`, `SUBREGID`, `SCRIL` do not occur in this PDF; the
PDF uses the role name "Cediuv" (see point 4).

## 1. What UN_VOL_AV measures

- **Spec (p.133):** attribute 02010102 `UN_VOL_AV`, "altezza volume", Real: "specifica l'altezza della
  porzione dell'edificio ai fini del calcolo delle volumetrie".
- **Spec (p.129):** the top of a volume unit is a flat surface whose elevation "viene detta quota di
  gronda dell'unità volumetrica" (eave level).
- **Spec (p.130):** "il contributo volumetrico ... non include ad esempio la volumetria dei sottotetti"
  (roof space is not part of the volume unit). So the spec describes a flat-topped volume up to the
  eave level, not a ridge height.
- **Spec (p.130):** the height is "la 'reale' altezza dell'unità volumetrica", normally from a source
  other than the aerial photogrammetry.
- **Spec gap:** the text does not state in one sentence that `UN_VOL_AV` equals extrusion elevation
  minus base elevation.
- **Observation (pilot):** `UN_VOL_AV` equals `UN_VOL_QE` minus the lowest Z of the base ring within
  0.001 for all 4,209 volumes with `UN_VOL_POR` 01 and all 196 with 04 (`av_vs_qe_minus_base_z`).
  For code 02: 36 of 40 match within 0.05 (max deviation 7.663). For code 03: all 212 differ by a
  constant 3.5 (`QE - baseZ - AV` = 3.5, min 3.4999999999999822, max 3.5000000000000178).
  The 3.5 offset for code 03 is consistent with the p.133 note that an intrados height is added to
  the base elevation of a portico volume, but the PDF does not give 3.5; treat the cause as unknown.
- **Conclusion:** `UN_VOL_AV` is the height of a flat-topped volume above its base, up to eave level
  (spec p.129-130, p.133). For ground-based volumes (code 01) the base is at ground level (spec
  p.129 case a). Not a ridge height.

## 2. What UN_VOL_QE measures

- **Spec (p.134):** attribute 02010107 `UN_VOL_QE`, "quota estrusione", Real. `UN_VOL_EX` (02010108,
  "tipo estrusione") has domain 01 "estrusione in quota", 02 "altezza".
- **Spec (p.125):** "Essendo le quote di estrusione valori assoluti".
- **Spec (p.129-130):** the extrusion elevation of a volume unit is its eave elevation.
- **NOT IN SPEC:** the vertical datum (orthometric vs ellipsoidal) of `UN_VOL_QE`.
- **Observation (pilot):** `UN_VOL_EX` is 01 in all 4,657 volumes (citywide: all 237,743), so by the
  p.134 domain `UN_VOL_QE` is an absolute elevation, not a height. Range min 117.17, median 139.739,
  max 217.229. Together with point 1, `UN_VOL_QE` = base elevation + `UN_VOL_AV`.

## 3. Units

- **NOT IN SPEC** for `UN_VOL_AV` and `UN_VOL_QE`: p.133-134 give type "Real" and no unit. A search of
  the PDF text found no unit statement for these attributes.
- **Observation:** `UN_VOL_AV` and `UN_VOL_QE` minus the Z of the base ring agree to 0.001 (point 1),
  and the layer CRS is EPSG:7791, a metre-based UTM system, so the values are consistent with metres.
  `UN_VOL_AV` pilot range 0.703 to 100.119, median 19.72. Metres is an inference, not a spec statement.

## 4. How UN_VOL relates to EDIFC

- **Spec (p.134):** role "Cediuv [1]: CR_EDF inverso Uvdice [0..*]" on `UN_VOL`: each volume unit has
  exactly one building.
- **Spec (p.142):** role "Uvdice [0..*]: UN_VOL inverso Cediuv [1]" on the building: a building has
  zero or more volumes. Relation is one-to-many (building to volumes).
- **Spec (p.135):** "L'edificio è associato ad una o più Unità Volumetriche (nel caso siano state
  previste)".
- **Spec (p.135, p.151):** `EDIFC` and `EDI_MIN` ("Edificio minore") are both "SOTTOCLASSE DI : CR_EDF",
  so the `Cediuv` role can point to either subclass.
- **Observation (key):** the Shapefile field `UN_VOL.CEDIUV` holds ids of the form `EDIFC_<n>` or
  `EDI_MIN_<n>`; `EDIFC_CR_EDF_*.CLASSREF` holds `EDIFC_<n>`. The PDF does not name the Shapefile
  fields, so `CEDIUV` = `CLASSREF` is an observation. `UN_VOL.CLASSID` (`UN_VOL_<n>`) is the volume's own id.
- **Observation (pilot):** 4,610 of 4,657 volumes (98.99%) join to `edifc_me` on `CEDIUV = CLASSREF`
  (4,609 = 98.97% to the ground footprint layer `edifc`). All 47 unmatched have `CEDIUV` prefix
  `EDI_MIN_`; they are not in the citywide `EDIFC_CR_EDF_ME`, and all 47 are in citywide
  `EDI_MIN_CR_EDF_ME`. Citywide: 86.51% of `CEDIUV` match `EDIFC_CR_EDF_ME`, 13.49% match
  `EDI_MIN_CR_EDF_ME`, together 100%.
- **Observation (pilot):** every `edifc_me` building (171) has at least one volume; `edifc` has 170
  (one `edifc_me` building has no ground-footprint record). Volumes per building: min 1,
  median 14, max 196 (histogram in `summary.json`). One-to-many is confirmed.

## 5. UN_VOL_POR and other code fields

- **Spec (p.133):** `UN_VOL_POR` "tipo di porzione": "qualifica le porzioni di aggetto o costituenti
  sottopassaggio o portico". Domain: 01 "al suolo", 02 "ad aggetto", 03 "soffitto di portico",
  04 "soffitto di sottopassaggio" (p.133); 05 "soffitto di loggia", 06 "intermedia", 07
  "sovrapposta", 08 "sotterranea", 09 "archivolto, corridoio coperto", 95 "altro" (p.134).
  (In the PDF text the p.134 descriptions are laid out in a table; labels are read in order.)
- **Spec (p.133):** for 02, 03, 04 the base ring is not at ground level (overhang, portico or
  underpass ceiling), so those volumes do not stand on the ground.
- **Spec (p.130):** voids under porticoes and underpasses contribute no volume.
- **Other fields:** `UN_VOL_EX` (point 2) is 01 everywhere; `SCRIL` is the single value `RC2` in all
  237,743 records; `SCRIL` is not defined in this PDF (**NOT IN SPEC**), observation only.
- **Observation (pilot counts per `UN_VOL_POR`):** 01: 4,209; 02: 40; 03: 212; 04: 196.
  Citywide: 01: 214,233; 02: 6,540; 03: 3,488; 04: 13,405; 05: 40; 07: 1; 08: 35; 09: 1.
  The pilot has no 05-09 (so no underground volumes in the pilot).
- **Conclusion for use:** by the spec, only code 01 is a ground-based volume; 02-04 are elevated
  (base above ground) and 08 is underground. Which codes T-1.4 renders is its decision.

## 6. The 287 zero-height records and the negative minimum

- **NOT IN SPEC:** the PDF does not discuss zero or negative `UN_VOL_AV`. (p.133 only notes that the
  value "trova origine generalmente da fomti differenti" (sic), i.e. not from the photogrammetry.)
- **Observation (citywide):** 287 records with `UN_VOL_AV` = 0 (matches DATA_SOURCES note 3) and 2
  with -0.001 (the minimum). Of those 289 records, 286 have `UN_VOL_POR` 01 and 3 have 03.
  The -0.001 values look like numeric noise around zero, but that is a guess, not an observation.
- **Observation (pilot):** none. Pilot `UN_VOL_AV` min 0.703, zero count 0, negative count 0.
- **Not established:** whether a zero height means "not surveyed" or a true zero-height volume.
  Needs a decision before the full comune (Phase 6); no effect on the pilot.

## CRS note (for T-1.3)

`pyproj.TransformerGroup` from EPSG:7791 to EPSG:32632 returns exactly one operation:
"Inverse of UTM zone 32N + RDN2008 to WGS 84 (1) + UTM zone 32N", accuracy 1.0 m. Its PROJ
definition is `inv utm zone=32 ellps=GRS80` then `utm zone=32 ellps=WGS84`: no datum shift, only the
GRS80 to WGS84 ellipsoid change. At the pilot centre (514979, 5034536, read as EPSG:7791) the
computed shift is dE = -1.3e-7 m, dN = +1.2e-4 m, i.e. no practical positional effect beyond the
stated 1 m accuracy. Details in `summary.json` (`crs_transform`).
