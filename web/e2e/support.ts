import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ConsoleMessage, Page } from '@playwright/test';

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
