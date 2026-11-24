import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** "<short hash> <commit date>" of HEAD, with "+local" when the working tree has changes (T-7.2). */
function buildId(): string {
  try {
    const run = (args: string[]): string => execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const id = run(['log', '-1', '--format=%h %cs']);
    return run(['status', '--porcelain']) === '' ? id : `${id}+local`;
  } catch {
    return 'unknown'; // no git, or not a checkout: the About panel says so
  }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
});
