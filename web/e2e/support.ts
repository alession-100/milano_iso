import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type ConsoleMessage, type Page, expect } from '@playwright/test';

/** The committed synthetic fixture tileset (ADR-0025); never real data. */
export const FIXTURE_DIR = path.resolve(process.cwd(), 'e2e', 'fixtures', 'tiles');

// Chromium's software GL (SwiftShader) emits a driver "GPU stall due to ReadPixels" warning
// whenever a WebGL canvas is read back for a screenshot (ADR-0012). It is caused by the
// screenshot, not by the app, so exactly that message is ignored.
// T-3.2 deviation, to be ratified in an ADR-0012 addendum: once the page renders real tiles,
// Chromium emits the same message more than 3 times per browser and the last one carries the
// fixed suffix " (this message will no longer repeat)". Only that exact suffix is added.
const SCREENSHOT_NOISE =
  /^\[\.WebGL-[0-9a-fx]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/;

/** Collect console errors and warnings and page errors (ADR-0012 filter only). */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !SCREENSHOT_NOISE.test(m.text())) {
      problems.push(`${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** Serve every `.../tiles/pilot/<file>` request from the fixture directory. */
export async function routeFixtureTiles(page: Page): Promise<void> {
  await page.route('**/tiles/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('/tiles/pilot/')) {
      await route.fallback();
      return;
    }
    const file = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    try {
      const body = readFileSync(path.join(FIXTURE_DIR, file));
      const contentType = file.endsWith('.glb') ? 'model/gltf-binary' : 'application/json';
      await route.fulfill({ status: 200, contentType, body });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
}

/** Ground rectangle of all fixture tile content, computed independently of the app. */
export function fixtureContentBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const m = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'tiles.json'), 'utf-8')) as {
    tiles: { content_bbox_local: { min: number[]; max: number[] } }[];
  };
  const xs = m.tiles.flatMap((t) => [t.content_bbox_local.min[0], t.content_bbox_local.max[0]]);
  const zs = m.tiles.flatMap((t) => [t.content_bbox_local.min[2], t.content_bbox_local.max[2]]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

export function readFixtureManifest(): { tiles: { id: string }[]; attribution: { text: string }[] } {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'tiles.json'), 'utf-8'));
}

// --- Settle helpers (T-5.4) ---------------------------------------------------------------------
//
// NO WALL-CLOCK THRESHOLDS IN E2E. A test never asserts "within N ms" and never reads render or tile
// state one frame after an action. It polls the test state until it has settled (these helpers), then
// reads it. Timing is recorded by the app (e.g. `selection.pick`) and judged in unit tests or by hand,
// never by an e2e assertion: a loaded CI machine or a parallel worker turns any such limit into a flake
// (T-5.1 review, about 1 failure in 300 runs).

export interface TilesState {
  loaded: number;
  loading: number;
  visible: number;
  failed: number;
}

type MilanoWindow = {
  __milanoIso: { tiles: TilesState; render: { calls: number; triangles: number } } & Record<string, unknown>;
  __milanoIsoSetView?: (x: number, z: number, width: number, step?: number) => void;
};

export const tilesState = (page: Page): Promise<TilesState> =>
  page.evaluate(() => ({ ...(window as unknown as MilanoWindow).__milanoIso.tiles }));

/** The app is up: the test hooks exist and the camera bounds come from the manifest (not the 500 m fallback). */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as MilanoWindow & { __milanoIso?: { camera?: { bounds?: { maxX: number } } } };
    return typeof w.__milanoIsoSetView === 'function' && (w.__milanoIso?.camera?.bounds?.maxX ?? 500) !== 500;
  });
}

/** Every tile the view needs is loaded (or has failed for good) and nothing is in flight. */
export async function settleTiles(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await tilesState(page);
        return s.visible > 0 && s.loading === 0 && s.loaded + s.failed >= s.visible;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Two animation frames have run in the page, so the last change is on the canvas. */
export function frameRendered(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * Tiles settled AND rendered: the tile counts are final and the draw-call count is the same on
 * `polls` consecutive polls (each taken after two frames), so the value read next is the settled one.
 * Returns that draw-call count.
 */
export async function settleRendered(page: Page, polls = 3): Promise<number> {
  await settleTiles(page);
  let prev = -1;
  let same = 0;
  await expect
    .poll(
      async () => {
        await frameRendered(page);
        const st = await page.evaluate(() => {
          const w = (window as unknown as MilanoWindow).__milanoIso;
          return {
            calls: w.render.calls,
            loading: w.tiles.loading,
            ok: w.tiles.visible > 0 && w.tiles.loaded + w.tiles.failed >= w.tiles.visible,
          };
        });
        same = st.calls === prev && st.calls > 1 && st.ok && st.loading === 0 ? same + 1 : 0;
        prev = st.calls;
        return same >= polls;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return prev;
}

/** Draw calls that stay equal for `polls` polls in a row (no tile wait: for a change that only re-renders). */
export async function stableCalls(page: Page, polls = 3): Promise<number> {
  let last = -1;
  let same = 0;
  await expect
    .poll(
      async () => {
        await frameRendered(page);
        const c = await page.evaluate(() => (window as unknown as MilanoWindow).__milanoIso.render.calls);
        same = c === last ? same + 1 : 0;
        last = c;
        return same >= polls;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return last;
}

/** e2e-only camera setter (testhook.ts), once the app is up. */
export async function setView(page: Page, x: number, z: number, width: number, step?: number): Promise<void> {
  await waitForApp(page);
  await page.evaluate(
    ([a, b, c, d]) => (window as unknown as MilanoWindow).__milanoIsoSetView?.(a, b, c, d),
    [x, z, width, step] as [number, number, number, number | undefined],
  );
}
