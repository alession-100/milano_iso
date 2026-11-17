import { describe, expect, it } from 'vitest';
import { CameraRig, azimuthOfStep } from './camera';
import { type SanNode, clientToLocal, nightCss, parseViewBox, polygonPoints, sanitiseTree, viewFootprint } from './minimap';

interface FakeNode extends SanNode {
  attrs: { name: string; value: string }[];
  kids: FakeNode[];
  removed: boolean;
}

function fake(localName: string, attrs: Record<string, string> = {}, kids: FakeNode[] = []): FakeNode {
  const n: FakeNode = {
    localName,
    attrs: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    kids,
    removed: false,
    get attributes() {
      return n.attrs;
    },
    get children() {
      return n.kids.filter((k) => !k.removed);
    },
    removeAttribute(name: string) {
      n.attrs = n.attrs.filter((a) => a.name !== name);
    },
    remove() {
      n.removed = true;
    },
  };
  return n;
}

describe('sanitiseTree', () => {
  it('removes scripts, on* attributes and javascript: links, keeps the drawing', () => {
    const path = fake('path', { d: 'M0 0', class: 'mm-green', onclick: 'x()', onLoad: 'y()' });
    const script = fake('script');
    const link = fake('a', { href: ' JavaScript:alert(1)', 'xlink:href': 'javascript:1' });
    const okLink = fake('a', { href: '#top' });
    const fo = fake('foreignObject');
    const nested = fake('g', { onmouseover: 'z()' }, [fake('script'), path]);
    const root = fake('svg', { viewBox: '0 0 1 1', onload: 'w()' }, [script, link, okLink, fo, nested]);
    sanitiseTree(root);
    expect(root.attrs.map((a) => a.name)).toEqual(['viewBox']);
    expect(Array.from(root.children).map((c) => c.localName)).toEqual(['a', 'a', 'g']);
    expect(link.attrs).toEqual([]);
    expect(okLink.attrs).toEqual([{ name: 'href', value: '#top' }]);
    expect(nested.attrs).toEqual([]);
    expect(nested.children).toEqual([path]);
    expect(path.attrs.map((a) => a.name)).toEqual(['d', 'class']);
  });
});

describe('viewBox and click mapping', () => {
  const vb = { x: -241, y: -240, w: 482, h: 482 };
  it('parses a viewBox', () => {
    expect(parseViewBox('-241 -240 482 482')).toEqual(vb);
    expect(parseViewBox('1 2 0 4')).toBeNull();
    expect(parseViewBox(null)).toBeNull();
  });
  it('maps the corners and the centre of a square box', () => {
    const rect = { left: 10, top: 20, width: 160, height: 160 };
    expect(clientToLocal(vb, rect, 10, 20)).toEqual([-241, -240]);
    const c = clientToLocal(vb, rect, 90, 100);
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[1]).toBeCloseTo(1, 6);
  });
  it('accounts for letterboxing when the element is not square', () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 }; // scale 100/482, centred horizontally
    const mid = clientToLocal(vb, rect, 100, 50);
    expect(mid[0]).toBeCloseTo(0, 6);
    expect(mid[1]).toBeCloseTo(1, 6);
  });
});

describe('viewFootprint', () => {
  const vw = 1280;
  const vh = 720;
  for (const step of [0, 1, 2, 3]) {
    it(`step ${step} (azimuth ${azimuthOfStep(step)}): corners map back to the screen corners`, () => {
      const rig = new CameraRig(null, 30, step);
      rig.target = [12, -34];
      rig.visibleWidth = 400;
      const poly = viewFootprint(rig, vw, vh);
      const back = poly.map(([x, z]) => rig.groundToScreen(x, z, vw, vh));
      const want = [
        [0, 0],
        [vw, 0],
        [vw, vh],
        [0, vh],
      ];
      back.forEach(([px, py], i) => {
        expect(px).toBeCloseTo(want[i][0], 6);
        expect(py).toBeCloseTo(want[i][1], 6);
      });
      // The centroid of the footprint is the target.
      const cx = poly.reduce((a, p) => a + p[0], 0) / 4;
      const cz = poly.reduce((a, p) => a + p[1], 0) / 4;
      expect(cx).toBeCloseTo(12, 6);
      expect(cz).toBeCloseTo(-34, 6);
    });
  }
  it('rotates with the azimuth: the footprint of step 2 is the point reflection of step 0, corner for corner', () => {
    const a = new CameraRig(null, 30, 0);
    const b = new CameraRig(null, 30, 2);
    const pa = viewFootprint(a, vw, vh);
    const pb = viewFootprint(b, vw, vh);
    pa.forEach(([x, z], i) => {
      expect(pb[i][0]).toBeCloseTo(-x, 6);
      expect(pb[i][1]).toBeCloseTo(-z, 6);
    });
  });
});

describe('helpers', () => {
  it('formats polygon points to 0.1 m', () => {
    expect(polygonPoints([[1.234, -5.678], [0, 0]])).toBe('1.2,-5.7 0,0');
  });
  it('generates night CSS from the night palette for every minimap class', () => {
    const css = nightCss();
    for (const c of ['mm-ground', 'mm-green', 'mm-water', 'mm-building', 'mm-road-minor', 'mm-road-major']) {
      expect(css).toContain(c);
    }
    expect(css).toContain('#2e3650'); // night ground
  });
});
