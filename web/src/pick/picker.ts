import * as THREE from 'three';
import { DEFAULT_LANG, type Lang } from '../i18n';
import { type FeatureRef, currentSelection, onSelect, select } from '../selection';
import { MASK_HOVER, MASK_SELECTED, clearMask, hasMask, layerOf, setMask } from '../style/materials';
import type { FeatureTable } from '../style/materials';
import type { StyleMode } from '../style/palette';
import { e2eEnabled, registerTestState } from '../testhook';
import { type InfoCard, createInfoCard } from './card';
import { cardModel } from './model';
import {
  IndexLookup,
  type IndexEntry,
  PICKABLE_LAYERS,
  type Row,
  type Tables,
  isPickable,
  matcherFor,
  refForRow,
  refKey,
  rowForFeature,
} from './rows';

/**
 * A press that moves more than this many CSS px (or uses a second finger) is a pan or pinch, never
 * a pick. Style/UX constant; controls.ts has no click threshold of its own to reuse.
 */
export const CLICK_SLOP_PX = 6;

/** Instance colour multipliers of a highlighted tree (STYLE tint, not a palette entry). */
const TREE_HOVER = new THREE.Color(1.5, 1.25, 0.6);
const TREE_SELECTED = new THREE.Color(1.9, 1.5, 0.5);
const TREE_PLAIN = new THREE.Color(1, 1, 1);

export interface PickerDeps {
  host: HTMLElement;
  camera: THREE.OrthographicCamera;
  tileRoot: THREE.Object3D;
  requestRender: () => void;
}

interface PressState {
  id: number;
  x: number;
  y: number;
  moved: boolean;
}

/** Feature tables of the tiles currently in the scene, by tile id. */
export function tablesOf(tileRoot: THREE.Object3D): Tables {
  const out = new Map<string, FeatureTable>();
  for (const g of tileRoot.children) {
    const table = g.userData.table as FeatureTable | undefined;
    if (table) out.set(g.name, table);
  }
  return out;
}

