/**
 * Copies all website templates (templates/*) into the package assets so they
 * are included in the published @ductus/core (website mode).
 *
 * Note: the templates' .gitignore is deliberately stored as "gitignore"
 * (without the dot) — npm ALWAYS excludes files named .gitignore from the
 * tarball. scaffoldWebsite renames it back during scaffolding.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = join(pkgDir, '..', '..', 'templates');
const assetsRoot = join(pkgDir, 'assets', 'templates');

if (!existsSync(templatesRoot)) {
  console.warn(`copy-assets: templates directory does not exist yet, skipped (${templatesRoot})`);
  process.exit(0);
}

// Deterministic order (sorted names); only directories count.
const templates = readdirSync(templatesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (templates.length === 0) {
  console.warn(`copy-assets: no templates found, skipped (${templatesRoot})`);
  process.exit(0);
}

// Rebuild the target from scratch — removed templates must not linger as corpses.
rmSync(assetsRoot, { recursive: true, force: true });
mkdirSync(assetsRoot, { recursive: true });

for (const name of templates) {
  const src = join(templatesRoot, name);
  const dest = join(assetsRoot, name);
  cpSync(src, dest, {
    recursive: true,
    // Basename comparison as in scaffoldWebsite — a substring filter would
    // also match *.astro files, not just the .astro/ cache directory.
    filter: (p) => {
      const base = basename(p);
      return base !== 'node_modules' && base !== '.astro';
    },
  });
  console.log(`copy-assets: ${src} → ${dest}`);
}
