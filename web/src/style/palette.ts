/**
 * STYLE, not data (CLAUDE.md hard rule 1): every colour below is an artistic choice of the
 * Milano Iso look. None of them is measured or derived from a source; what is data is only the
 * *category* a feature falls into (its `building_type`, road `class`, `landmark_id`).
 *
 * The surface palette is defined once, has at most 32 entries (checked by palette.test.ts) and is
 * uploaded as one uniform array. A byte in the per-tile lookup texture is an index into it, so the
 * order of PALETTE_ORDER is part of the contract. Roofs and walls of one building share one
 * colour: they differ only through lighting.
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
  // Appended in T-4.1 (palette v1 above is unchanged).
  /** Tree crown (low-poly cone), a little darker than the green areas it stands on. */
  treeCrown: 0x7ea468,
  /** Tree trunk. */
  treeTrunk: 0x8b6f55,
  /** Road markings (dashed centre lines, zebra stripes). */
  markingWhite: 0xf1eee6,
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
  'treeCrown',
  'treeTrunk',
  'markingWhite',
];

/** ADR-0029: raised from 16 to 32 (uniform array size is not a constraint at this size). */
export const MAX_PALETTE_COLOURS = 32;

export function paletteIndex(name: PaletteName): number {
  return PALETTE_ORDER.indexOf(name);
}

/** Light colours (style, not part of the surface palette). */
export const LIGHT_COLOURS = {
  sun: 0xfff4e0,
  skyFill: 0xffffff,
  groundFill: 0xa89f94,
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
