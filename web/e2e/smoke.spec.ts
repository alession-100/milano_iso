import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type ConsoleMessage, expect, test } from '@playwright/test';

const OUT = path.resolve(process.cwd(), '..', 'reports', 'artifacts', 'T-0.2');
const ELEVATIONS = ['30', '35.264'];

test('renders a canvas with no console errors or warnings, at both elevations', async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const problems: string[] = [];
  // Chromium's software GL (SwiftShader) emits a driver "GPU stall due to ReadPixels" warning
  // whenever a WebGL canvas is read back for a screenshot. It is caused by the screenshot, not
  // by the app, so exactly that message is ignored; every other warning or error fails the test.
  const screenshotNoise = /GPU stall due to ReadPixels/;
  page.on('console', (m: ConsoleMessage) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !screenshotNoise.test(m.text())) {
      problems.push(`${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`));

  for (const elev of ELEVATIONS) {
    await page.goto(`/?elev=${elev}`);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('#attribution')).not.toBeEmpty();
    await page.screenshot({ path: path.join(OUT, `elev-${elev}.png`) });
  }
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('compose side-by-side.png from the two screenshots', async ({ page }) => {
  const figures = ELEVATIONS.map((elev) => {
    const b64 = readFileSync(path.join(OUT, `elev-${elev}.png`)).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>elevation ${elev}&deg;</figcaption></figure>`;
  }).join('');
  await page.setViewportSize({ width: 2580, height: 780 });
  await page.setContent(
    `<style>body{margin:10px;display:flex;gap:20px;background:#fff;font:bold 28px sans-serif}
    figure{margin:0}img{width:1280px;height:720px;display:block}figcaption{padding:6px 0}</style>${figures}`,
  );
  await page.locator('img').last().evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: path.join(OUT, 'side-by-side.png') });
});
