import { mountBeforeAttribution } from '../dom';
import { type Lang, getLang, t } from '../i18n';
import type { StyleMode } from '../style/palette';
import type { CardModel } from './model';

/** What a test can read from the open card. */
export interface CardState {
  open: boolean;
  title: string;
  named: boolean;
  type: string;
  height: string | null;
  heightSource: string | null;
  osmUrl: string | null;
  note: string | null;
  pending: boolean;
}

const CLOSED: CardState = {
  open: false,
  title: '',
  named: false,
  type: '',
  height: null,
  heightSource: null,
  osmUrl: null,
  note: null,
  pending: false,
};

/**
 * Layout (T-5.1, T-5.4): desktop, a panel at the right below the rotation buttons (top 108 px, above
 * the attribution); narrow screens, a bottom sheet above the attribution. Style constants, not
 * data. Colours are the shared UI variables of index.html, so day and night follow `<html>`.
 */
const CARD_TOP_PX = 108;
const CSS = `
#info-card {
  position: fixed; right: 6px; top: ${CARD_TOP_PX}px; width: 300px; max-height: calc(100vh - ${CARD_TOP_PX}px - 56px);
  overflow-y: auto; box-sizing: border-box; z-index: 11; padding: 10px 12px 12px;
  font: 14px/1.4 sans-serif; color: var(--tb-fg); background: var(--tb-bg);
  border: 1px solid var(--tb-border); border-radius: 3px;
}
#info-card[hidden] { display: none; }
#info-card h2 { margin: 0 48px 6px 0; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
#info-card h2.unnamed { font-style: italic; font-weight: 600; }
#info-card dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; }
#info-card dt { font-weight: 600; }
#info-card dd { margin: 0; overflow-wrap: anywhere; }
#info-card p { margin: 8px 0 0; }
#info-card a { display: inline-flex; align-items: center; min-height: 44px; color: var(--tb-link); }
#info-card .close {
  position: absolute; right: 4px; top: 4px; width: 44px; height: 44px; box-sizing: border-box; padding: 0;
  font: 22px sans-serif; cursor: pointer; color: inherit; background: transparent;
  border: 1px solid var(--tb-border); border-radius: 3px;
}
@media (max-width: 600px) {
  #info-card { left: 6px; right: 6px; top: auto; bottom: 56px; width: auto; max-height: 45vh; }
}
`;

export interface InfoCard {
  /** Shows `model` (or hides the card with null). `focus` moves focus into the card when it opens. */
  show: (model: CardModel | null, focus: boolean) => void;
  setMode: (mode: StyleMode) => void;
  setLang: (lang: Lang) => void;
  state: () => CardState;
  readonly element: HTMLElement;
}

/**
 * The info card: a non-modal `role="dialog"` labelled by its title. Focus moves into it when it
 * opens and returns to the element that had it when it closes. `onClose` runs when the user closes
 * it with the close button (the caller clears the selection).
 */
export function createInfoCard(onClose: () => void, initialLang: Lang = getLang()): InfoCard {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'info-card';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'info-card-title');
  root.tabIndex = -1;
  root.hidden = true;
  mountBeforeAttribution(root); // tab order: ..., controls at the right, the card, the attribution

  let lang = initialLang;
  let model: CardModel | null = null;
  let returnFocusTo: HTMLElement | null = null;

  function field(dl: HTMLElement, label: string, id: string): HTMLElement {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.id = id;
    dl.append(dt, dd);
    return dd;
  }

  function render(): void {
    root.replaceChildren();
    if (!model) return;
    const h = document.createElement('h2');
    h.id = 'info-card-title';
    h.textContent = model.title;
    if (!model.named) h.className = 'unnamed';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', t('close', lang));
    close.title = t('close', lang);
    close.addEventListener('click', onClose);
    const dl = document.createElement('dl');
    field(dl, t('cardType', lang), 'info-card-type').textContent = model.typeLabel;
    if (model.height) {
      field(dl, t('cardHeight', lang), 'info-card-height').textContent = model.height.text;
      field(dl, t('cardHeightSource', lang), 'info-card-height-source').textContent = model.height.source;
    }
    root.append(h, close, dl);
    if (model.osmUrl) {
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.id = 'info-card-osm';
      a.href = model.osmUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = t('cardOsmLink', lang);
      p.appendChild(a);
      root.appendChild(p);
    }
    if (model.note) {
      const p = document.createElement('p');
      p.id = 'info-card-note';
      p.textContent = model.note;
      root.appendChild(p);
    }
    if (model.pending) {
      const p = document.createElement('p');
      p.id = 'info-card-pending';
      p.setAttribute('role', 'status');
      p.textContent = t('cardLoading', lang);
      root.appendChild(p);
    }
  }

  /**
   * Keeps the card clear of the attribution, whatever height it wraps to: bottom sheet above it on
   * narrow screens, a right panel that ends above it on wide ones.
   */
  function layout(): void {
    const attr = document.getElementById('attribution');
    const dbg = document.getElementById('debug-overlay');
    const top = attr ? attr.getBoundingClientRect().top : window.innerHeight;
    if (window.matchMedia('(max-width: 600px)').matches) {
      // Bottom sheet above the attribution and, in ?debug mode, above the debug overlay (T-5.4).
      const edge = dbg ? Math.min(top, dbg.getBoundingClientRect().top) : top;
      root.style.bottom = `${Math.max(0, window.innerHeight - edge) + 6}px`;
      root.style.right = '';
      root.style.maxHeight = '';
    } else {
      root.style.bottom = '';
      root.style.maxHeight = `${Math.max(120, top - 6 - CARD_TOP_PX)}px`;
      // The ?debug overlay (T-3.4) sits at the right too: the card moves left of it.
      root.style.right = dbg ? `${Math.round(window.innerWidth - dbg.getBoundingClientRect().left + 6)}px` : '';
    }
  }
  window.addEventListener('resize', layout);

  return {
    element: root,
    show(next, focus) {
      const wasOpen = !root.hidden;
      model = next;
      if (!next) {
        root.hidden = true;
        render();
        const back = returnFocusTo;
        returnFocusTo = null;
        if (wasOpen && back && back.isConnected) back.focus({ preventScroll: true });
        return;
      }
      if (!wasOpen) {
        const active = document.activeElement;
        returnFocusTo = active instanceof HTMLElement && active !== document.body && !root.contains(active) ? active : null;
      }
      render();
      root.hidden = false;
      layout();
      if (focus || !wasOpen) root.focus({ preventScroll: true });
    },
    setMode(mode) {
      root.classList.toggle('night', mode === 'night');
    },
    setLang(l) {
      lang = l;
    },
    state() {
      if (root.hidden || !model) return { ...CLOSED };
      const text = (id: string): string | null => root.querySelector(`#${id}`)?.textContent ?? null;
      return {
        open: true,
        title: model.title,
        named: model.named,
        type: model.typeLabel,
        height: text('info-card-height'),
        heightSource: text('info-card-height-source'),
        osmUrl: root.querySelector<HTMLAnchorElement>('#info-card-osm')?.href ?? null,
        note: model.note,
        pending: model.pending,
      };
    },
  };
}
