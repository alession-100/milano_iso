import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PALETTE_COLOURS,
  PALETTE,
  PALETTE_ORDER,
  buildingColour,
  buildingGroup,
  roadGroup,
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
  it('has at most 16 colours, and the order lists every one exactly once', () => {
    expect(Object.keys(PALETTE).length).toBeLessThanOrEqual(MAX_PALETTE_COLOURS);
    expect([...PALETTE_ORDER].sort()).toEqual(Object.keys(PALETTE).sort());
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

  it('groups road classes', () => {
    expect(roadGroup('tertiary')).toBe('major');
    expect(roadGroup('residential')).toBe('minor');
    expect(roadGroup('footway')).toBe('pedestrian');
    expect(roadGroup('unknown_class')).toBe('minor');
  });
});
