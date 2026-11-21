import * as THREE from 'three';
import {
  PALETTE_ORDER,
  type PaletteName,
  type StyleMode,
  buildingColour,
  greenColour,
  landmarkDetailColour,
  landuseColour,
  paletteFor,
  paletteIndex,
  roadColour,
  waterColour,
} from './palette';

/** Per-tile feature table `<tile>.json` (only the fields the style reads). */
export interface FeatureTable {
  tile?: string;
  layers: Record<string, Record<string, unknown>[] | undefined>;
}

/** Width of the colour-index lookup texture; feature `i` is texel (i % W, floor(i / W)). */
export const LOOKUP_WIDTH = 256;

/** Layers whose colour depends on the feature (via the lookup texture). */
const LOOKUP_LAYERS: ReadonlySet<string> = new Set([
  'buildings',
  'roads',
  'landuse',
  'green',
  'water',
  'landmark_details',
]);
/** Layers that cast shadows (STYLE choice: only buildings). */
const CASTING_LAYERS: ReadonlySet<string> = new Set(['buildings']);

const FLAT_COLOURS: Record<string, PaletteName> = {
  buildings: 'buildingOther',
  roads: 'roadMinor',
  landuse: 'landuse',
  green: 'green',
  water: 'water',
  road_areas: 'roadAreas',
  rail: 'rail',
  markings: 'markingWhite',
  landmark_details: 'landmarkDetail',
};

/** Palette index of a flat layer's single colour (the lookup of a merged coarse mesh, T-6.5). */
export function flatPaletteIndex(layer: string): number {
  return paletteIndex(FLAT_COLOURS[layer] ?? 'ground');
}

/** Mesh names are layer names, with a `#n` suffix when a layer is split in chunks. */
export function layerOf(meshName: string): string {
  const k = meshName.indexOf('#');
  return k < 0 ? meshName : meshName.slice(0, k);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function rowColour(layer: string, row: Record<string, unknown>): PaletteName {
  switch (layer) {
    case 'buildings':
      return buildingColour(str(row.building_type), str(row.landmark_id));
    case 'landuse':
      return landuseColour(str(row.kind));
    case 'green':
      return greenColour(str(row.kind));
    case 'water':
      return waterColour(str(row.kind));
    case 'landmark_details':
      return landmarkDetailColour(str(row.detail));
    default:
      return roadColour(str(row.class));
  }
}

/** Palette index of every feature of one layer, in feature-id order. */
export function colourIndices(layer: string, rows: readonly Record<string, unknown>[]): Uint8Array {
  const out = new Uint8Array(rows.length);
  rows.forEach((row, i) => {
    out[i] = paletteIndex(rowColour(layer, row));
  });
  return out;
}

/** Packs palette indices into a W-wide, zero-padded byte array (one byte per feature). */
export function packLookup(
  indices: Uint8Array,
  width: number = LOOKUP_WIDTH,
): { data: Uint8Array; width: number; height: number } {
  const height = Math.max(1, Math.ceil(indices.length / width));
  const data = new Uint8Array(width * height);
  data.set(indices);
  return { data, width, height };
}

export function buildLookupTexture(indices: Uint8Array): THREE.DataTexture {
  const { data, width, height } = packLookup(indices);
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

import { setTreeMode } from './trees';

const flatCache = new Map<string, THREE.MeshLambertMaterial>();
let currentMode: StyleMode = 'day';

/** One shared flat-shaded material per flat layer. */
export function materialFor(layer: string): THREE.MeshLambertMaterial {
  let m = flatCache.get(layer);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: paletteFor(currentMode)[FLAT_COLOURS[layer] ?? 'ground'],
      flatShading: true,
    });
    m.name = layer;
    if (layer === 'markings') {
      // Painted on the road: win the depth test against the road ribbons below (T-4.1).
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    flatCache.set(layer, m);
  }
  return m;
}

// The palette is uploaded once, as a vec3 array shared by every lookup material (Color values are
// converted from sRGB to the linear working space by three).
const paletteUniform: { value: THREE.Color[] } = {
  value: PALETTE_ORDER.map((n) => new THREE.Color(paletteFor('day')[n])),
};

