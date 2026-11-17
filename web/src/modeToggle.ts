import { DEFAULT_LANG, t } from './i18n';
import type { StyleMode } from './style/palette';

export interface ModeToggle {
  button: HTMLButtonElement;
  /** Reflects the current mode in `aria-pressed` (pressed = night). */
  sync: (mode: StyleMode) => void;
}

/**
 * Day/night button, top right. The tiles notice (top left, 12 px font) and the attribution (bottom
 * right) are elsewhere, so it covers neither; it is a native button, so Tab, Enter and Space work.
 */
export function createModeToggle(initial: StyleMode, onToggle: () => void): ModeToggle {
  const button = document.createElement('button');
  button.id = 'mode-toggle';
  button.type = 'button';
  button.textContent = t('nightMode', DEFAULT_LANG);
  button.style.cssText =
    'position:fixed;right:6px;top:6px;z-index:10;font:13px sans-serif;padding:6px 10px;' +
    'min-height:32px;cursor:pointer;color:#263238;background:rgba(255,255,255,0.9);' +
    'border:1px solid #90a4ae;border-radius:3px;';
  button.addEventListener('click', onToggle);
  const sync = (mode: StyleMode): void => {
    button.setAttribute('aria-pressed', String(mode === 'night'));
    const night = mode === 'night';
    button.style.background = night ? 'rgba(38,50,56,0.92)' : 'rgba(255,255,255,0.9)';
    button.style.color = night ? '#eceff1' : '#263238';
  };
  sync(initial);
  document.body.appendChild(button);
  return { button, sync };
}
