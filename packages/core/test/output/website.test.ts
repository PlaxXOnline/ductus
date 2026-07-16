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
  it('copies the Starlight preset and writes pages + configuration files', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });

    // Template files copied
    for (const file of [
      'package.json',
      'astro.config.mjs',
      'src/content.config.ts',
      'src/content/docs/index.mdx',
      '.gitignore',
      'README.md',
    ]) {
      expect(existsSync(join(outDir, file)), `${file} missing`).toBe(true);
    }

    // The template ships the .gitignore as "gitignore" (npm always excludes
    // files named .gitignore from the tarball); scaffoldWebsite renames it —
    // the undotted variant must not remain in the result.
    expect(existsSync(join(outDir, 'gitignore'))).toBe(false);

    // Pages under src/content/docs/
    expect(existsSync(join(outDir, 'src/content/docs/auth.mdx'))).toBe(true);
    expect(existsSync(join(outDir, 'src/content/docs/onboarding.mdx'))).toBe(true);

    // Sidebar: sorted by order, links with slugs
    const sidebar = JSON.parse(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8'));
    expect(sidebar).toEqual([
      { label: 'Anmeldung', link: '/auth/' },
      { label: 'Onboarding', link: '/onboarding/' },
    ]);

    // Site configuration
    const site = JSON.parse(readFileSync(join(outDir, 'ductus.site.json'), 'utf8'));
    expect(site).toEqual({ title: 'MyApp', locale: 'de' });

    // JSON artifacts end with a newline (canonical serialization)
    expect(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8').endsWith('\n')).toBe(true);
    expect(readFileSync(join(outDir, 'ductus.site.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('skips node_modules/.astro and overwrites existing files', async () => {
    // Synthetic template with directories that must be skipped
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
    expect(readFileSync(stale, 'utf8')).toBe('{"name":"tpl"}\n'); // overwritten

    const sidebar = JSON.parse(readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8'));
    expect(sidebar).toEqual([]);
  });

  it('is idempotent (a second run yields identical artifacts)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    const first = readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8');
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    const second = readFileSync(join(outDir, 'ductus.sidebar.json'), 'utf8');
    expect(second).toBe(first);
    expect(dirname(join(outDir, 'x'))).toBe(outDir); // path sanity
  });
});

// ─────────────────────── Website generator "journey" ─────────────────────────

/** Minimal but complete data object per the data contract (dataVersion 1). */
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

describe('scaffoldWebsite (generator journey)', () => {
  it('copies the journey template and writes exactly one ductus.data.json — no MDX/sidebar/site files', async () => {
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

    // Template files copied; gitignore → .gitignore renamed.
    for (const file of ['package.json', 'astro.config.mjs', '.gitignore', 'README.md']) {
      expect(existsSync(join(outDir, file)), `${file} missing`).toBe(true);
    }
    expect(existsSync(join(outDir, 'gitignore'))).toBe(false);

    // The data file replaces the template's demo file byte-exactly.
    const written = readFileSync(join(outDir, 'ductus.data.json'), 'utf8');
    expect(written).toBe(serializeJourneyData(journeyData));
    expect(written.endsWith('\n')).toBe(true);

    // NO MDX pages (even though pages were passed) …
    expect(existsSync(join(outDir, 'src', 'content', 'docs'))).toBe(false);
    // … and NO Starlight configuration files.
    expect(existsSync(join(outDir, 'ductus.sidebar.json'))).toBe(false);
    expect(existsSync(join(outDir, 'ductus.site.json'))).toBe(false);
  });

  it('throws without journeyData (programming-error guard)', async () => {
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

  it('is idempotent (a second run yields a byte-identical ductus.data.json, NFR2)', async () => {
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

  it('the default without a generator keeps Starlight semantics (no ductus.data.json)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'ductus-site-'));
    await scaffoldWebsite({ templateDir, outDir, pages, appName: 'MyApp', locale: 'de' });
    expect(existsSync(join(outDir, 'ductus.data.json'))).toBe(false);
    expect(existsSync(join(outDir, 'ductus.sidebar.json'))).toBe(true);
  });
});
