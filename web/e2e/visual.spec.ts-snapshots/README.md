# Visual-regression baselines (T-3.6)

Candidate baselines from the synthetic fixture tileset (`e2e/fixtures/tiles`), captured under `?e2e=1` (no MSAA, ADR-0027), reduced motion, 3 views (default, close, wide) at 1280x720 and 412x915. Threshold: `maxDiffPixelRatio` 0.01 in `playwright.config.ts`.

Owner approval: the owner approved these baselines on PENDING (the orchestrator fills in the date after the checkpoint).

Files are named `<view>-<size>-<platform>.png`. Only the `win32` baselines exist so far.

Linux baselines (needed for CI, where the visual test is skipped until they exist): on a Linux machine with the repo and `npm --prefix web ci` done, run

    npm --prefix web run build
    cd web && npx playwright test e2e/visual.spec.ts --update-snapshots

commit the new `*-linux.png` files, review them, and remove the `test.skip(!!process.env.CI, ...)` line in `e2e/visual.spec.ts`.
