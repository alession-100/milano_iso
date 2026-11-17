/**
 * STYLE, not data (CLAUDE.md hard rule 1): every colour below is an artistic choice of the
 * Milano Iso look. None of them is measured or derived from a source; what is data is only the
 * *category* a feature falls into (its `building_type`, road `class`, `landmark_id`).
 *
 * The surface palette is defined once, has at most 32 entries (ADR-0029, checked by palette.test.ts)
 * and is uploaded as one uniform array. A byte in the per-tile lookup texture is an index into it, so the
 * order of PALETTE_ORDER is part of the contract. Roofs and walls of one building share one
 * colour: they differ only through lighting.
 *
 * T-4.3 appended the land-use, green and water kind colours after palette v1 (never reorder or
 * recolour the v1 entries: the owner approved them). Every entry has a night colour in NIGHT_PALETTE.
 */
export const PALETTE = {
  /** Ground plane and page background (muted warm grey). */
  ground: 0xe3ded4,
  roadMajor: 0x8d8f94,
  roadMinor: 0xa9a9a6,
  roadPedestrian: 0xd2c7b0,
  roadAreas: 0xc2bfb8,
  rail: 0x6e6b73,
  water: 0x8cb9cf,
  green: 0xa9c58f,
  landuse: 0xd5d0c1,
  buildingResidential: 0xe0c2a2,
  buildingCommercial: 0xc9a9a0,
  buildingCivic: 0xd8cfa4,
  buildingIndustrial: 0xaeb3b8,
  buildingOther: 0xd6d0c8,
  /** Accent for buildings that carry a `landmark_id`. */
  landmark: 0xd2745c,
  // --- T-4.3 additions (appended; the entries above are palette v1) ---
  /** Land-use kinds; `landuse` above stays the colour of "other" and of unknown kinds. */
  landuseResidential: 0xd9d1c0,
  landuseCommercial: 0xddcec3,
  landuseIndustrial: 0xcdcfcb,
  landuseCivic: 0xddd7bd,
  /** Green kinds; `green` above is park/garden and the fallback. */
  greenGrass: 0xbfd49b,
  greenWood: 0x8caf7c,
  greenPitch: 0x9fc3a2,
  /** Small basins (reflecting pools, fountains); `water` above is the fallback. */
  waterPool: 0x9cc7d9,
  // --- T-4.1 additions (appended after T-4.3) ---
  /** Tree crown (low-poly cone), a little darker than the green areas it stands on. */
  treeCrown: 0x7ea468,
  /** Tree trunk. */
  treeTrunk: 0x8b6f55,
  /** Road markings (dashed centre lines, zebra stripes). */
  markingWhite: 0xf1eee6,
  // --- T-4.2 additions (appended after T-4.1): stylised landmark details ---
  /** Spires, pinnacles and crowns on landmarks: the landmark accent (0xd2745c) mixed 35% with white. */
  landmarkDetail: 0xe2a595,
  /** Glass roofs (Galleria vault, station shed): a pale cool tint. */
  landmarkGlass: 0xc9dde0,
} as const;

export type PaletteName = keyof typeof PALETTE;

/** Palette order: the index of a name here is the byte stored in the lookup texture. */
export const PALETTE_ORDER: readonly PaletteName[] = [
  'ground',
  'roadMajor',
  'roadMinor',
  'roadPedestrian',
  'roadAreas',
  'rail',
  'water',
  'green',
  'landuse',
  'buildingResidential',
  'buildingCommercial',
  'buildingCivic',
  'buildingIndustrial',
  'buildingOther',
  'landmark',
  'landuseResidential',
  'landuseCommercial',
  'landuseIndustrial',
  'landuseCivic',
  'greenGrass',
  'greenWood',
  'greenPitch',
  'waterPool',
  'treeCrown',
  'treeTrunk',
  'markingWhite',
  'landmarkDetail',
  'landmarkGlass',
];

export const MAX_PALETTE_COLOURS = 32;

export function paletteIndex(name: PaletteName): number {
  return PALETTE_ORDER.indexOf(name);
}

/**
 * Night palette (STYLE, not data): a cool, dark version of every day colour. The type forces a
 * night colour for each palette entry, so adding a day colour without a night one does not compile.
 */
