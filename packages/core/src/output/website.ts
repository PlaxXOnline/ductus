/**
 * Website-Modus (§9.2, DD §B.7): Starlight-Preset in das Ausgabeverzeichnis kopieren,
 * MDX-Seiten nach src/content/docs/ schreiben und Sidebar-/Site-Konfiguration erzeugen.
 * Der SSG selbst ist Peer-Dependency des Nutzers — installiert/gebaut wird nur auf
 * ausdrücklichen Wunsch via `ductus generate --build` (buildWebsite, DD §M).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { MdxPage } from '../contracts.js';
import { writeMdxPages } from './mdx.js';

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ScaffoldWebsiteOptions {
  /** Quellverzeichnis des Templates (Preset oder eigenes via output.website.template). */
  templateDir: string;
  /** Wurzel des SSG-Projekts (output.dir im Website-Modus). */
  outDir: string;
  pages: MdxPage[];
  appName: string;
  locale: string;
}

export async function scaffoldWebsite(opts: ScaffoldWebsiteOptions): Promise<void> {
  const { templateDir, outDir, pages, appName, locale } = opts;

  // Template rekursiv kopieren; Build-Artefakte des Templates auslassen,
  // vorhandene Dateien im Ziel überschreiben (idempotenter Re-Run).
  await cp(templateDir, outDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = basename(src);
      return base !== 'node_modules' && base !== '.astro';
    },
  });

  // npm schließt Dateien namens ".gitignore" beim Publish IMMER aus dem Tarball
  // aus (das files-Feld kann das nicht überschreiben). Das Template führt die
  // Datei deshalb als "gitignore" — hier wird sie zurückbenannt.
  const undottedGitignore = join(outDir, 'gitignore');
  if (existsSync(undottedGitignore)) {
    await rename(undottedGitignore, join(outDir, '.gitignore'));
  }

  await writeMdxPages(pages, join(outDir, 'src', 'content', 'docs'));

  // Sidebar: nach order sortiert (Dateiname als deterministischer Tie-Breaker).
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

// ─────────────────────── Website-Build (`generate --build`, DD §M) ───────────

/** Fehler beim Website-Build (npm fehlt / Schritt gescheitert) ⇒ Exit-Code 3 (DD §I). */
export class WebsiteBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebsiteBuildError';
  }
}

/**
 * Minimale spawn-Signatur — testbar injizierbar, damit Tests KEIN echtes npm
 * brauchen (Muster wie DartResolutionOptions in adapters/runner.ts).
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
  /** Wurzel des SSG-Projekts (output.dir im Website-Modus), absolut. */
  siteDir: string;
  /** Injizierbares spawn für Tests (Default: node:child_process.spawn). */
  spawn?: WebsiteBuildSpawn;
  /** Fortschrittsmeldungen (gehören auf stderr). */
  log?: (message: string) => void;
}

/**
 * Führt einen npm-Schritt im Site-Verzeichnis aus. stdout/stderr erben vom
 * Elternprozess — der Nutzer sieht den npm-Fortschritt unverändert (NFR4:
 * Ductus selbst loggt hier nichts, also auch keine Keys).
 */
function runNpmStep(spawnFn: WebsiteBuildSpawn, args: string[], siteDir: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    // npm direkt spawnen — kein shell:true nötig; unter win32 wäre "npm.cmd"
    // erforderlich, Zielplattformen sind aber darwin/linux.
    const child = spawnFn('npm', args, { cwd: siteDir, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        rejectPromise(
          new WebsiteBuildError(
            'Website-Build: Befehl "npm" nicht gefunden — bitte Node.js/npm installieren bzw. den PATH prüfen.',
          ),
        );
        return;
      }
      rejectPromise(
        new WebsiteBuildError(`Website-Build: "npm ${args.join(' ')}" nicht ausführbar (${error.message}).`),
      );
    });
    child.on('close', (code, signal) => {
      if (signal !== null) {
        rejectPromise(
          new WebsiteBuildError(`Website-Build: "npm ${args.join(' ')}" abgebrochen (Signal ${signal}).`),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new WebsiteBuildError(`Website-Build: "npm ${args.join(' ')}" scheiterte mit Exit-Code ${code ?? '?'}.`),
        );
        return;
      }
      resolvePromise();
    });
  });
}

/**
 * Baut die exportierte Website (DD §M): `npm ci` bei vorhandener
 * package-lock.json, sonst `npm install`; danach `npm run build` — beides mit
 * cwd = Site-Verzeichnis. Liefert den Pfad des Build-Outputs (<siteDir>/dist).
 */
export async function buildWebsite(opts: BuildWebsiteOptions): Promise<string> {
  const spawnFn = opts.spawn ?? nodeSpawn;
  const installArgs = existsSync(join(opts.siteDir, 'package-lock.json')) ? ['ci'] : ['install'];
  for (const args of [installArgs, ['run', 'build']]) {
    opts.log?.(`Website-Build: npm ${args.join(' ')} (in ${opts.siteDir}) …`);
    await runNpmStep(spawnFn, args, opts.siteDir);
  }
  return join(opts.siteDir, 'dist');
}
