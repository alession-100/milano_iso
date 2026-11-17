import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PALETTE_COLOURS,
  NIGHT_PALETTE,
  PALETTE,
  PALETTE_ORDER,
  buildingColour,
  buildingGroup,
  greenColour,
  greenGroup,
  landmarkDetailColour,
  landuseColour,
  landuseGroup,
  paletteFor,
  roadGroup,
  waterColour,
} from './palette';

const FIXTURES = path.resolve(process.cwd(), 'e2e', 'fixtures', 'tiles');

function fixtureRows(layer: string): Record<string, unknown>[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json') && f !== 'tiles.json')
    .flatMap((f) => {
      const t = JSON.parse(readFileSync(path.join(FIXTURES, f), 'utf-8')) as {
        layers: Record<string, Record<string, unknown>[]>;
      };
      return t.layers[layer] ?? [];
    });
}

describe('palette', () => {
  it('has at most 32 colours (ADR-0029), and the order lists every one exactly once', () => {
    expect(MAX_PALETTE_COLOURS).toBe(32);
    expect(Object.keys(PALETTE).length).toBeLessThanOrEqual(MAX_PALETTE_COLOURS);
    expect([...PALETTE_ORDER].sort()).toEqual(Object.keys(PALETTE).sort());
  });

  it('keeps the palette v1 entries first, in their original order and colour', () => {
    expect(PALETTE_ORDER.slice(0, 15)).toEqual([
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
    ]);
    expect(PALETTE.ground).toBe(0xe3ded4);
    expect(PALETTE.water).toBe(0x8cb9cf);
    expect(PALETTE.green).toBe(0xa9c58f);
    expect(PALETTE.landuse).toBe(0xd5d0c1);
    expect(PALETTE.landmark).toBe(0xd2745c);
  });

  it('has a night colour for every entry, different from the day colour', () => {
    expect(Object.keys(NIGHT_PALETTE).sort()).toEqual(Object.keys(PALETTE).sort());
    for (const n of PALETTE_ORDER) {
      expect(Number.isInteger(NIGHT_PALETTE[n])).toBe(true);
      expect(NIGHT_PALETTE[n]).not.toBe(PALETTE[n]);
    }
    expect(paletteFor('night')).toBe(NIGHT_PALETTE);
    expect(paletteFor('day')).toBe(PALETTE);
  });
});

describe('flat layer kind mapping', () => {
  it('groups land-use kinds; unknown, null and prototype names fall back to landuse', () => {
    expect(landuseColour('residential')).toBe('landuseResidential');
    expect(landuseColour('retail')).toBe('landuseCommercial');
    expect(landuseColour('railway')).toBe('landuseIndustrial');
    expect(landuseColour('religious')).toBe('landuseCivic');
    expect(landuseColour('construction')).toBe('landuse');
    expect(landuseColour('something_new')).toBe('landuse');
    expect(landuseColour('toString')).toBe('landuse');
    expect(landuseColour(null)).toBe('landuse');
    expect(landuseGroup('nope')).toBeNull();
  });

  it('groups green kinds; the fallback is the v1 green', () => {
    expect(greenColour('park')).toBe('green');
    expect(greenColour('garden')).toBe('green');
    expect(greenColour('grass')).toBe('greenGrass');
    expect(greenColour('forest')).toBe('greenWood');
    expect(greenColour('playground')).toBe('greenPitch');
    expect(greenColour('something_new')).toBe('green');
    expect(greenColour('hasOwnProperty')).toBe('green');
    expect(greenColour(undefined)).toBe('green');
    expect(greenGroup('nope')).toBeNull();
  });

  it('gives small basins their own water colour, everything else the v1 water', () => {
    expect(waterColour('reflecting_pool')).toBe('waterPool');
    expect(waterColour('water')).toBe('water');
    expect(waterColour('river')).toBe('water');
    expect(waterColour(null)).toBe('water');
  });
});

describe('building type mapping', () => {
  const GROUPS = ['residential', 'commercial', 'civic', 'industrial', 'other'];

  it('maps every building_type in the fixture tables to one of the 5 groups', () => {
    const rows = fixtureRows('buildings');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(GROUPS).toContain(buildingGroup(r.building_type as string | null));
    }
  });

  it('maps known values, and unknown, null and prototype names to other', () => {
    expect(buildingGroup('apartments')).toBe('residential');
    expect(buildingGroup('office')).toBe('commercial');
    expect(buildingGroup('cathedral')).toBe('civic');
    expect(buildingGroup('warehouse')).toBe('industrial');
    expect(buildingGroup('yes')).toBe('other');
    expect(buildingGroup('something_new')).toBe('other');
    expect(buildingGroup('toString')).toBe('other');
    expect(buildingGroup(null)).toBe('other');
  });

  it('gives landmarks the accent, whatever their type', () => {
    expect(buildingColour('cathedral', 'lm:duomo')).toBe('landmark');
    expect(buildingColour('cathedral', null)).toBe('buildingCivic');
  });

  it('colours landmark details: glass vaults get the glass tint, the rest the accent tint', () => {
    expect(landmarkDetailColour('spire')).toBe('landmarkDetail');
    expect(landmarkDetailColour('roof_vault')).toBe('landmarkGlass');
    expect(landmarkDetailColour(null)).toBe('landmarkDetail');
    expect(PALETTE_ORDER.slice(-2)).toEqual(['landmarkDetail', 'landmarkGlass']);
  });

  it('groups road classes', () => {
    expect(roadGroup('tertiary')).toBe('major');
    expect(roadGroup('residential')).toBe('minor');
    expect(roadGroup('footway')).toBe('pedestrian');
    expect(roadGroup('unknown_class')).toBe('minor');
  });
});
