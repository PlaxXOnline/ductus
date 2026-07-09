/**
 * Kopiert das Website-Template (templates/starlight) in die Paket-Assets,
 * damit es im publizierten @ductus/core enthalten ist (§9.2).
 *
 * Hinweis: Die .gitignore des Templates liegt bewusst als "gitignore" (ohne
 * Punkt) vor — npm schließt Dateien namens .gitignore IMMER vom Tarball aus.
 * scaffoldWebsite benennt sie beim Scaffolding zurück.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(pkgDir, '..', '..', 'templates', 'starlight');
const dest = join(pkgDir, 'assets', 'templates', 'starlight');

if (!existsSync(src)) {
  console.warn(`copy-assets: Template fehlt noch, übersprungen (${src})`);
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.includes('node_modules') && !p.includes('.astro'),
});
console.log(`copy-assets: ${src} → ${dest}`);
