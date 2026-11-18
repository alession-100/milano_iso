import { mountBeforeAttribution } from './dom';
import { onLangChange, t } from './i18n';
import type { StyleMode } from './style/palette';

export interface ModeToggle {
  button: HTMLButtonElement;
  /** Reflects the current mode in `aria-pressed` (pressed = night). */
  sync: (mode: StyleMode) => void;
}

/**
 * Day/night button, top right. It is a native button, so Tab, Enter and Space work. Its look
 * (44 px target, day and night colours, focus ring) is the shared `.tb-btn` style in index.html.
 */
export function createModeToggle(initial: StyleMode, onToggle: () => void): ModeToggle {
  const button = document.createElement('button');
  button.id = 'mode-toggle';
  button.className = 'tb-btn';
  button.type = 'button';
  const label = (): void => {
    button.textContent = t('nightMode');
  };
  label();
  onLangChange(label);
  button.addEventListener('click', onToggle);
  const sync = (mode: StyleMode): void => {
    button.setAttribute('aria-pressed', String(mode === 'night'));
  };
  sync(initial);
  mountBeforeAttribution(button);
  return { button, sync };
}
