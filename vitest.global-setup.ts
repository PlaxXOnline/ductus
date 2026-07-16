/**
 * Vitest global setup: builds all workspaces exactly once per vitest
 * invocation — in the main process, before any test file runs.
 *
 * Mechanism: the CLI/E2E test files run against dist/ (bin contract) and
 * previously each ran `npm run build` in their own beforeAll. In a full
 * `vitest run` those builds execute in parallel workers and race over the
 * same dist/ directories (sporadic failures); building here removes the
 * race while single-file runs still get a fresh dist. A cheap mtime check
 * skips the build when dist/ is already up to date (e.g. in CI, where
 * `npm run build` runs before vitest anyway).
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

interface Workspace {
  /** Workspace name for the log line. */
  name: string;
  /** Build inputs (files or directories, scanned recursively). */
  inputs: string[];
  /** Build output directory — its newest file marks the last build. */
  dist: string;
  /** Entry file that must exist for the workspace to count as built. */
  entry: string;
}

function workspace(name: string, entryFile: string, extraInputs: string[] = []): Workspace {
  const dir = join(ROOT, 'packages', name);
  return {
    name,
    inputs: [join(dir, 'src'), join(dir, 'tsconfig.json'), join(dir, 'package.json'), ...extraInputs],
    dist: join(dir, 'dist'),
    entry: join(dir, 'dist', entryFile),
  };
}

const WORKSPACES: Workspace[] = [
  workspace('schema', 'index.js'),
  // The core build also mirrors templates/ into assets/ (copy-assets.mjs).
  workspace('core', 'cli.js', [join(ROOT, 'templates'), join(ROOT, 'packages', 'core', 'scripts', 'copy-assets.mjs')]),
  workspace('adapter-typescript', 'cli.js'),
];

/** Newest file mtime under a path (file or directory); -Infinity if missing. */
function newestFileMtime(path: string): number {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return Number.NEGATIVE_INFINITY;
  if (stat.isFile()) return stat.mtimeMs;
  let newest = Number.NEGATIVE_INFINITY;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    const mtime = entry.isDirectory()
      ? newestFileMtime(childPath)
      : entry.isFile()
        ? statSync(childPath).mtimeMs
        : Number.NEGATIVE_INFINITY;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function isStale(ws: Workspace): boolean {
  if (!existsSync(ws.entry)) return true;
  const builtAt = newestFileMtime(ws.dist);
  const changedAt = Math.max(...ws.inputs.map(newestFileMtime));
  return changedAt > builtAt;
}

export default function globalSetup(): void {
  const stale = WORKSPACES.filter(isStale);
  if (stale.length === 0) return;
  console.log(`[vitest global setup] dist stale (${stale.map((ws) => ws.name).join(', ')}) — running npm run build …`);
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit', timeout: 300_000 });
}
