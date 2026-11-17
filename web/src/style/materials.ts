import * as THREE from 'three';
import {
  PALETTE,
  PALETTE_ORDER,
  type PaletteName,
  buildingColour,
  paletteIndex,
  roadColour,
} from './palette';

/** Per-tile feature table `<tile>.json` (only the fields the style reads). */
export interface FeatureTable {
  tile?: string;
  layers: Record<string, Record<string, unknown>[] | undefined>;
}

/** Width of the colour-index lookup texture; feature `i` is texel (i % W, floor(i / W)). */
export const LOOKUP_WIDTH = 256;

/** Layers whose colour depends on the feature (via the lookup texture). */
const LOOKUP_LAYERS: ReadonlySet<string> = new Set(['buildings', 'roads']);
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

/** Palette index of every feature of one layer, in feature-id order. */
export function colourIndices(layer: string, rows: readonly Record<string, unknown>[]): Uint8Array {
  const out = new Uint8Array(rows.length);
  rows.forEach((row, i) => {
    const name =
      layer === 'buildings'
        ? buildingColour(str(row.building_type), str(row.landmark_id))
        : roadColour(str(row.class));
    out[i] = paletteIndex(name);
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

/** One shared flat-shaded material per flat layer. */
export function materialFor(layer: string): THREE.MeshLambertMaterial {
  let m = flatCache.get(layer);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: PALETTE[FLAT_COLOURS[layer] ?? 'ground'],
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
  value: PALETTE_ORDER.map((n) => new THREE.Color(PALETTE[n])),
};

const PROGRAM_KEY = 'milano-iso-feature-colour-v1';

/**
 * A flat-shaded Lambert material whose diffuse colour is `palette[lookup[_feature_id]]`.
 * One instance per (tile, mesh), all with the same program (same `customProgramCacheKey`), so the
 * draw-call count is the same as with a shared material. The texture is owned by the material and
 * freed by `disposeLookupMaterial`.
 */
export function createLookupMaterial(layer: string, lookup: THREE.DataTexture): THREE.MeshLambertMaterial {
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
flat varying float vFeatureId;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFeatureId = _feature_id;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D featureIndex;
uniform vec3 paletteColours[${PALETTE_ORDER.length}];
flat varying float vFeatureId;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  int fid = int(vFeatureId + 0.5);
  int pal = int(texelFetch(featureIndex, ivec2(fid % ${LOOKUP_WIDTH}, fid / ${LOOKUP_WIDTH}), 0).r * 255.0 + 0.5);
  diffuseColor.rgb *= paletteColours[pal];
}`,
      );
  };
  m.customProgramCacheKey = () => PROGRAM_KEY;
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
