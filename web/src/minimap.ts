import { type CameraRig } from './camera';
import { paletteFor } from './style/palette';

/** Minimal element shape the sanitiser needs (a DOM Element satisfies it; tests use a fake). */
export interface SanNode {
  localName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  removeAttribute: (name: string) => void;
  children: ArrayLike<SanNode>;
  remove: () => void;
}

const FORBIDDEN_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);

/**
 * Removes `<script>` (and other active) elements, every `on*` attribute and `javascript:` links,
 * in place. The minimap is our own static file (ADR-0031); this is defence in depth.
 */
export function sanitiseTree(node: SanNode): void {
  for (const child of Array.from(node.children)) {
    if (FORBIDDEN_ELEMENTS.has(child.localName.toLowerCase())) {
      child.remove();
      continue;
    }
    sanitiseTree(child);
  }
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    const unsafeLink = (name === 'href' || name.endsWith(':href')) && /^\s*javascript:/i.test(attr.value);
    if (name.startsWith('on') || unsafeLink) node.removeAttribute(attr.name);
  }
}

/** Parses and sanitises the minimap file; null when it is not a valid SVG document. */
export function parseMinimapSvg(text: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null;
  sanitiseTree(root as unknown as SanNode);
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function parseViewBox(attr: string | null): ViewBox | null {
  if (attr === null) return null;
  const v = attr.trim().split(/[\s,]+/).map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || !(v[2] > 0) || !(v[3] > 0)) return null;
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

/**
 * Local metres (x, z) under a client point on the inline SVG, which is drawn with the default
 * `preserveAspectRatio` (uniform scale, centred). The SVG user space is the local frame itself
 * (x = E - E0, z = -(N - N0), north up), so no further mapping is needed.
 */
export function clientToLocal(
  vb: ViewBox,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): [number, number] {
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
  const offX = (rect.width - vb.w * scale) / 2;
  const offY = (rect.height - vb.h * scale) / 2;
  return [vb.x + (clientX - rect.left - offX) / scale, vb.y + (clientY - rect.top - offY) / scale];
}

/** Ground footprint of the viewport (corner order: top-left, top-right, bottom-right, bottom-left). */
export function viewFootprint(rig: CameraRig, vw: number, vh: number): [number, number][] {
  return [
    rig.screenToGround(0, 0, vw, vh),
    rig.screenToGround(vw, 0, vw, vh),
    rig.screenToGround(vw, vh, vw, vh),
    rig.screenToGround(0, vh, vw, vh),
  ];
}

export function polygonPoints(poly: readonly (readonly [number, number])[]): string {
  return poly.map(([x, z]) => `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10}`).join(' ');
}

/** CSS mapping the minimap classes (mm-*, ADR-0031) to the night palette; day uses the file's own. */
export function nightCss(): string {
  const p = paletteFor('night');
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  return [
    `#minimap[data-mode="night"] .mm-ground{fill:${hex(p.ground)}}`,
    `#minimap[data-mode="night"] .mm-green{fill:${hex(p.green)}}`,
    `#minimap[data-mode="night"] .mm-water{fill:${hex(p.water)}}`,
    `#minimap[data-mode="night"] .mm-building{fill:${hex(p.buildingOther)}}`,
    `#minimap[data-mode="night"] .mm-road-minor{stroke:${hex(p.roadMinor)}}`,
    `#minimap[data-mode="night"] .mm-road-major{stroke:${hex(p.roadMajor)}}`,
  ].join('\n');
}

