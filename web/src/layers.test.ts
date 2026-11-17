import { afterEach, describe, expect, it } from 'vitest';
import {
  TOGGLE_IDS,
  allVisible,
  applyLayerVisibility,
  layerVisible,
  layerVisibleIn,
  parseLayerList,
  parseLayersParam,
  serialiseLayers,
  setLayerState,
} from './layers';

afterEach(() => setLayerState(allVisible()));

describe('layer list parsing', () => {
  it('has no opinion when absent or empty', () => {
    expect(parseLayersParam('')).toBeNull();
    expect(parseLayersParam('?layers=')).toBeNull();
  });
  it('turns on exactly the listed toggles; unknown ids are ignored', () => {
    const s = parseLayerList('buildings, roads,bogus');
    expect(s?.buildings).toBe(true);
    expect(s?.roads).toBe(true);
    expect(s?.trees).toBe(false);
  });
  it('`none` hides everything and round-trips', () => {
    const s = parseLayerList('none');
    expect(TOGGLE_IDS.every((id) => s?.[id] === false)).toBe(true);
    expect(serialiseLayers(s ?? allVisible())).toBe('none');
    const some = parseLayerList('trees,markings');
    expect(parseLayerList(serialiseLayers(some ?? allVisible()))).toEqual(some);
  });
});

describe('layerVisible', () => {
  it('answers for tile layers and toggle ids', () => {
    setLayerState({ ...allVisible(), roads: false, waterGreen: false });
    for (const l of ['roads', 'road_areas', 'rail', 'roads#2']) {
      expect(layerVisible(l.split('#')[0])).toBe(false);
    }
    for (const l of ['water', 'green', 'landuse', 'waterGreen']) expect(layerVisible(l)).toBe(false);
    for (const l of ['buildings', 'trees', 'markings', 'landmark_details', 'landmark', 'unknown']) {
      expect(layerVisible(l)).toBe(true);
    }
  });
  it('pure variant matches', () => {
    expect(layerVisibleIn({ ...allVisible(), buildings: false }, 'buildings')).toBe(false);
  });
});

describe('applyLayerVisibility', () => {
  it('sets mesh visibility by layer name, including split chunks', () => {
    type N = { name: string; visible: boolean; isMesh?: boolean; kids: N[]; traverse: (fn: (o: N) => void) => void };
    const node = (name: string, isMesh = true, kids: N[] = []): N => {
      const n: N = {
        name,
        visible: true,
        isMesh,
        kids,
        traverse: (fn) => {
          fn(n);
          kids.forEach((k) => k.traverse(fn));
        },
      };
      return n;
    };
    const b = node('buildings#1');
    const r = node('road_areas');
    const t = node('trees');
    const group = node('0_0', false, [b, r, t]);
    setLayerState({ ...allVisible(), buildings: false, roads: false });
    applyLayerVisibility(group);
    expect([b.visible, r.visible, t.visible, group.visible]).toEqual([false, false, true, true]);
    setLayerState(allVisible());
    applyLayerVisibility(group);
    expect(b.visible && r.visible && t.visible).toBe(true);
  });
});
