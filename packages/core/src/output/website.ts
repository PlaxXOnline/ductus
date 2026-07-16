/**
 * Website mode: copy the template into the output directory (output.dir = root
 * of the SSG project) and fill it with data — depending on the generator:
 * - "starlight": write MDX pages to src/content/docs/ and generate the
 *   sidebar/site configuration (ductus.sidebar.json/ductus.site.json).
 * - "journey" (default): write exactly one ductus.data.json into the site
 *   root — NO MDX files, NO sidebar/site files; the template reads the data
 *   at build time.
 * The SSG itself is a peer dependency of the user — installing/building only
 * happens on explicit request via `ductus generate --build` (buildWebsite, below).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { JourneyWebsiteData, MdxPage, WebsiteGenerator } from '../contracts.js';
import { serializeJourneyData } from './journey-data.js';
import { writeMdxPages } from './mdx.js';

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ScaffoldWebsiteOptions {
  /** Source directory of the template (preset or custom via output.website.template). */
  templateDir: string;
  /** Root of the SSG project (output.dir in website mode). */
  outDir: string;
  pages: MdxPage[];
  appName: string;
  locale: string;
  /** Website generator; default 'starlight' (API-compatible with phase-1 callers). */
  generator?: WebsiteGenerator;
  /** Required in journey mode: complete data object for ductus.data.json. */
  journeyData?: JourneyWebsiteData;
}

export async function scaffoldWebsite(opts: ScaffoldWebsiteOptions): Promise<void> {
  const { templateDir, outDir, pages, appName, locale } = opts;
  const generator = opts.generator ?? 'starlight';

  // Copy the template recursively; skip the template's build artifacts,
  // overwrite existing files in the target (idempotent re-run).
  await cp(templateDir, outDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = basename(src);
      return base !== 'node_modules' && base !== '.astro';
    },
  });

  // npm ALWAYS excludes files named ".gitignore" from the published tarball
  // (the files field cannot override that). The template therefore ships the
  // file as "gitignore" — it is renamed back here.
  const undottedGitignore = join(outDir, 'gitignore');
  if (existsSync(undottedGitignore)) {
    await rename(undottedGitignore, join(outDir, '.gitignore'));
  }

  // journey mode: the only data file is ductus.data.json — then we are done.
  if (generator === 'journey') {
    if (opts.journeyData === undefined) {
      throw new Error('scaffoldWebsite: generator "journey" requires journeyData (ductus.data.json).');
    }
    await writeFile(join(outDir, 'ductus.data.json'), serializeJourneyData(opts.journeyData), 'utf8');
    return;
  }

  await writeMdxPages(pages, join(outDir, 'src', 'content', 'docs'));

  // Sidebar: sorted by order (file name as deterministic tie-breaker).
  const sidebar = [...pages]
    .sort((a, b) => a.frontmatter.order - b.frontmatter.order || cmp(a.fileName, b.fileName))
    .map((page) => ({
      label: page.frontmatter.title,
      link: `/${page.fileName.replace(/\.mdx$/, '')}/`,
    }));
  await writeFile(
    join(outDir, 'ductus.sidebar.json'),
    `${JSON.stringify(sidebar, null, 2)}\n`,
    'utf8',
  );

  await writeFile(
    join(outDir, 'ductus.site.json'),
    `${JSON.stringify({ locale, title: appName }, null, 2)}\n`,
    'utf8',
  );
}

// ─────────────────────── Website build (`generate --build`) ──────────────────

/** Error during the website build (npm missing / step failed) ⇒ exit code 3. */
export class WebsiteBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebsiteBuildError';
  }
}

/**
 * Minimal spawn signature — injectable for tests so they do NOT need a real
 * npm (pattern like DartResolutionOptions in adapters/runner.ts).
 */
export type WebsiteBuildSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: ['ignore', 'inherit', 'inherit'] },
) => {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

export interface BuildWebsiteOptions {
  /** Root of the SSG project (output.dir in website mode), absolute. */
  siteDir: string;
  /** Injectable spawn for tests (default: node:child_process.spawn). */
  spawn?: WebsiteBuildSpawn;
  /** Progress messages (belong on stderr). */
  log?: (message: string) => void;
}

/**
 * Runs one npm step in the site directory. stdout/stderr are inherited from
 * the parent process — the user sees npm's progress unchanged (NFR4: Ductus
 * itself logs nothing here, hence no keys either).
 */
function runNpmStep(spawnFn: WebsiteBuildSpawn, args: string[], siteDir: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    // Spawn npm directly — no shell:true needed; on win32 "npm.cmd" would be
    // required, but the target platforms are darwin/linux.
    const child = spawnFn('npm', args, { cwd: siteDir, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        rejectPromise(
          new WebsiteBuildError(
            'Website build: command "npm" not found — please install Node.js/npm or check your PATH.',
          ),
        );
        return;
      }
      rejectPromise(
        new WebsiteBuildError(`Website build: unable to run "npm ${args.join(' ')}" (${error.message}).`),
      );
    });
    child.on('close', (code, signal) => {
      if (signal !== null) {
        rejectPromise(
          new WebsiteBuildError(`Website build: "npm ${args.join(' ')}" aborted (signal ${signal}).`),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new WebsiteBuildError(`Website build: "npm ${args.join(' ')}" failed with exit code ${code ?? '?'}.`),
        );
        return;
      }
      resolvePromise();
    });
  });
}

/**
 * Builds the exported website: `npm ci` when a package-lock.json is present,
 * otherwise `npm install`; then `npm run build` — both with cwd = site
 * directory. Returns the path of the build output (<siteDir>/dist).
 */
export async function buildWebsite(opts: BuildWebsiteOptions): Promise<string> {
  const spawnFn = opts.spawn ?? nodeSpawn;
  const installArgs = existsSync(join(opts.siteDir, 'package-lock.json')) ? ['ci'] : ['install'];
  for (const args of [installArgs, ['run', 'build']]) {
    opts.log?.(`Website build: npm ${args.join(' ')} (in ${opts.siteDir}) …`);
    await runNpmStep(spawnFn, args, opts.siteDir);
  }
  return join(opts.siteDir, 'dist');
}
