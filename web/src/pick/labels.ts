import type { Lang } from '../i18n';

/**
 * Localized labels for data values (T-5.1). The values (`height_source`, road `class`, green and
 * water `kind`, ...) are data; the words are UI strings. A value without a label is shown as it is
 * in the data, never guessed.
 */
export type LabelTable = Record<string, { it: string; en: string }>;

/** Every `height_source` value written by the pipeline (heights.py, decor.py) and by the e2e fixture. */
export const HEIGHT_SOURCE_LABELS: LabelTable = {
  dbt: { it: 'rilievo DBT 2020', en: 'DBT 2020 survey' },
  osm_height: { it: 'OSM (altezza indicata)', en: 'OSM (height tag)' },
  osm_levels: { it: 'OSM (numero di piani)', en: 'OSM (number of levels)' },
  default: { it: 'default stimato', en: 'estimated default' },
  style_default: { it: 'default stimato', en: 'estimated default' },
  fixture: { it: 'dato sintetico di prova', en: 'synthetic test data' },
};

export const ROAD_CLASS_LABELS: LabelTable = {
  motorway: { it: 'Autostrada', en: 'Motorway' },
  trunk: { it: 'Strada extraurbana principale', en: 'Trunk road' },
  primary: { it: 'Strada primaria', en: 'Primary road' },
  secondary: { it: 'Strada secondaria', en: 'Secondary road' },
  tertiary: { it: 'Strada terziaria', en: 'Tertiary road' },
  unclassified: { it: 'Strada locale', en: 'Minor road' },
  residential: { it: 'Strada residenziale', en: 'Residential street' },
  living_street: { it: 'Zona residenziale a traffico limitato', en: 'Living street' },
  service: { it: 'Strada di servizio', en: 'Service road' },
  pedestrian: { it: 'Strada pedonale', en: 'Pedestrian street' },
  footway: { it: 'Percorso pedonale', en: 'Footway' },
  steps: { it: 'Scalinata', en: 'Steps' },
  path: { it: 'Sentiero', en: 'Path' },
  cycleway: { it: 'Pista ciclabile', en: 'Cycleway' },
  platform: { it: 'Banchina', en: 'Platform' },
  track: { it: 'Strada sterrata', en: 'Track' },
};

export const GREEN_KIND_LABELS: LabelTable = {
  park: { it: 'Parco', en: 'Park' },
  garden: { it: 'Giardino', en: 'Garden' },
  grass: { it: 'Prato', en: 'Grass' },
  flowerbed: { it: 'Aiuola', en: 'Flowerbed' },
  meadow: { it: 'Prato', en: 'Meadow' },
  wood: { it: 'Bosco', en: 'Wood' },
  forest: { it: 'Bosco', en: 'Forest' },
  playground: { it: 'Area giochi', en: 'Playground' },
  pitch: { it: 'Campo sportivo', en: 'Sports pitch' },
  cemetery: { it: 'Cimitero', en: 'Cemetery' },
};

export const WATER_KIND_LABELS: LabelTable = {
  water: { it: "Specchio d'acqua", en: 'Water' },
  reflecting_pool: { it: 'Vasca', en: 'Reflecting pool' },
  basin: { it: 'Bacino', en: 'Basin' },
  fountain: { it: 'Fontana', en: 'Fountain' },
  pond: { it: 'Stagno', en: 'Pond' },
  river: { it: 'Fiume', en: 'River' },
  canal: { it: 'Canale', en: 'Canal' },
};

export const LANDUSE_KIND_LABELS: LabelTable = {
  residential: { it: 'Zona residenziale', en: 'Residential area' },
  commercial: { it: 'Zona commerciale', en: 'Commercial area' },
  retail: { it: 'Zona commerciale', en: 'Retail area' },
  industrial: { it: 'Zona industriale', en: 'Industrial area' },
  construction: { it: 'Area di cantiere', en: 'Construction site' },
  railway: { it: 'Area ferroviaria', en: 'Railway area' },
  religious: { it: 'Area religiosa', en: 'Religious area' },
  education: { it: 'Area scolastica', en: 'Education area' },
  institutional: { it: 'Area istituzionale', en: 'Institutional area' },
  civic_admin: { it: 'Area amministrativa', en: 'Civic area' },
  military: { it: 'Area militare', en: 'Military area' },
};

export const BUILDING_GROUP_LABELS: LabelTable = {
  residential: { it: 'Edificio residenziale', en: 'Residential building' },
  commercial: { it: 'Edificio commerciale o per uffici', en: 'Commercial or office building' },
  civic: { it: 'Edificio civico o religioso', en: 'Civic or religious building' },
  industrial: { it: 'Edificio industriale', en: 'Industrial building' },
  other: { it: 'Edificio', en: 'Building' },
};

export const TREE_SOURCE_LABELS: LabelTable = {
  osm_tree: { it: 'Albero mappato in OSM', en: 'Tree mapped in OSM' },
  osm_tree_row: { it: 'Albero di un filare mappato in OSM', en: 'Tree of a row mapped in OSM' },
};

/** Fallback type labels, by layer or by search-index kind. */
export const KIND_LABELS: LabelTable = {
  buildings: { it: 'Edificio', en: 'Building' },
  building: { it: 'Edificio', en: 'Building' },
  roads: { it: 'Strada', en: 'Street' },
  street: { it: 'Strada', en: 'Street' },
  green: { it: 'Area verde', en: 'Green area' },
  water: { it: 'Acqua', en: 'Water' },
  landuse: { it: 'Uso del suolo', en: 'Land use' },
  trees: { it: 'Albero', en: 'Tree' },
  landmark: { it: 'Punto di riferimento', en: 'Landmark' },
};

/** Label of `value` in `table`, or the data value itself when the table has none. */
export function labelOf(table: LabelTable, value: string, lang: Lang): string {
  return Object.hasOwn(table, value) ? table[value][lang] : value;
}
