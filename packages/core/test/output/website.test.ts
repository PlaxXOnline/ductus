import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JourneyWebsiteData, MdxPage } from '../../src/contracts.js';
import { serializeJourneyData } from '../../src/output/journey-data.js';
import { scaffoldWebsite } from '../../src/output/website.js';

const templateDir = fileURLToPath(new URL('../../../../templates/starlight', import.meta.url));
const journeyTemplateDir = fileURLToPath(new URL('../../../../templates/journey', import.meta.url));

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

// ─────────────────────── Website-Generator "journey" (DD §O) ─────────────────

/** Minimales, aber vollständiges Datenobjekt gemäß Datenvertrag (dataVersion 1). */
const journeyData: JourneyWebsiteData = {
  dataVersion: '1',
  site: {
    title: 'MyApp',
    locale: 'de',
    ductusVersion: '0.1.0',
    adapters: [{ name: 'fake', version: '1.0.0' }],
    violationsTotal: 0,
  },
  journeys: [
    {
      id: 'auth',
      slug: 'auth',
      kind: 'flow',
      order: 1,
      title: 'Anmeldung',
      description: '',
      startNodeId: 'login',
      nodes: [
        { id: 'login', type: 'screen', title: 'Login', description: '', start: true, sourceRef: null },
      ],
      edges: [],
      mainPath: [],
      markdown: '# Anmeldung\n',
      violations: [],
    },
  ],
};

describe('scaffoldWebsite (generator journey, DD §O)', () => {
  it('kopiert das journey-Template und schreibt genau eine ductus.data.json — keine MDX/Sidebar/Site-Dateien', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({
      templateDir: journeyTemplateDir,
      outDir,
      pages,
      appName: 'MyApp',
      locale: 'de',
      generator: 'journey',
      journeyData,
    });

    // Templatedateien kopiert; gitignore → .gitignore umbenannt.
    for (const file of ['package.json', 'astro.config.mjs', '.gitignore', 'README.md']) {
      expect(existsSync(join(outDir, file)), `${file} fehlt`).toBe(true);
    }
    expect(existsSync(join(outDir, 'gitignore'))).toBe(false);

    // Die Daten-Datei ersetzt die Demo-Datei des Templates byte-genau.
    const written = readFileSync(join(outDir, 'ductus.data.json'), 'utf8');
    expect(written).toBe(serializeJourneyData(journeyData));
    expect(written.endsWith('\n')).toBe(true);

    // KEINE MDX-Seiten (obwohl pages übergeben wurden) …
    expect(existsSync(join(outDir, 'src', 'content', 'docs'))).toBe(false);
    // … und KEINE Starlight-Konfigurationsdateien.
    expect(existsSync(join(outDir, 'ductus.sidebar.json'))).toBe(false);
    expect(existsSync(join(outDir, 'ductus.site.json'))).toBe(false);
  });

  it('wirft ohne journeyData einen Fehler (Programmierfehler-Guard)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await expect(
      scaffoldWebsite({
        templateDir: journeyTemplateDir,
        outDir,
        pages: [],
        appName: 'MyApp',
        locale: 'de',
        generator: 'journey',
      }),
    ).rejects.toThrowError(/journeyData/);
  });

  it('ist idempotent (zweiter Lauf liefert byte-identische ductus.data.json, NFR2)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    const opts = {
      templateDir: journeyTemplateDir,
      outDir,
      pages: [],
      appName: 'MyApp',
      locale: 'de',
      generator: 'journey' as const,
      journeyData,
    };
    await scaffoldWebsite(opts);
    const first = readFileSync(join(outDir, 'ductus.data.json'), 'utf8');
    await scaffoldWebsite(opts);
    expect(readFileSync(join(outDir, 'ductus.data.json'), 'utf8')).toBe(first);
  });

  it('Default ohne generator bleibt Starlight-Semantik (keine ductus.data.json)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    expect(existsSync(join(outDir, 'ductus.data.json'))).toBe(false);
    expect(existsSync(join(outDir, 'ductus.sidebar.json'))).toBe(true);
  });
});
