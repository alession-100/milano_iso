/**
 * Level of detail selection and switching (T-6.2, ADR-0037). Pure functions, no three.js.
 *
 * Error bound, not taste: a level may be shown only where its error is at most one screen pixel,
 * i.e. where the metres per pixel are at least its `tolerance_m`. Level 0 (the base tiles) is
 * always allowed. Switching never leaves a hole and never draws a parent with its children.
 */

export interface LevelSpec {
  level: number;
  tolerance_m: number;
}

/**
 * Going to a finer level waits until the metres per pixel are this fraction of the coarser level's
 * tolerance, so a view that hovers around a threshold does not flicker between two levels. Style/UX
 * constant, not data.
 */
export const HYSTERESIS = 0.85;

/**
 * The level to use at `mpp` metres per pixel: the coarsest level whose tolerance is at most `mpp`
 * (level 0 if none). Coarser is taken at once; finer only once `mpp` is below the current
 * level's tolerance times HYSTERESIS.
 */
export function chooseLevel(specs: readonly LevelSpec[], mpp: number, current: number): number {
  let target = specs[0]?.level ?? 0;
  for (const s of specs) if (s.tolerance_m <= mpp) target = s.level;
  if (target >= current) return target;
  const cur = specs.find((s) => s.level === current);
  if (cur && mpp >= cur.tolerance_m * HYSTERESIS) return current;
  return target;
}

/** A tile's place in the draw plan: its level and its grid cell [xmin, zmin, xmax, zmax]. */
export interface Cell {
  id: string;
  level: number;
  box: readonly [number, number, number, number];
}

/** True when the interiors of the two cells overlap (touching edges do not count). */
export function overlaps(a: Cell, b: Cell): boolean {
  return a.box[0] < b.box[2] && a.box[2] > b.box[0] && a.box[1] < b.box[3] && a.box[3] > b.box[1];
}

/**
 * Which loaded tiles to draw so that every ground point is drawn by exactly one tile, and the
 * content of the chosen level replaces an older level only when it is all there.
 *
 *  - A coarser tile that is already loaded stays (and the chosen tiles inside it are hidden) while
 *    any visible chosen tile inside it is still missing.
 *  - A chosen tile that is loaded is drawn unless such a coarser tile covers it.
 *  - A missing chosen tile is covered by the loaded finer tiles of the nearest finer level.
 *
 * `visibleChosen`: the chosen-level tiles in view; `loaded`: every loaded tile of any level.
 */
export function planDraw(
  chosen: number,
  visibleChosen: readonly Cell[],
  loaded: readonly Cell[],
  isLoaded: (id: string) => boolean,
): Set<string> {
  const drawn: Cell[] = [];
  const clear = (c: Cell): boolean => !drawn.some((d) => overlaps(d, c));
  const missing = visibleChosen.filter((c) => !isLoaded(c.id));

  // A: coarser tiles kept while something inside them is missing, nearest coarser level first.
  const coarser = loaded.filter((t) => t.level > chosen).sort((a, b) => a.level - b.level);
  for (const t of coarser) {
    if (missing.some((m) => overlaps(t, m)) && clear(t)) drawn.push(t);
  }
  // B: loaded chosen tiles not covered by a kept coarser tile.
  for (const t of loaded) {
    if (t.level === chosen && clear(t)) drawn.push(t);
  }
  // C: a missing chosen tile that nothing drawn covers yet: the nearest finer level that is loaded.
  const finer = loaded.filter((t) => t.level < chosen).sort((a, b) => b.level - a.level);
  for (const m of missing) {
    if (!clear(m)) continue;
    const under = finer.filter((t) => overlaps(t, m));
    if (under.length === 0) continue;
    const lv = under[0].level;
    for (const t of under) if (t.level === lv && clear(t)) drawn.push(t);
  }
  return new Set(drawn.map((c) => c.id));
}

/** The grid cell of a tile entry: its `bbox_local`, else the horizontal extent of its content. */
export function cellOf(t: {
  id: string;
  level?: number;
  bbox_local?: readonly [number, number, number, number];
  content_bbox_local: { min: readonly number[]; max: readonly number[] };
}): Cell {
  const b = t.bbox_local ?? [
    t.content_bbox_local.min[0],
    t.content_bbox_local.min[2],
    t.content_bbox_local.max[0],
    t.content_bbox_local.max[2],
  ];
  return { id: t.id, level: t.level ?? 0, box: [b[0], b[1], b[2], b[3]] };
}