/**
 * Switches the colours of every material to the day or night palette (T-4.3). The palette uniform
 * array is shared, so updating it in place restyles every lookup material; the shared flat
 * materials are updated too. The caller requests one render.
 */
export function setPaletteMode(mode: StyleMode): void {
  currentMode = mode;
  const p = paletteFor(mode);
  PALETTE_ORDER.forEach((n, i) => paletteUniform.value[i].set(p[n]));
  for (const [layer, mat] of flatCache) mat.color.set(p[FLAT_COLOURS[layer] ?? 'ground']);
  setTreeMode(mode);
}

/**
 * Highlight tint (STYLE, not data and not a palette entry): the building/road/area colour is mixed
 * towards this warm accent, a little for hover and more for the selection (T-5.1).
 */
const HIGHLIGHT_TINT = { value: new THREE.Color(0xffc23d) };
const HOVER_MIX = '0.42';
const SELECTED_MIX = '0.62';

/** Highlight levels written to the per-material mask. */
export const MASK_HOVER = 1;
export const MASK_SELECTED = 2;

/** True when the material carries a highlight mask (lookup materials only). */
export function hasMask(m: THREE.Material): boolean {
  return m.userData.maskData instanceof Uint8Array;
}

/** Sets the mask of feature ids `ids` to `level` (0 clears them). Uploads on the next render. */
export function setMask(m: THREE.Material, ids: Iterable<number>, level: number): void {
  const data = m.userData.maskData as Uint8Array | undefined;
  if (!data) return;
  for (const id of ids) {
    if (id >= 0 && id < data.length) data[id] = level;
  }
  m.userData.maskDirty = true;
  (m.userData.mask as THREE.Texture).needsUpdate = true;
}

/** Clears the whole mask if anything was marked; returns whether it was dirty. */
export function clearMask(m: THREE.Material): boolean {
  const data = m.userData.maskData as Uint8Array | undefined;
  if (!data || !m.userData.maskDirty) return false;
  data.fill(0);
  m.userData.maskDirty = false;
  (m.userData.mask as THREE.Texture).needsUpdate = true;
  return true;
}

const PROGRAM_KEY = 'milano-iso-feature-colour-v1';
const WATER_PROGRAM_KEY = 'milano-iso-feature-colour-water-v1';
const MERGED_PROGRAM_KEY = 'milano-iso-feature-colour-merged-v1';

/**
 * Water sheen (STYLE, not data): a static, very soft diagonal banding in world space, as if light
 * ran over the surface. No animation (rendering stays on demand). Same material approach as the
 * other layers: one extra program, no extra draw calls.
 */
const WATER_SHEEN = `{
  float band = 0.5 + 0.5 * sin((vWaterPos.x - vWaterPos.y) * 0.22);
  diffuseColor.rgb *= 0.95 + 0.1 * smoothstep(0.35, 0.65, band);
}`;

/**
 * A flat-shaded Lambert material whose diffuse colour is `palette[lookup[_feature_id]]`.
 * One instance per (tile, mesh), all with the same program (same `customProgramCacheKey`), so the
 * draw-call count is the same as with a shared material. The texture is owned by the material and
 * freed by `disposeLookupMaterial`.
 *
 * `waterRange` (T-6.5) is for the merged coarse mesh: the feature ids [lo, hi) of its water layer get
 * the same sheen as the separate water layer, by the id, so one material and one draw call serve all of
 * its layers. It has its own program.
 */
