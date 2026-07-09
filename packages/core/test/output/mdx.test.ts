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
    // Duplikat-Ref zum Dedupe-Test + Node ohne eigene Zeile
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
  it('baut je Segment eine Seite, sortiert nach order', () => {
    const pages = buildMdxPages(result, { diagrams: false });
    expect(pages.map((p) => p.fileName)).toEqual(['auth.mdx', 'misc.mdx']);
    expect(pages[0]?.frontmatter.order).toBe(1);
    expect(pages[1]?.frontmatter.order).toBe(99);
  });

  it('setzt title und flow (flow nur wenn vorhanden)', () => {
    const pages = buildMdxPages(result, { diagrams: false });
    const auth = pages.find((p) => p.fileName === 'auth.mdx');
    const misc = pages.find((p) => p.fileName === 'misc.mdx');
    expect(auth?.frontmatter.title).toBe('Anmeldung & Registrierung');
    expect(auth?.frontmatter.flow).toBe('auth');
    expect(misc?.frontmatter.title).toBe('Weitere Seiten');
    expect(misc?.frontmatter).not.toHaveProperty('flow');
  });

  it('dedupliziert sourceRefs und sortiert nach file/line', () => {
    const pages = buildMdxPages(result, { diagrams: false });
    const auth = pages.find((p) => p.fileName === 'auth.mdx');
    expect(auth?.frontmatter.sourceRefs).toEqual([
      { file: 'lib/router.dart', line: 4 },
      { file: 'lib/screens/login.dart', line: 12, symbol: 'LoginScreen' },
    ]);
  });

  it('hängt bei diagrams: true einen Mermaid-Abschnitt an', () => {
    const [auth] = buildMdxPages(result, { diagrams: true });
    expect(auth?.body).toContain('## Ablaufdiagramm');
    expect(auth?.body).toContain('```mermaid\nflowchart TD');
    expect(auth?.body).toContain('login -->|tap| dashboard');
  });

  it('fügt bei diagrams: true den Abschnitt "## Hauptpfad" vor "## Ablaufdiagramm" ein', () => {
    const [auth] = buildMdxPages(result, { diagrams: true });
    expect(auth?.body).toContain('## Hauptpfad');
    expect(auth?.body).toContain('```mermaid\njourney');
    expect(auth?.body).toContain('  section Hauptpfad');
    expect(auth?.body).toContain('    Anmeldung: 3');
    expect(auth?.body).toContain('    Dashboard: 3');
    expect(auth!.body.indexOf('## Hauptpfad')).toBeLessThan(auth!.body.indexOf('## Ablaufdiagramm'));
  });

  it('erzeugt für Segmente ohne Hauptpfad (misc) keinen Hauptpfad-Abschnitt', () => {
    const pages = buildMdxPages(result, { diagrams: true });
    const misc = pages.find((p) => p.fileName === 'misc.mdx');
    expect(misc?.body).toContain('## Ablaufdiagramm');
    expect(misc?.body).not.toContain('## Hauptpfad');
  });

  it('fügt ohne diagrams-Option keinen Hauptpfad-Abschnitt ein', () => {
    const [auth] = buildMdxPages(result, { diagrams: false });
    expect(auth?.body).not.toContain('## Hauptpfad');
    expect(auth?.body).not.toContain('journey');
  });

  it('lässt den Body bei diagrams: false unverändert', () => {
    const [auth] = buildMdxPages(result, { diagrams: false });
    expect(auth?.body).toBe('# Anmeldung\n\nSchritt 1.');
    expect(auth?.body).not.toContain('mermaid');
  });

  it('"_misc" ergibt "misc.mdx"', () => {
    const pages = buildMdxPages(result, { diagrams: false });
    expect(pages.some((p) => p.fileName === 'misc.mdx')).toBe(true);
  });

  // SPEC §8.3 Schritt 4: Judge-Treffer ⇒ „Markierung im Output" (R1: sichtbare Warnflags).
  it('markiert Seiten mit Faithfulness-Violations durch einen Warnblock vor dem Body', () => {
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
    const [auth] = buildMdxPages(withViolations, { diagrams: false });
    expect(auth?.body.startsWith(':::caution[Faithfulness-Warnung]\n')).toBe(true);
    expect(auth?.body).toContain(
      '- Klicken Sie auf „Passwort vergessen“: Kein solcher Schritt im Graph.',
    );
    expect(auth?.body).toContain('- Bestätigungs-E-Mail: Nicht im Graph belegt.');
    // Aside geschlossen, Original-Body unverändert dahinter.
    expect(auth?.body).toContain(':::\n\n# Anmeldung\n\nSchritt 1.');
  });

  it('stellt den Warnblock auch bei diagrams: true voran (Diagramm bleibt am Ende)', () => {
    const withViolations = makeResult([
      {
        segment: authSegment,
        markdown: '# Anmeldung\n\nSchritt 1.',
        fromCache: true,
        violations: [{ claim: 'Erfundener Schritt', reason: 'Nicht im Graph.' }],
      },
    ]);
    const [auth] = buildMdxPages(withViolations, { diagrams: true });
    expect(auth?.body.startsWith(':::caution[Faithfulness-Warnung]\n')).toBe(true);
    expect(auth?.body.indexOf('## Ablaufdiagramm')).toBeGreaterThan(
      auth!.body.indexOf('# Anmeldung'),
    );
  });

  it('fügt ohne Violations keinerlei Warnmarkierung ein', () => {
    const [auth] = buildMdxPages(result, { diagrams: false });
    expect(auth?.body).not.toContain(':::caution');
    expect(auth?.body).not.toContain('Faithfulness');
  });
});

describe('writeMdxPages', () => {
  it('schreibt Frontmatter als YAML zwischen ---, mit LF und Schluss-Newline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-mdx-'));
    const pages = buildMdxPages(result, { diagrams: false });
    const paths = await writeMdxPages(pages, dir);

    expect(paths).toHaveLength(2);
    expect(paths.every((p) => isAbsolute(p))).toBe(true);
    expect(paths).toEqual([...paths].sort());

    const authPath = paths.find((p) => p.endsWith('auth.mdx'));
    const content = readFileSync(authPath!, 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).not.toContain('\r');
    expect(content.endsWith('\n')).toBe(true);

    // Roundtrip: Frontmatter wieder parsen und mit der Seite vergleichen.
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

  it('legt das Zielverzeichnis an (mkdir -p)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-mdx-'));
    const nested = join(dir, 'a', 'b');
    const paths = await writeMdxPages(buildMdxPages(result, { diagrams: false }), nested);
    expect(readFileSync(paths[0]!, 'utf8')).toContain('title:');
  });
});
