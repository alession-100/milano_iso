import { DEFAULT_LANG, type Key, t } from './i18n';
import { TOGGLE_IDS, type LayerState, type ToggleId } from './layers';
import { clientToLocal, nightCss, parseViewBox, polygonPoints } from './minimap';
import { type Hit, type IndexEntry, hitLabel, search } from './search';
import type { StyleMode } from './style/palette';

const KIND_KEY: Record<string, Key> = {
  building: 'kindBuilding',
  street: 'kindStreet',
  green: 'kindGreen',
  water: 'kindWater',
  landmark: 'kindLandmark',
};
const LAYER_KEY: Record<ToggleId, Key> = {
  buildings: 'layerBuildings',
  trees: 'layerTrees',
  markings: 'layerMarkings',
  roads: 'layerRoads',
  waterGreen: 'layerWaterGreen',
  landmarkDetails: 'layerLandmarkDetails',
};

export interface ToolbarDeps {
  /** Fetches and parses the search index; called once, on first focus of the search box. */
  loadIndex: () => Promise<IndexEntry[]>;
  onChoose: (hit: Hit) => void;
  layers: LayerState;
  onToggle: (id: ToggleId, visible: boolean) => void;
  /** Click or tap on the minimap, in local metres. */
  onMinimapPick: (x: number, z: number) => void;
}

export interface ToolbarState {
  query: string;
  resultCount: number;
  results: string[];
  status: string;
  indexRequested: boolean;
  layersOpen: boolean;
  minimapLoaded: boolean;
  minimapView: [number, number][] | null;
}

export interface Toolbar {
  /** The zone below the toolbar where other notices stack (the tiles notice). */
  zone: HTMLElement;
  setMode: (mode: StyleMode) => void;
  setMinimap: (svg: SVGSVGElement) => void;
  setView: (poly: [number, number][]) => void;
  state: () => ToolbarState;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<'id' | 'className' | 'textContent', string>> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  return e;
}

/**
 * Top-left toolbar: search combobox, layers panel and minimap button; the minimap itself; and the
 * stack below it where the tiles notice goes. The rotation and day/night buttons stay top right
 * (T-4.3, T-5.2: the approved baselines show them). Everything stacks in one flow (no absolutely
 * positioned popups), so nothing can cover the tiles notice. The info card zone is on the right
 * (desktop) or the bottom (412 px): the toolbar never goes there. Layout CSS is in index.html.
 */