export function createLookupMaterial(
  layer: string,
  lookup: THREE.DataTexture,
  waterRange?: readonly [number, number],
): THREE.MeshLambertMaterial {
  const water = layer === 'water';
  const merged = waterRange !== undefined;
  const wp = water || merged; // the world position varying is needed
  const m = new THREE.MeshLambertMaterial({ flatShading: true });
  m.name = layer;
  m.userData.lookup = lookup;
  const featureIndex = { value: lookup };
  // Highlight mask (T-5.1): one byte per feature, 0 none, 1 hover, 2 selected. Same size as the
  // lookup texture, so the same texel address is used. A tint of the existing colour, no palette entry.
  const maskData = new Uint8Array(lookup.image.width * lookup.image.height);
  const mask = new THREE.DataTexture(maskData, lookup.image.width, lookup.image.height, THREE.RedFormat, THREE.UnsignedByteType);
  mask.minFilter = THREE.NearestFilter;
  mask.magFilter = THREE.NearestFilter;
  mask.generateMipmaps = false;
  mask.needsUpdate = true;
  m.userData.mask = mask;
  m.userData.maskData = maskData;
  m.userData.maskDirty = false;
  const featureMask = { value: mask };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.featureIndex = featureIndex;
    shader.uniforms.featureMask = featureMask;
    shader.uniforms.highlightTint = HIGHLIGHT_TINT;
    shader.uniforms.paletteColours = paletteUniform;
    if (waterRange) shader.uniforms.waterRange = { value: new THREE.Vector2(waterRange[0], waterRange[1]) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float _feature_id;
flat varying float vFeatureId;${wp ? 'varying vec2 vWaterPos;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFeatureId = _feature_id;${wp ? 'vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xz;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D featureIndex;
uniform sampler2D featureMask;
uniform vec3 highlightTint;
uniform vec3 paletteColours[${PALETTE_ORDER.length}];${merged ? 'uniform vec2 waterRange;' : ''}
flat varying float vFeatureId;${wp ? 'varying vec2 vWaterPos;' : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  int fid = int(vFeatureId + 0.5);
  int pal = int(texelFetch(featureIndex, ivec2(fid % ${LOOKUP_WIDTH}, fid / ${LOOKUP_WIDTH}), 0).r * 255.0 + 0.5);
  diffuseColor.rgb *= paletteColours[pal];
  int hl = int(texelFetch(featureMask, ivec2(fid % ${LOOKUP_WIDTH}, fid / ${LOOKUP_WIDTH}), 0).r * 255.0 + 0.5);
  if (hl == 1) diffuseColor.rgb = mix(diffuseColor.rgb, highlightTint, ${HOVER_MIX});
  else if (hl == 2) diffuseColor.rgb = mix(diffuseColor.rgb, highlightTint, ${SELECTED_MIX});
${water ? WATER_SHEEN : merged ? `if (vFeatureId > waterRange.x - 0.5 && vFeatureId < waterRange.y - 0.5) ${WATER_SHEEN}` : ''}
}`,
      );
  };
  m.customProgramCacheKey = () => (merged ? MERGED_PROGRAM_KEY : water ? WATER_PROGRAM_KEY : PROGRAM_KEY);
  return m;
}

export function disposeLookupMaterial(m: THREE.Material): void {
  const tex = m.userData.lookup as THREE.Texture | undefined;
  tex?.dispose();
  (m.userData.mask as THREE.Texture | undefined)?.dispose();
  m.dispose();
}

/**
 * Styles one loaded mesh: a shared flat material for flat layers, a lookup material for
 * buildings and roads, and the shadow flags. `table` is the tile's feature table.
 */
export function applyStyle(mesh: THREE.Mesh, table: FeatureTable | undefined): void {
  const layer = layerOf(mesh.name);
  const rows = table?.layers[layer];
  if (LOOKUP_LAYERS.has(layer) && rows) {
    mesh.material = createLookupMaterial(layer, buildLookupTexture(colourIndices(layer, rows)));
  } else {
    mesh.material = materialFor(layer);
  }
  mesh.userData.casts = CASTING_LAYERS.has(layer);
  mesh.castShadow = mesh.userData.casts as boolean;
  mesh.receiveShadow = true;
}

/**
 * Switches the shadow casting of every mesh below `root` that casts by its layer (T-6.4, ADR-0039):
 * with `on` false nothing is drawn into the shadow map. The receiving side and the lights are not
 * touched, so no shader changes and nothing recompiles.
 */
export function setShadowCasters(root: THREE.Object3D, on: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.casts !== undefined) mesh.castShadow = on && (mesh.userData.casts as boolean);
  });
}
