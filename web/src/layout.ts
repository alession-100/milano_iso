/**
 * The reserved attribution band (T-5.7, ADR-0034).
 *
 * The attribution (hard rule 10, ODbL) sits in a band at the bottom of the screen. The band is exactly as
 * tall as the attribution is (it wraps to more lines on narrow screens, and more in another language), so
 * its height is measured, never guessed, and published as the CSS variable `--band` (the attribution's
 * height plus its 6 px margin and a 6 px gap above it). Every other block of the UI is laid out in the
 * area above the band: where that area is short, a block scrolls inside itself, shrinks (the minimap) or
 * yields (the tile notice keeps its text in its live region and is only drawn when there is room).
 * Nothing is placed by a pixel guess per screen size: this one rule holds at every size.
 */

const GAP = 6;
/** The toolbar zone and the card share the area above the band; the card keeps at least this much. */
export const CARD_FLOOR_PX = 64;
/** A panel never shrinks below one row (44 px, the target size). */
const PANEL_FLOOR_PX = 44;
const MINIMAP_MIN_WIDTH_PX = 80;
const MINIMAP_MAX_WIDTH_PX = 200;
const CARD_TOP_RIGHT_PX = 108;

/** Width of the screen where the info card is a bottom sheet (index.html and CSS use the same value). */
export const SHEET_QUERY = '(max-width: 699px)';
/** Where the minimap is fixed bottom-left (otherwise it is behind a button, in the toolbar zone). */
export const ROOMY_QUERY = '(min-width: 700px) and (min-height: 600px)';

export interface Allocation {
  zoneMax: number;
  cardMax: number;
  /** The zone needs more than it gets: something must scroll, shrink or yield. */
  short: boolean;
}

/**
 * Splits `avail` px (from the top margin to the band) between the toolbar zone (natural height `zone`) and,
 * when the card is a bottom sheet, the card (natural height `card`, null without a sheet). The zone is
 * served first, the card keeps at least `CARD_FLOOR_PX` (or its own height, if smaller).
 */
export function allocate(avail: number, zone: number, card: number | null): Allocation {
  if (card === null) return { zoneMax: avail, cardMax: 0, short: zone > avail + 0.5 };
  if (zone + GAP + card <= avail + 0.5) return { zoneMax: zone, cardMax: card, short: false };
  const floor = Math.min(card, CARD_FLOOR_PX);
  const cardMax = Math.max(floor, Math.min(card, avail - GAP - zone));
  const zoneMax = Math.max(0, avail - GAP - cardMax);
  return { zoneMax, cardMax, short: zone > zoneMax + 0.5 };
}

/** Width of the minimap box (px, border included) that makes it `height` px tall, for a viewBox ratio w/h. */
export function minimapWidthFor(height: number, ratioWH: number): number {
  const w = (height - 2) * ratioWH + 2;
  return Math.round(Math.max(MINIMAP_MIN_WIDTH_PX, Math.min(MINIMAP_MAX_WIDTH_PX, w)));
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);
const shown = (el: HTMLElement | null): el is HTMLElement => el !== null && !el.hidden && el.getClientRects().length > 0;

