import { defineConfig } from '@playwright/test';

// E2E_PORT lets parallel worktrees run e2e without colliding (default 4173).
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  // Baselines are platform-specific (software GL differs per OS): the platform is in the name.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}',
  expect: {
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