/** Picking, hover highlight, selection highlight and the info card (T-5.1). */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly card: InfoCard;
  private index = new IndexLookup();
  private lang: Lang = DEFAULT_LANG;
  private hover: FeatureRef | null = null;
  private hoverCount = 0;
  private selected: FeatureRef | null = null;
  private selectedSource: string | null = null;
  private press: PressState | null = null;
  private readonly pointers = new Set<number>();
  private frame = 0;
  private last = { x: 0, y: 0 };
  private readonly timing = { count: 0, lastMs: 0, maxMs: 0 };

  constructor(private readonly deps: PickerDeps) {
    this.card = createInfoCard(() => select(null), this.lang);
    const { host } = deps;
    host.addEventListener('pointerdown', this.onDown);
    host.addEventListener('pointermove', this.onMove);
    host.addEventListener('pointerup', this.onUp);
    host.addEventListener('pointercancel', this.onCancel);
    host.addEventListener('pointerleave', this.onLeave);
    document.addEventListener('keydown', this.onKey);
    onSelect((s) => this.onSelection(s ? s.ref : null, s ? s.source : null));
    registerTestState('selection', () => ({
      current: this.selected,
      source: this.selectedSource,
      hover: this.hover,
      hoverCount: this.hoverCount,
      card: this.card.state(),
      pick: { ...this.timing },
    }));
    if (e2eEnabled()) {
      const w = window as unknown as Record<string, unknown>;
      /** Ref under a client point, without selecting it. */
      w.__milanoIsoPickAt = (x: number, y: number): FeatureRef | null => this.pickAt(x, y);
      /** Client pixel of a ground point (x, y up, z) in client metres. */
      w.__milanoIsoScreenOf = (x: number, y: number, z: number): { x: number; y: number } => {
        const r = host.getBoundingClientRect();
        deps.camera.updateMatrixWorld();
        const v = new THREE.Vector3(x, y, z).project(deps.camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      };
    }
  }

  setIndex(entries: readonly IndexEntry[]): void {
    this.index = new IndexLookup(entries);
    this.refreshSelection();
  }

  setMode(mode: StyleMode): void {
    this.card.setMode(mode);
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.card.setLang(lang);
    this.refreshSelection();
  }

  /** A tile arrived or left: fill in a pending card and re-apply the highlights. */
  tilesChanged(): void {
    this.refreshSelection();
    if (this.hover || this.selected) this.applyHighlight();
  }

  // --- picking -----------------------------------------------------------------------------

  private candidates(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const g of this.deps.tileRoot.children) {
      for (const m of g.children) {
        if ((m as THREE.Mesh).isMesh && PICKABLE_LAYERS.has(layerOf(m.name))) out.push(m);
      }
    }
    return out;
  }

  /** The feature under a client point, or null. Fill trees and markings let the ray through. */
  pickAt(clientX: number, clientY: number): FeatureRef | null {
    const r = this.deps.host.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.deps.camera.updateMatrixWorld();
    this.deps.tileRoot.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    const hits = this.raycaster.intersectObjects(this.candidates(), false);
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      const layer = layerOf(mesh.name);
      const group = mesh.parent;
      if (!group) continue;
      const row = this.rowOfHit(hit, mesh, layer, group);
      if (!isPickable(layer, row) || !row) continue;
      const ref = refForRow(layer, group.name, row);
      if (ref) return ref;
    }
    return null;
  }

  /** The feature-table row of a ray hit: the face's `_feature_id`, or the instance of a tree. */
  private rowOfHit(hit: THREE.Intersection, mesh: THREE.Mesh, layer: string, group: THREE.Object3D): Row | null {
    if (layer === 'trees') {
      const rows = mesh.userData.treeRows as Row[] | undefined;
      return hit.instanceId === undefined ? null : (rows?.[hit.instanceId] ?? null);
    }
    const attr = mesh.geometry.getAttribute('_feature_id');
    if (!hit.face || !attr) return null;
    return rowForFeature(group.userData.table as FeatureTable | undefined, layer, attr.getX(hit.face.a));
  }

  // --- pointer input -----------------------------------------------------------------------

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.add(e.pointerId);
    if (this.pointers.size === 1) this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    else if (this.press) this.press.moved = true; // a second finger: pinch, not a tap
    this.clearHover();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.press;
    if (p && e.pointerId === p.id && !p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP_PX) {
      p.moved = true;
    }
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return; // hover is for a free mouse only
    this.last = { x: e.clientX, y: e.clientY };
    if (this.frame) return; // at most one raycast per animation frame
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.hoverAt(this.last.x, this.last.y);
    });
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const p = this.press;
    if (p && e.pointerId === p.id) {
      this.press = null;
      if (!p.moved) this.click(e.clientX, e.clientY);
    }
    if (this.pointers.size === 0) this.press = null;
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.press && e.pointerId === this.press.id) this.press = null;
    if (this.pointers.size === 0) this.press = null;
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.clearHover();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && currentSelection()) select(null);
  };

  private click(x: number, y: number): void {
    const ref = this.pickAt(x, y);
    if (ref) select({ ref, source: 'pick' });
    else if (currentSelection()) select(null);
  }

  // --- hover -------------------------------------------------------------------------------

  private hoverAt(x: number, y: number): void {
    const t0 = performance.now();
    const ref = this.pickAt(x, y);
    const ms = performance.now() - t0;
    this.timing.count += 1;
    this.timing.lastMs = ms;
    this.timing.maxMs = Math.max(this.timing.maxMs, ms);
    this.setHover(ref);
  }

  private setHover(ref: FeatureRef | null): void {
    if (refKey(ref) === refKey(this.hover)) return;
    this.hover = ref;
    this.deps.host.style.cursor = ref ? 'pointer' : '';
    this.applyHighlight();
  }

  private clearHover(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.hover) this.setHover(null);
  }

  // --- selection, highlight, card ----------------------------------------------------------

  private onSelection(ref: FeatureRef | null, source: string | null): void {
    this.selected = ref;
    this.selectedSource = source;
    this.applyHighlight();
    this.card.show(ref ? cardModel(ref, tablesOf(this.deps.tileRoot), this.index, this.lang) : null, true);
  }

  private refreshSelection(): void {
    if (!this.selected) return;
    this.card.show(cardModel(this.selected, tablesOf(this.deps.tileRoot), this.index, this.lang), false);
  }

  /** Writes the hover and selection marks into the per-tile masks (ADR-0026) and the tree colours. */
  private applyHighlight(): void {
    const hm = this.hover ? matcherFor(this.hover, this.index) : null;
    const sm = this.selected ? matcherFor(this.selected, this.index) : null;
    const counted = new Set<string>();
    let hoverCount = 0;
    for (const group of this.deps.tileRoot.children) {
      const table = group.userData.table as FeatureTable | undefined;
      if (!table) continue;
      for (const m of group.children) {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) continue;
        const layer = layerOf(mesh.name);
        const inst = mesh as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          this.markTrees(inst, hm, sm);
          continue;
        }
        const rows = table.layers[layer];
        const mat = mesh.material as THREE.Material;
        if (!rows || !hasMask(mat)) continue;
        clearMask(mat);
        const hIds: number[] = [];
        const sIds: number[] = [];
        rows.forEach((row, i) => {
          if (hm?.(layer, row)) hIds.push(i);
          if (sm?.(layer, row)) sIds.push(i);
        });
        setMask(mat, hIds, MASK_HOVER);
        setMask(mat, sIds, MASK_SELECTED); // selection wins where both apply
        const k = `${group.name}|${layer}`;
        if (!counted.has(k)) {
          counted.add(k);
          hoverCount += hIds.length;
        }
      }
    }
    this.hoverCount = hoverCount;
    this.deps.requestRender();
  }

  private markTrees(
    mesh: THREE.InstancedMesh,
    hm: ((layer: string, row: Row) => boolean) | null,
    sm: ((layer: string, row: Row) => boolean) | null,
  ): void {
    const rows = mesh.userData.treeRows as Row[] | undefined;
    if (!rows) return;
    const state = rows.map((r) => (sm?.('trees', r) ? 2 : hm?.('trees', r) ? 1 : 0));
    const any = state.some((s) => s !== 0);
    if (!any && !mesh.instanceColor) return;
    rows.forEach((_, i) => mesh.setColorAt(i, state[i] === 2 ? TREE_SELECTED : state[i] === 1 ? TREE_HOVER : TREE_PLAIN));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