function fit(): void {
  const attr = byId('attribution');
  const zone = byId('toolbar-zone');
  const root = document.documentElement;
  const H = window.innerHeight;
  const band = Math.ceil(attr ? attr.getBoundingClientRect().height : 0) + 2 * GAP;
  root.style.setProperty('--band', `${band}px`);
  if (!zone) return;

  const sheet = window.matchMedia(SHEET_QUERY).matches;
  const roomy = window.matchMedia(ROOMY_QUERY).matches;
  const card = byId('info-card');
  const cardOpen = shown(card);
  const mm = byId('minimap');
  const notice = byId('tiles-notice');
  const dbg = byId('debug-overlay');
  const panels = ['search-list', 'layers-panel', 'help-panel'].map(byId).filter((e): e is HTMLElement => e !== null);

  // Bottom edge of the usable area: the band, or in a bottom sheet layout the ?debug overlay above it.
  let limit = H - band;
  if (sheet && shown(dbg)) limit = Math.min(limit, dbg.getBoundingClientRect().top - GAP);

  // Reset to natural sizes, then measure.
  zone.style.maxHeight = 'none';
  for (const p of panels) p.style.maxHeight = '';
  if (mm) mm.style.width = '';
  if (card) card.style.maxHeight = 'none';
  notice?.removeAttribute('data-yield');

  let avail = limit - GAP;
  if (roomy && shown(mm)) avail -= mm.offsetHeight + GAP; // the minimap is fixed bottom-left, above the band
  const cardNatural = sheet && cardOpen && card ? card.offsetHeight : null;

  let a = allocate(avail, zone.offsetHeight, cardNatural);
  if (a.short && notice) {
    notice.setAttribute('data-yield', ''); // text stays in the live region, nothing is drawn
    a = allocate(avail, zone.offsetHeight, cardNatural);
  }
  // The compact minimap is scaled to the room (its picks stay exact: the SVG fills the box).
  if (a.short && mm && !roomy && shown(mm)) {
    const svg = mm.querySelector('svg');
    const vb = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      const others = zone.offsetHeight - mm.offsetHeight;
      const w = minimapWidthFor(a.zoneMax - others, vb[2] / vb[3]);
      mm.style.width = `${w}px`;
      a = allocate(avail, zone.offsetHeight, cardNatural);
    }
  }
  // Whatever is still short scrolls inside the open panel.
  let excess = zone.offsetHeight - a.zoneMax;
  for (const p of panels) {
    if (excess <= 0.5 || !shown(p)) continue;
    const take = Math.min(excess, Math.max(0, p.offsetHeight - PANEL_FLOOR_PX));
    if (take > 0) {
      p.style.maxHeight = `${Math.floor(p.offsetHeight - take)}px`;
      excess -= take;
    }
  }
  zone.style.maxHeight = `${Math.max(0, Math.floor(a.zoneMax))}px`;
  // A scrolling help panel has no control inside it: it takes focus so the keyboard can scroll it.
  const help = byId('help-panel');
  if (help) {
    if (help.scrollHeight > help.clientHeight + 1) help.tabIndex = 0;
    else help.removeAttribute('tabindex');
  }

  if (card) {
    if (sheet) {
      card.style.bottom = `${H - limit}px`;
      card.style.maxHeight = cardOpen ? `${Math.floor(a.cardMax)}px` : '';
      card.style.right = '';
    } else {
      card.style.bottom = '';
      card.style.maxHeight = `${Math.max(CARD_FLOOR_PX, Math.floor(limit - CARD_TOP_RIGHT_PX))}px`;
      // The ?debug overlay (T-3.4) sits at the right too: the card moves left of it.
      card.style.right = shown(dbg) ? `${Math.round(window.innerWidth - dbg.getBoundingClientRect().left + GAP)}px` : '';
    }
  }
}

let queued = false;
/** Re-fits the layout once per frame, however many things asked for it. */
export function requestFit(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    fit();
  });
}

/** Re-fits right now (used where the result is read straight after a change). */
export function fitNow(): void {
  fit();
}

/**
 * Starts the band rule: the band follows the attribution's real size, and the zone and the card are
 * re-fitted whenever the screen, the attribution, the toolbar zone, the card or the debug overlay change.
 */
export function initLayout(): void {
  window.addEventListener('resize', requestFit);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(requestFit);
    for (const id of ['attribution', 'toolbar-zone', 'info-card', 'minimap']) {
      const el = byId(id);
      if (el) ro.observe(el);
    }
  }
  if (typeof MutationObserver !== 'undefined') {
    // Panels opening and closing, results, the notice, the card: size-independent changes of what is shown.
    const mo = new MutationObserver(requestFit);
    const opts = { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] };
    for (const id of ['toolbar-zone', 'info-card', 'attribution']) {
      const el = byId(id);
      if (el) mo.observe(el, opts);
    }
  }
  fit();
}
