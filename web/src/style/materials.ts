import * as THREE from 'three';
import {
  PALETTE_ORDER,
  type PaletteName,
  type StyleMode,
  buildingColour,
  greenColour,
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
const LOOKUP_LAYERS: ReadonlySet<string> = new Set(['buildings', 'roads', 'landuse', 'green', 'water']);
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
};

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
}

const PROGRAM_KEY = 'milano-iso-feature-colour-v1';
const WATER_PROGRAM_KEY = 'milano-iso-feature-colour-water-v1';

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
 */
export function createLookupMaterial(layer: string, lookup: THREE.DataTexture): THREE.MeshLambertMaterial {
  const water = layer === 'water';
  const m = new THREE.MeshLambertMaterial({ flatShading: true });
  m.name = layer;
  m.userData.lookup = lookup;
  const featureIndex = { value: lookup };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.featureIndex = featureIndex;
    shader.uniforms.paletteColours = paletteUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float _feature_id;
flat varying float vFeatureId;${water ? 'varying vec2 vWaterPos;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFeatureId = _feature_id;${water ? 'vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xz;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D featureIndex;
uniform vec3 paletteColours[${PALETTE_ORDER.length}];
flat varying float vFeatureId;${water ? 'varying vec2 vWaterPos;' : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  int fid = int(vFeatureId + 0.5);
  int pal = int(texelFetch(featureIndex, ivec2(fid % ${LOOKUP_WIDTH}, fid / ${LOOKUP_WIDTH}), 0).r * 255.0 + 0.5);
  diffuseColor.rgb *= paletteColours[pal];
${water ? WATER_SHEEN : ''}
}`,
      );
  };
  m.customProgramCacheKey = () => (water ? WATER_PROGRAM_KEY : PROGRAM_KEY);
  return m;
}

export function disposeLookupMaterial(m: THREE.Material): void {
  const tex = m.userData.lookup as THREE.Texture | undefined;
  tex?.dispose();
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
  mesh.castShadow = CASTING_LAYERS.has(layer);
  mesh.receiveShadow = true;
}