export function createToolbar(deps: ToolbarDeps): Toolbar {
  const lang = DEFAULT_LANG;
  const zone = el('div', { id: 'toolbar-zone' });
  const bar = el('div', { id: 'toolbar' });
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('toolbarLabel', lang));

  // --- search combobox ---
  const searchBox = el('div', { id: 'search-box' });
  const input = el('input', { id: 'search-input' });
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = t('searchPlaceholder', lang);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', t('searchLabel', lang));
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'search-list');
  input.setAttribute('aria-autocomplete', 'list');
  searchBox.append(input);
  const list = el('ul', { id: 'search-list' });
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('searchResults', lang));
  list.hidden = true;
  const status = el('div', { id: 'search-status' });
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  let entries: IndexEntry[] | null = null;
  let indexState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let hits: Hit[] = [];
  let active = -1;
  let statusText = '';

  const setStatus = (s: string, visible = false): void => {
    statusText = s;
    status.textContent = s;
    status.className = visible ? 'visible' : 'sr-only';
  };
  const closeList = (): void => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const setActive = (i: number): void => {
    active = i;
    list.querySelectorAll('li').forEach((li, k) => {
      li.setAttribute('aria-selected', String(k === i));
      li.classList.toggle('active', k === i);
    });
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `search-opt-${i}`);
      list.children[i]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i: number): void => {
    const hit = hits[i];
    if (!hit) return;
    input.value = hitLabel(hit);
    closeList();
    deps.onChoose(hit);
  };
  const refresh = (): void => {
    list.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const q = input.value;
    if (q.trim() === '' || indexState === 'idle') {
      hits = [];
      closeList();
      setStatus('');
      return;
    }
    if (indexState === 'loading') {
      hits = [];
      closeList();
      setStatus(t('searchLoading', lang), true);
      return;
    }
    if (indexState === 'error' || !entries) {
      hits = [];
      closeList();
      setStatus(t('searchError', lang), true);
      return;
    }
    hits = search(entries, q);
    if (hits.length === 0) {
      closeList();
      setStatus(t('searchNone', lang), true);
      return;
    }
    hits.forEach((hit, i) => {
      const li = el('li');
      li.id = `search-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const name = el('span', { className: 'name', textContent: hitLabel(hit) });
      const kind = el('span', { className: 'kind', textContent: t(KIND_KEY[hit.kind], lang) });
      li.append(name, kind);
      // pointerdown + preventDefault keeps focus in the input; click chooses.
      li.addEventListener('pointerdown', (e) => e.preventDefault());
      li.addEventListener('click', () => choose(i));
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setStatus(t('searchCount', lang).replace('{n}', String(hits.length)));
  };

  const ensureIndex = (): void => {
    if (indexState === 'loading' || indexState === 'ready') return;
    indexState = 'loading';
    indexRequested = true;
    deps
      .loadIndex()
      .then((e) => {
        entries = e;
        indexState = 'ready';
      })
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        indexState = 'error';
      })
      .finally(refresh);
  };
  let indexRequested = false;
  input.addEventListener('focus', ensureIndex);
  input.addEventListener('input', () => {
    ensureIndex(); // covers programmatic fills without focus
    refresh();
  });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) refresh();
      if (hits.length > 0) setActive((active + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open && hits.length > 0) setActive((active - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      if (open && hits.length > 0) {
        e.preventDefault();
        choose(active >= 0 ? active : 0);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
      }
    }
  });
  input.addEventListener('blur', () => {
    // Choosing with the mouse keeps focus (pointerdown is prevented), so blur means leaving.
    closeList();
  });

  // --- layers button and panel ---
  const layersBtn = el('button', { id: 'layers-button', textContent: t('layers', lang) });
  layersBtn.type = 'button';
  layersBtn.className = 'tb-btn';
  layersBtn.setAttribute('aria-expanded', 'false');
  layersBtn.setAttribute('aria-controls', 'layers-panel');
  const panel = el('div', { id: 'layers-panel' });
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', t('layersTitle', lang));
  panel.hidden = true;
  const boxes = new Map<ToggleId, HTMLInputElement>();
  for (const id of TOGGLE_IDS) {
    const label = el('label');
    const box = el('input', { id: `layer-${id}` });
    box.type = 'checkbox';
    box.checked = deps.layers[id];
    box.addEventListener('change', () => deps.onToggle(id, box.checked));
    label.append(box, el('span', { textContent: t(LAYER_KEY[id], lang) }));
    panel.append(label);
    boxes.set(id, box);
  }
  const closeLayers = (): void => {
    panel.hidden = true;
    layersBtn.setAttribute('aria-expanded', 'false');
  };
  layersBtn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    layersBtn.setAttribute('aria-expanded', String(open));
    if (open) closeMinimapPanel();
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLayers();
      layersBtn.focus();
    }
  });

  // --- minimap (fixed bottom-left on desktop, collapsed behind a button at 412 px) ---
  const mmBtn = el('button', { id: 'minimap-button', textContent: t('minimapButton', lang) });
  mmBtn.type = 'button';
  mmBtn.className = 'tb-btn';
  mmBtn.setAttribute('aria-expanded', 'false');
  mmBtn.setAttribute('aria-controls', 'minimap');
  const mm = el('div', { id: 'minimap' });
  mm.setAttribute('role', 'img');
  mm.setAttribute('aria-label', t('minimapLabel', lang));
  mm.title = t('minimapLabel', lang);
  mm.dataset.mode = 'day';
  const mmStyle = el('style');
  mmStyle.textContent = nightCss();
  let svg: SVGSVGElement | null = null;
  let viewPoly: SVGPolygonElement | null = null;
  let viewPoints: [number, number][] | null = null;
  const closeMinimapPanel = (): void => {
    mm.classList.remove('open');
    mmBtn.setAttribute('aria-expanded', 'false');
  };
  mmBtn.addEventListener('click', () => {
    const open = !mm.classList.contains('open');
    mm.classList.toggle('open', open);
    mmBtn.setAttribute('aria-expanded', String(open));
    if (open) closeLayers();
  });
  mm.addEventListener('click', (e) => {
    if (!svg) return;
    const vb = parseViewBox(svg.getAttribute('viewBox'));
    if (!vb) return;
    const [x, z] = clientToLocal(vb, svg.getBoundingClientRect(), e.clientX, e.clientY);
    deps.onMinimapPick(x, z);
  });

  bar.append(searchBox, layersBtn, mmBtn);
  zone.append(bar, list, status, panel, mm);
  document.body.prepend(zone); // first in tab order
  document.body.append(mmStyle);

  return {
    zone,
    setMode: (mode) => {
      document.documentElement.dataset.mode = mode;
      mm.dataset.mode = mode;
    },
    setMinimap: (s) => {
      svg?.remove();
      svg = s;
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const ns = 'http://www.w3.org/2000/svg';
      viewPoly = document.createElementNS(ns, 'polygon');
      viewPoly.setAttribute('class', 'mm-view');
      svg.append(viewPoly);
      if (viewPoints) viewPoly.setAttribute('points', polygonPoints(viewPoints));
      mm.append(svg);
    },
    setView: (poly) => {
      viewPoints = poly;
      viewPoly?.setAttribute('points', polygonPoints(poly));
    },
    state: () => ({
      query: input.value,
      resultCount: hits.length,
      results: hits.map(hitLabel),
      status: statusText,
      indexRequested,
      layersOpen: !panel.hidden,
      minimapLoaded: svg !== null,
      minimapView: viewPoints,
    }),
  };
}
