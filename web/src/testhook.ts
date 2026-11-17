/**
 * Read-only state exposed to Playwright e2e tests (ADR-0025).
 * Enabled only when the page URL contains `e2e=1`; otherwise `window.__milanoIso` is undefined.
 * Each module registers a getter under its own key; values must be JSON-serialisable.
 */
type Getter = () => unknown;

const getters = new Map<string, Getter>();

export function e2eEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('e2e') === '1';
}

export function registerTestState(key: string, getter: Getter): void {
  getters.set(key, getter);
  if (!e2eEnabled()) return;
  const target = window as unknown as { __milanoIso?: Record<string, unknown> };
  if (!target.__milanoIso) {
    target.__milanoIso = {};
  }
  Object.defineProperty(target.__milanoIso, key, {
    get: () => getters.get(key)?.(),
    enumerable: true,
    configurable: true,
  });
}

/**
 * e2e only (`e2e=1`): exposes `window.__milanoIsoSetView(x, z, width, step?)`; otherwise a no-op.
 * The optional `step` (0..3) sets the rotation step instantly.
 */
export function registerSetView(
  setView: (x: number, z: number, width: number, step?: number) => void,
): void {
  if (!e2eEnabled()) return;
  (window as unknown as { __milanoIsoSetView?: typeof setView }).__milanoIsoSetView = setView;
}
