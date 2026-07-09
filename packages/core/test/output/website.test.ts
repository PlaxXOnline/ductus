import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MdxPage } from '../../src/contracts.js';
import { scaffoldWebsite } from '../../src/output/website.js';

const templateDir = fileURLToPath(new URL('../../../../templates/starlight', import.meta.url));

const pages: MdxPage[] = [
  {
    fileName: 'onboarding.mdx',
    frontmatter: { title: 'Onboarding', flow: 'onboarding', order: 2, sourceRefs: [] },
    body: '# Onboarding\n',
  },
  {
    fileName: 'auth.mdx',
    frontmatter: { title: 'Anmeldung', flow: 'auth', order: 1, sourceRefs: [] },
    body: '# Anmeldung\n',
  },
];

describe('scaffoldWebsite', () => {
  it('kopiert das Starlight-Preset und schreibt Seiten + Konfigurationsdateien', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });

    // Templatedateien kopiert
    for (const file of [
      'package.json',
      'astro.config.mjs',
      'src/content.config.ts',
      'src/content/docs/index.mdx',
      '.gitignore',
      'README.md',
    ]) {
      expect(existsSync(join(outDir, file)), `${file} fehlt`).toBe(true);
    }

    // Das Template führt die .gitignore als "gitignore" (npm schließt Dateien
    // namens .gitignore immer vom Tarball aus); scaffoldWebsite benennt sie um —
    // die undotted Variante darf im Ergebnis nicht zurückbleiben.
    expect(existsSync(join(outDir, 'gitignore'))).toBe(false);

    // Seiten unter src/content/docs/
    expect(existsSync(join(outDir, 'src/content/docs/auth.mdx'))).toBe(true);
    expect(existsSync(join(outDir, 'src/content/docs/onboarding.mdx'))).toBe(true);

    // Sidebar: nach order sortiert, Links mit Slug
    const sidebar = JSON.parse(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8'));
    expect(sidebar).toEqual([
      { label: 'Anmeldung', link: '/auth/' },
      { label: 'Onboarding', link: '/onboarding/' },
    ]);

    // Site-Konfiguration
    const site = JSON.parse(readFileSync(join(outDir, 'ductus.site.json'), 'utf8'));
    expect(site).toEqual({ title: 'MyApp', locale: 'de' });

    // JSON-Artefakte enden mit Newline (kanonische Serialisierung)
    expect(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8').endsWith('\n')).toBe(true);
    expect(readFileSync(join(outDir, 'ductus.site.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('lässt node_modules/.astro aus und überschreibt vorhandene Dateien', async () => {
    // Synthetisches Template mit auszulassenden Verzeichnissen
    const synthTemplate = mkdtempSync(join(tmpdir(), 'ductus-tpl-'));
    writeFileSync(join(synthTemplate, 'package.json'), '{"name":"tpl"}\n');
    mkdirSync(join(synthTemplate, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(synthTemplate, 'node_modules', 'x', 'skip.txt'), 'skip');
    mkdirSync(join(synthTemplate, '.astro'), { recursive: true });
    writeFileSync(join(synthTemplate, '.astro', 'skip.txt'), 'skip');

    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    const stale = join(outDir, 'package.json');
    writeFileSync(stale, '{"name":"alt"}\n');

    await scaffoldWebsite({
      templateDir: synthTemplate,
      outDir,
      pages: [],
      appName: 'App',
      locale: 'en',
    });

    expect(existsSync(join(outDir, 'node_modules'))).toBe(false);
    expect(existsSync(join(outDir, '.astro'))).toBe(false);
    expect(readFileSync(stale, 'utf8')).toBe('{"name":"tpl"}\n'); // überschrieben

    const sidebar = JSON.parse(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8'));
    expect(sidebar).toEqual([]);
  });

  it('ist idempotent (zweiter Lauf liefert identische Artefakte)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    const first = readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8');
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    const second = readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8');
    expect(second).toBe(first);
    expect(dirname(join(outDir, 'x'))).toBe(outDir); // Pfad-Sanity
  });
});
