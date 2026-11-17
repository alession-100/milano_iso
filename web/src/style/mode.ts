import type { StyleMode } from './palette';

/** localStorage key of the remembered day/night choice. */
export const MODE_STORAGE_KEY = 'milano-iso.time';

function asMode(v: string | null | undefined): StyleMode | null {
  return v === 'day' || v === 'night' ? v : null;
}

/** `?time=night` or `?time=day`; anything else (or absent) is null. */
export function parseTime(search: string): StyleMode | null {
  return asMode(new URLSearchParams(search).get('time'));
}

export function readStoredMode(): StyleMode | null {
  try {
    return asMode(window.localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return null; // storage blocked (private mode, sandbox): not an error
  }
}

export function storeMode(mode: StyleMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // storage blocked: the choice is simply not remembered
  }
}

/** Initial mode: the URL wins, then the remembered choice, then day. */
export function initialMode(search: string): StyleMode {
  return parseTime(search) ?? readStoredMode() ?? 'day';
}
