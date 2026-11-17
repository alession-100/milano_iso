import { defineConfig } from '@playwright/test';

// E2E_PORT lets parallel worktrees run e2e without colliding (default 4173).
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  // Safety nets, not assertions (T-5.4): software GL with ten workers, and ten copies of the same test at
  // once under --repeat-each, can starve a page for tens of seconds. A test that waits for state polls
  // until it settles; these limits only stop a test that never settles. No test asserts a duration.
  timeout: 90_000,
  // Baselines are platform-specific (software GL differs per OS): the platform is in the name.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}',
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      // Stored visual-regression threshold (VERIFICATION section 4), see R-3.6 for the measurement.
      // Explicit per-pixel colour threshold (Playwright default 0.2 hides a 16-level shift, T-3.7).
      threshold: 0.02,
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 720 },
    browserName: 'chromium',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
