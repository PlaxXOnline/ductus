/**
 * Kopiert alle Website-Templates (templates/*) in die Paket-Assets,
 * damit sie im publizierten @ductus/core enthalten sind (Website-Modus).
 *
 * Hinweis: Die .gitignore der Templates liegt bewusst als "gitignore" (ohne
 * Punkt) vor — npm schließt Dateien namens .gitignore IMMER vom Tarball aus.
 * scaffoldWebsite benennt sie beim Scaffolding zurück.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = join(pkgDir, '..', '..', 'templates');
const assetsRoot = join(pkgDir, 'assets', 'templates');

if (!existsSync(templatesRoot)) {
  console.warn(`copy-assets: Template-Verzeichnis fehlt noch, übersprungen (${templatesRoot})`);
  process.exit(0);
}

// Deterministische Reihenfolge (sortierte Namen); nur Verzeichnisse zählen.
const templates = readdirSync(templatesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (templates.length === 0) {
  console.warn(`copy-assets: keine Templates gefunden, übersprungen (${templatesRoot})`);
  process.exit(0);
}

// Ziel komplett neu aufbauen — entfernte Templates bleiben nicht als Leichen liegen.
rmSync(assetsRoot, { recursive: true, force: true });
mkdirSync(assetsRoot, { recursive: true });

for (const name of templates) {
  const src = join(templatesRoot, name);
  const dest = join(assetsRoot, name);
  cpSync(src, dest, {
    recursive: true,
    // Basename-Vergleich wie in scaffoldWebsite — ein Substring-Filter würde
    // auch *.astro-Dateien treffen, nicht nur das .astro/-Cache-Verzeichnis.
    filter: (p) => {
      const base = basename(p);
      return base !== 'node_modules' && base !== '.astro';
    },
  });
  console.log(`copy-assets: ${src} → ${dest}`);
}