export const NIGHT_PALETTE: Record<PaletteName, number> = {
  ground: 0x2e3650,
  roadMajor: 0x4b5168,
  roadMinor: 0x58607a,
  roadPedestrian: 0x6a6a7a,
  roadAreas: 0x565d78,
  rail: 0x3d4157,
  water: 0x2f6488,
  green: 0x44705a,
  landuse: 0x363f5a,
  buildingResidential: 0x8f7e86,
  buildingCommercial: 0x7f7283,
  buildingCivic: 0x8c8794,
  buildingIndustrial: 0x6c7488,
  buildingOther: 0x858899,
  landmark: 0xc9715e,
  landuseResidential: 0x384260,
  landuseCommercial: 0x3d4160,
  landuseIndustrial: 0x343e58,
  landuseCivic: 0x3f4563,
  greenGrass: 0x4c7a5e,
  greenWood: 0x365e4f,
  greenPitch: 0x447a6c,
  waterPool: 0x3d7599,
  treeCrown: 0x3b6350,
  treeTrunk: 0x4d4048,
  markingWhite: 0x9aa0b8,
  landmarkDetail: 0xd9907f,
  landmarkGlass: 0x6f9bb8,
};

export type StyleMode = 'day' | 'night';

export function paletteFor(mode: StyleMode): Record<PaletteName, number> {
  return mode === 'night' ? NIGHT_PALETTE : PALETTE;
}

/** Light colours (style, not part of the surface palette). */
export const LIGHT_COLOURS = {
  sun: 0xfff4e0,
  skyFill: 0xffffff,
  groundFill: 0xa89f94,
} as const;

/** Night lights (style): a cool, low "moon" key and a dim cool fill. */
export const NIGHT_LIGHT_COLOURS = {
  sun: 0x9db4ff,
  skyFill: 0x7f93c9,
  groundFill: 0x2b2f45,
} as const;

// Category mapping (data category -> palette name). The categories are data, the colours style.

export type BuildingGroup = 'residential' | 'commercial' | 'civic' | 'industrial' | 'other';

const BUILDING_GROUPS: Record<string, BuildingGroup> = {
  // residential
  apartments: 'residential',
  house: 'residential',
  residential: 'residential',
  detached: 'residential',
  terrace: 'residential',
  semidetached_house: 'residential',
  dormitory: 'residential',
  // commercial / office
  commercial: 'commercial',
  office: 'commercial',
  retail: 'commercial',
  supermarket: 'commercial',
  hotel: 'commercial',
  kiosk: 'commercial',
  // civic / religious
  church: 'civic',
  cathedral: 'civic',
  chapel: 'civic',
  public: 'civic',
  civic: 'civic',
  government: 'civic',
  university: 'civic',
  college: 'civic',
  school: 'civic',
  hospital: 'civic',
  theatre: 'civic',
  museum: 'civic',
  train_station: 'civic',
  // industrial
  industrial: 'industrial',
  warehouse: 'industrial',
  factory: 'industrial',
};

/** OSM `building` value (or null/undefined) to one of 5 groups; unknown values are "other". */
export function buildingGroup(buildingType: string | null | undefined): BuildingGroup {
  if (buildingType == null) return 'other';
  return Object.hasOwn(BUILDING_GROUPS, buildingType) ? BUILDING_GROUPS[buildingType] : 'other';
}

const BUILDING_GROUP_COLOUR: Record<BuildingGroup, PaletteName> = {
  residential: 'buildingResidential',
  commercial: 'buildingCommercial',
  civic: 'buildingCivic',
  industrial: 'buildingIndustrial',
  other: 'buildingOther',
};

/** Palette name of a building: the landmark accent wins over the type group. */
export function buildingColour(
  buildingType: string | null | undefined,
  landmarkId: string | null | undefined,
): PaletteName {
  if (landmarkId != null) return 'landmark';
  return BUILDING_GROUP_COLOUR[buildingGroup(buildingType)];
}

/** Detail kinds that are glass roofs (flagged `stylised` in the data); every other kind is masonry. */
const GLASS_DETAILS: ReadonlySet<string> = new Set(['roof_vault', 'shed_vault']);

/** Palette name of a `landmark_details` row, from its `detail` kind. */
export function landmarkDetailColour(detail: string | null | undefined): PaletteName {
  return detail != null && GLASS_DETAILS.has(detail) ? 'landmarkGlass' : 'landmarkDetail';
}

export type RoadGroup = 'major' | 'minor' | 'pedestrian';

