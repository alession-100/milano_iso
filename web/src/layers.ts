/**
 * Layer toggles (T-5.3b). A toggle hides the meshes of one or more tile layers (including tiles
 * loaded later); the state is remembered in localStorage and can be set with `?layers=`.
 * `layerVisible` is the single question picking has to ask: a hidden layer is not pickable.
 */

export const TOGGLE_IDS = ['buildings', 'trees', 'markings', 'roads', 'waterGreen', 'landmarkDetails'] as const;
export type ToggleId = (typeof TOGGLE_IDS)[number];

/** Tile layers (mesh names / feature-table layers) controlled by each toggle. */
export const TOGGLE_LAYERS: Record<ToggleId, readonly string[]> = {
  buildings: ['buildings'],
  trees: ['trees'],
  markings: ['markings'],
  roads: ['roads', 'road_areas', 'rail'],
  waterGreen: ['water', 'green', 'landuse'],
  landmarkDetails: ['landmark_details'],
};

export const LAYERS_STORAGE_KEY = 'milano-iso.layers';

export type LayerState = Record<ToggleId, boolean>;

export function allVisible(): LayerState {
  return Object.fromEntries(TOGGLE_IDS.map((id) => [id, true])) as LayerState;
}

/**
 * Parses a list of the toggles that are ON: comma-separated ids, or `none`. Returns null when the
 * value is absent or empty (meaning "no opinion"); unknown ids are ignored.
 */
export function parseLayerList(raw: string | null | undefined): LayerState | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const wanted = new Set(raw.split(',').map((s) => s.trim()));
  const state = allVisible();
  for (const id of TOGGLE_IDS) state[id] = wanted.has(id);
  return state;
}

export function parseLayersParam(search: string): LayerState | null {
  return parseLayerList(new URLSearchParams(search).get('layers'));
}

export function serialiseLayers(state: LayerState): string {
  const on = TOGGLE_IDS.filter((id) => state[id]);
  return on.length === 0 ? 'none' : on.join(',');
}

export function readStoredLayers(): LayerState | null {
  try {
    return parseLayerList(window.localStorage.getItem(LAYERS_STORAGE_KEY));
  } catch {
    return null; // storage blocked: not an error
  }
}

export function storeLayers(state: LayerState): void {
  try {
    window.localStorage.setItem(LAYERS_STORAGE_KEY, serialiseLayers(state));
  } catch {
    // storage blocked: the choice is simply not remembered
  }
}

/** Initial state: the URL wins, then the remembered choice, then everything visible. */
export function initialLayers(search: string): LayerState {
  return parseLayersParam(search) ?? readStoredLayers() ?? allVisible();
}

let state: LayerState = allVisible();

export function setLayerState(next: LayerState): void {
  state = { ...next };
}

export function layerState(): LayerState {
  return { ...state };
}

/**
 * Is this tile layer (`buildings`, `roads`, `water`, ...) or toggle id (`waterGreen`, ...) shown?
 * Layers no toggle controls (for example `landmark`, a selection layer) count as visible.
 */
export function layerVisible(name: string): boolean {
  if ((TOGGLE_IDS as readonly string[]).includes(name)) return state[name as ToggleId];
  for (const id of TOGGLE_IDS) {
    if (TOGGLE_LAYERS[id].includes(name)) return state[id];
  }
  return true;
}

/** Same rule on a tile layer name, for a given state (pure; used by the scene walk and tests). */
export function layerVisibleIn(s: LayerState, layer: string): boolean {
  for (const id of TOGGLE_IDS) {
    if (TOGGLE_LAYERS[id].includes(layer)) return s[id];
  }
  return true;
}

interface Visual {
  name: string;
  visible: boolean;
  isMesh?: boolean;
  traverse(fn: (o: Visual) => void): void;
}

/** Applies the current state to every mesh below `root` (a tile group, or the tile root). */
export function applyLayerVisibility(root: Visual): void {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const hash = o.name.indexOf('#');
    o.visible = layerVisible(hash < 0 ? o.name : o.name.slice(0, hash));
  });
}
