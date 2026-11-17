/**
 * Shared selection state (Phase 5 contract between picking/info card and search).
 *
 * T-5.1 (picking, info card) and T-5.3b (search) both call `select`; the info card and the
 * highlight listen with `onSelect`. A ref says how to find the feature in the tile feature
 * tables or the search index (ADR-0031); it never carries display data, which the listener
 * looks up itself so that what is shown always comes from the data files.
 */

export interface FeatureRef {
  /** Tile feature-table layer: 'buildings', 'roads', 'trees', 'green', 'water', ... or 'landmark'. */
  layer: string;
  /** Tile name, when known (picking always knows it; search may not). */
  tile?: string;
  /** Building key (`buildings` layer). */
  key?: string;
  osmType?: string;
  osmId?: number;
  /** Landmark id from tests/landmarks.yaml. */
  landmarkId?: string;
  /** Street name, for a search hit on a grouped street (ADR-0031). */
  streetName?: string;
}

export interface Selection {
  ref: FeatureRef;
  source: 'pick' | 'search';
}

type Listener = (s: Selection | null) => void;

const listeners = new Set<Listener>();
let current: Selection | null = null;

/** Select a feature, or clear the selection with `null`. Listeners run synchronously. */
export function select(s: Selection | null): void {
  current = s;
  for (const fn of [...listeners]) fn(s);
}

export function currentSelection(): Selection | null {
  return current;
}

/** Subscribe; returns an unsubscribe function. */
export function onSelect(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test helper: drop all listeners and the current selection. */
export function resetSelection(): void {
  listeners.clear();
  current = null;
}
