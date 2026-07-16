import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { JourneyNode } from '@ductus/schema';
import type { GeneratedSegment, GenerateResult, GraphSegment } from '../../src/contracts.js';
import { buildMdxPages, writeMdxPages } from '../../src/output/mdx.js';

const authNodes: JourneyNode[] = [
  {
    id: 'login',
    type: 'screen',
    title: 'Anmeldung',
    source: 'annotation',
    sourceRef: { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
  },
  {
    id: 'dashboard',
    type: 'screen',
    title: 'Dashboard',
    source: 'derived',
    sourceRef: { file: 'lib/router.dart', line: 4 },
  },
  {
    // Duplicate ref for the dedupe test + node without its own line
    id: 'login-again',
    type: 'screen',
    title: 'Anmeldung 2',
    source: 'annotation',
    sourceRef: { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
  },
];

const authSegment: GraphSegment = {
  id: 'auth',
  kind: 'flow',
  title: 'Anmeldung & Registrierung',
  order: 1,
  flow: { id: 'auth', title: 'Anmeldung & Registrierung', start: 'login' },
  nodes: authNodes,
  edges: [{ id: 'e1', from: 'login', to: 'dashboard', trigger: 'tap', source: 'annotation' }],
  exits: [],
};

const miscSegment: GraphSegment = {
  id: '_misc',
  kind: 'misc',
  title: 'Weitere Seiten',
  order: 99,
  nodes: [{ id: 'about', type: 'screen', title: 'Über', source: 'derived' }],
  edges: [],
  exits: [],
};

function makeResult(segments: GeneratedSegment[]): GenerateResult {
  return {
    segments,
    cache: { hits: 0, misses: segments.length },
    usage: { inputTokens: 100, outputTokens: 50 },
    estimated: { inputTokens: 120, outputTokens: 60 },
  };
}

const result = makeResult([
  { segment: miscSegment, markdown: '# Weitere Seiten\n\nText.', fromCache: false, violations: [] },
  { segment: authSegment, markdown: '# Anmeldung\n\nSchritt 1.', fromCache: true, violations: [] },
]);

describe('buildMdxPages', () => {
  it('builds one page per segment, sorted by order', () => {
    const pages = buildMdxPages(result, { diagrams: false, locale: 'en' });
    expect(pages.map((p) => p.fileName)).toEqual(['auth.mdx', 'misc.mdx']);
    expect(pages[0]?.frontmatter.order).toBe(1);
    expect(pages[1]?.frontmatter.order).toBe(99);
  });

  it('sets title and flow (flow only when present)', () => {
    const pages = buildMdxPages(result, { diagrams: false, locale: 'en' });
    const auth = pages.find((p) => p.fileName === 'auth.mdx');
    const misc = pages.find((p) => p.fileName === 'misc.mdx');
    expect(auth?.frontmatter.title).toBe('Anmeldung & Registrierung');
    expect(auth?.frontmatter.flow).toBe('auth');
    expect(misc?.frontmatter.title).toBe('Weitere Seiten');
    expect(misc?.frontmatter).not.toHaveProperty('flow');
  });

  it('deduplicates sourceRefs and sorts by file/line', () => {
    const pages = buildMdxPages(result, { diagrams: false, locale: 'en' });
    const auth = pages.find((p) => p.fileName === 'auth.mdx');
    expect(auth?.frontmatter.sourceRefs).toEqual([
      { file: 'lib/router.dart', line: 4 },
      { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
    ]);
  });

  it('appends a Mermaid section with diagrams: true', () => {
    const [auth] = buildMdxPages(result, { diagrams: true, locale: 'en' });
    expect(auth?.body).toContain('## Flowchart');
    expect(auth?.body).toContain('```mermaid\nflowchart TD');
    expect(auth?.body).toContain('login -->|tap| dashboard');
  });

  it('inserts the "## Main path" section before "## Flowchart" with diagrams: true', () => {
    const [auth] = buildMdxPages(result, { diagrams: true, locale: 'en' });
    expect(auth?.body).toContain('## Main path');
    expect(auth?.body).toContain('```mermaid\njourney');
    expect(auth?.body).toContain('  section Main path');
    expect(auth?.body).toContain('    Anmeldung: 3');
    expect(auth?.body).toContain('    Dashboard: 3');
    expect(auth!.body.indexOf('## Main path')).toBeLessThan(auth!.body.indexOf('## Flowchart'));
  });

  it('creates no main-path section for segments without a main path (misc)', () => {
    const pages = buildMdxPages(result, { diagrams: true, locale: 'en' });
    const misc = pages.find((p) => p.fileName === 'misc.mdx');
    expect(misc?.body).toContain('## Flowchart');
    expect(misc?.body).not.toContain('## Main path');
  });

  it('inserts no main-path section without the diagrams option', () => {
    const [auth] = buildMdxPages(result, { diagrams: false, locale: 'en' });
    expect(auth?.body).not.toContain('## Main path');
    expect(auth?.body).not.toContain('journey');
  });

  it('leaves the body unchanged with diagrams: false', () => {
    const [auth] = buildMdxPages(result, { diagrams: false, locale: 'en' });
    expect(auth?.body).toBe('# Anmeldung\n\nSchritt 1.');
    expect(auth?.body).not.toContain('mermaid');
  });

  it('"_misc" yields "misc.mdx"', () => {
    const pages = buildMdxPages(result, { diagrams: false, locale: 'en' });
    expect(pages.some((p) => p.fileName === 'misc.mdx')).toBe(true);
  });

  // Judge hits ⇒ marks in the output: visible warning flags for the reviewer.
  it('marks pages with faithfulness violations via a warning block before the body', () => {
    const withViolations = makeResult([
      {
        segment: authSegment,
        markdown: '# Anmeldung\n\nSchritt 1.',
        fromCache: false,
        violations: [
          { claim: 'Klicken Sie auf „Passwort vergessen“', reason: 'Kein solcher Schritt im Graph.' },
          { claim: 'Bestätigungs-E-Mail', reason: 'Nicht im Graph belegt.' },
        ],
      },
    ]);
    const [auth] = buildMdxPages(withViolations, { diagrams: false, locale: 'en' });
    expect(auth?.body.startsWith(':::caution[Faithfulness warning]\n')).toBe(true);
    expect(auth?.body).toContain(
      '- Klicken Sie auf „Passwort vergessen“: Kein solcher Schritt im Graph.',
    );
    expect(auth?.body).toContain('- Bestätigungs-E-Mail: Nicht im Graph belegt.');
    // Aside closed, original body unchanged after it.
    expect(auth?.body).toContain(':::\n\n# Anmeldung\n\nSchritt 1.');
  });

  it('also prepends the warning block with diagrams: true (diagram stays at the end)', () => {
    const withViolations = makeResult([
      {
        segment: authSegment,
        markdown: '# Anmeldung\n\nSchritt 1.',
        fromCache: true,
        violations: [{ claim: 'Erfundener Schritt', reason: 'Nicht im Graph.' }],
      },
    ]);
    const [auth] = buildMdxPages(withViolations, { diagrams: true, locale: 'en' });
    expect(auth?.body.startsWith(':::caution[Faithfulness warning]\n')).toBe(true);
    expect(auth?.body.indexOf('## Flowchart')).toBeGreaterThan(
      auth!.body.indexOf('# Anmeldung'),
    );
  });

  it('inserts no warning mark at all without violations', () => {
    const [auth] = buildMdxPages(result, { diagrams: false, locale: 'en' });
    expect(auth?.body).not.toContain(':::caution');
    expect(auth?.body).not.toContain('Faithfulness');
  });

  // German output strings remain a supported feature (locale "de*").
  it('renders German section headings and warning block for locale "de"', () => {
    const withViolations = makeResult([
      {
        segment: authSegment,
        markdown: '# Anmeldung\n\nSchritt 1.',
        fromCache: false,
        violations: [{ claim: 'Erfundener Schritt', reason: 'Nicht im Graph.' }],
      },
    ]);
    const [auth] = buildMdxPages(withViolations, { diagrams: true, locale: 'de-DE' });
    expect(auth?.body.startsWith(':::caution[Faithfulness-Warnung]\n')).toBe(true);
    expect(auth?.body).toContain(
      'Der Faithfulness-Judge hat Aussagen gefunden, die nicht durch den Journey-Graphen gedeckt sind:',
    );
    expect(auth?.body).toContain('## Hauptpfad');
    expect(auth?.body).toContain('  section Hauptpfad');
    expect(auth?.body).toContain('## Ablaufdiagramm');
    expect(auth?.body).not.toContain('## Main path');
  });
});

describe('writeMdxPages', () => {
  it('writes frontmatter as YAML between ---, with LF and a trailing newline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-mdx-'));
    const pages = buildMdxPages(result, { diagrams: false, locale: 'en' });
    const paths = await writeMdxPages(pages, dir);

    expect(paths).toHaveLength(2);
    expect(paths.every((p) => isAbsolute(p))).toBe(true);
    expect(paths).toEqual([...paths].sort());

    const authPath = paths.find((p) => p.endsWith('auth.mdx'));
    const content = readFileSync(authPath!, 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).not.toContain('\r');
    expect(content.endsWith('\n')).toBe(true);

    // Roundtrip: parse the frontmatter again and compare with the page.
    const fmText = content.split('---\n')[1];
    const fm = parse(fmText!);
    expect(fm).toEqual({
      title: 'Anmeldung & Registrierung',
      flow: 'auth',
      order: 1,
      sourceRefs: [
        { file: 'lib/router.dart', line: 4 },
        { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
      ],
    });
    expect(content).toContain('\n\n# Anmeldung\n\nSchritt 1.\n');
  });

  it('creates the target directory (mkdir -p)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-mdx-'));
    const nested = join(dir, 'a', 'b');
    const paths = await writeMdxPages(buildMdxPages(result, { diagrams: false, locale: 'en' }), nested);
    expect(readFileSync(paths[0]!, 'utf8')).toContain('title:');
  });
});