const ROAD_GROUPS: Record<string, RoadGroup> = {
  motorway: 'major',
  motorway_link: 'major',
  trunk: 'major',
  trunk_link: 'major',
  primary: 'major',
  primary_link: 'major',
  secondary: 'major',
  secondary_link: 'major',
  tertiary: 'major',
  tertiary_link: 'major',
  footway: 'pedestrian',
  pedestrian: 'pedestrian',
  steps: 'pedestrian',
  path: 'pedestrian',
  cycleway: 'pedestrian',
  platform: 'pedestrian',
  track: 'pedestrian',
};

/** OSM highway class to a road group; anything not listed (residential, service, ...) is minor. */
export function roadGroup(cls: string | null | undefined): RoadGroup {
  if (cls == null) return 'minor';
  return Object.hasOwn(ROAD_GROUPS, cls) ? ROAD_GROUPS[cls] : 'minor';
}

const ROAD_GROUP_COLOUR: Record<RoadGroup, PaletteName> = {
  major: 'roadMajor',
  minor: 'roadMinor',
  pedestrian: 'roadPedestrian',
};

export function roadColour(cls: string | null | undefined): PaletteName {
  return ROAD_GROUP_COLOUR[roadGroup(cls)];
}

// Kind mappings for the flat layers (T-4.3). The kinds are data (the `kind` column of the feature
// tables, see pipeline classify.py); the grouping and the colours are style. Unknown kinds return
// null and the caller falls back to the layer colour.

export type LanduseGroup = 'residential' | 'commercial' | 'industrial' | 'civic';
const LANDUSE_GROUPS: Record<string, LanduseGroup> = {
  residential: 'residential',
  commercial: 'commercial',
  retail: 'commercial',
  industrial: 'industrial',
  railway: 'industrial',
  religious: 'civic',
  education: 'civic',
  institutional: 'civic',
  civic_admin: 'civic',
  military: 'civic',
};
const LANDUSE_COLOUR: Record<LanduseGroup, PaletteName> = {
  residential: 'landuseResidential',
  commercial: 'landuseCommercial',
  industrial: 'landuseIndustrial',
  civic: 'landuseCivic',
};

export type GreenGroup = 'park' | 'grass' | 'wood' | 'pitch';
const GREEN_GROUPS: Record<string, GreenGroup> = {
  park: 'park',
  garden: 'park',
  flowerbed: 'park',
  village_green: 'park',
  common: 'park',
  dog_park: 'park',
  cemetery: 'park',
  grave_yard: 'park',
  grass: 'grass',
  meadow: 'grass',
  grassland: 'grass',
  heath: 'grass',
  allotments: 'grass',
  plant_nursery: 'grass',
  recreation_ground: 'grass',
  forest: 'wood',
  wood: 'wood',
  scrub: 'wood',
  orchard: 'wood',
  vineyard: 'wood',
  nature_reserve: 'wood',
  pitch: 'pitch',
  playground: 'pitch',
  golf_course: 'pitch',
};
const GREEN_COLOUR: Record<GreenGroup, PaletteName> = {
  park: 'green',
  grass: 'greenGrass',
  wood: 'greenWood',
  pitch: 'greenPitch',
};

const POOL_KINDS: ReadonlySet<string> = new Set([
  'reflecting_pool',
  'fountain',
  'basin',
  'pond',
  'swimming_pool',
]);

function lookupKind<T>(table: Record<string, T>, kind: string | null | undefined): T | null {
  if (kind == null) return null;
  return Object.hasOwn(table, kind) ? table[kind] : null;
}

export function landuseGroup(kind: string | null | undefined): LanduseGroup | null {
  return lookupKind(LANDUSE_GROUPS, kind);
}
export function greenGroup(kind: string | null | undefined): GreenGroup | null {
  return lookupKind(GREEN_GROUPS, kind);
}

/** Palette name of a land-use feature; unknown or missing kinds keep the layer colour. */
export function landuseColour(kind: string | null | undefined): PaletteName {
  const g = landuseGroup(kind);
  return g ? LANDUSE_COLOUR[g] : 'landuse';
}
export function greenColour(kind: string | null | undefined): PaletteName {
  const g = greenGroup(kind);
  return g ? GREEN_COLOUR[g] : 'green';
}
export function waterColour(kind: string | null | undefined): PaletteName {
  return kind != null && POOL_KINDS.has(kind) ? 'waterPool' : 'water';
}
