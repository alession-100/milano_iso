# Visual-regression baselines (T-3.6, tightened in T-3.7)

Baselines from the synthetic fixture tileset (`e2e/fixtures/tiles`), captured under `?e2e=1` (no MSAA, ADR-0027), reduced motion, 4 views (default, close, wide, west) at 1280x720 and 412x915. The fixture holds one building per palette colour group (residential, commercial, civic, industrial, other, landmark) and every flat layer. Thresholds in `playwright.config.ts`: per-pixel `threshold` 0.02 and `maxDiffPixelRatio` 0.001.

Owner approval: The owner approved palette v1 on 2026-11-17 (Phase 3 checkpoint); baselines regenerated in T-3.7. The owner approved the Phase 4 look (day and night, trees, markings, landmark details) as is on 2026-11-17 (Phase 4 checkpoint); win32 baselines as of T-4.2.

Files are named `<view>-<size>-<platform>.png`. Both `win32` (local) and `linux` (CI) baselines are committed. When the fixture, the palette or a view changes, delete the old PNGs before `--update-snapshots`: Playwright keeps an existing baseline that is within the threshold, which would leave it stale.

## Regenerating the Linux baselines (used by CI)

1. In GitHub, run the manual workflow `visual-baselines` (Actions tab, "Run workflow") on the branch to baseline.
2. Download the artifact `visual-baselines-linux` from the finished run (it holds the `*-linux.png` files).
3. Copy the PNGs into this directory, review them, and commit them.

The workflow never pushes commits. The first Linux baselines came from the workflow run of 2026-11-17 (owner-run) and the CI skip was removed then.

## T-4.3 (day/night)

The page now shows the day/night toggle (top right), so every day baseline changed, and `night-default` and `night-close` candidates (`?time=night`) were added, at both sizes. The `win32` files were regenerated in T-4.3 after deleting the old ones. The `*-linux.png` files are stale (and the night ones missing) until they are regenerated with the workflow above; the night look was approved at the Phase 4 checkpoint.
