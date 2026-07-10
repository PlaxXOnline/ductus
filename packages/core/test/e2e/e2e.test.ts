/**
 * End-to-End-Verifikation der realen Pipeline auf den Beispiel-Apps
 * (SPEC §12 Phase 1, M9): Dart-Adapter direkt, komplette CLI-Kette
 * (extract/generate/check/graph), Website-Modus, NFR1/NFR2-Smoke und
 * der negative Adapter-Vertragsfall (§7.1).
 *
 * Voraussetzungen: Dart- und Flutter-SDK im PATH (im CI/Dev vorhanden);
 * ohne sie wird die Suite übersprungen. Alle Artefakte landen in
 * Temp-Verzeichnissen — das Repository bleibt sauber.
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JourneyGraph } from '@ductus/schema';
import { validateGraph } from '@ductus/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLI = join(ROOT, 'packages', 'core', 'dist', 'cli.js');
const DART_PKG = join(ROOT, 'dart', 'ductus');
const GO_DEMO = join(ROOT, 'examples', 'flutter_go_router_demo');
const COMMENT_DEMO = join(ROOT, 'examples', 'flutter_comment_demo');
const WRAPPER = join(ROOT, 'packages', 'adapter-dart', 'bin', 'ductus-adapter-dart.js');

/** Werkzeuge im PATH? Ohne Dart/Flutter ist E2E nicht sinnvoll ⇒ Suite überspringen. */
function toolAvailable(command: string): boolean {
  return spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
}
const hasDart = toolAvailable('dart');
const hasFlutter = toolAvailable('flutter');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Adapter-Direktaufruf (DD §H) aus dem Paketkontext dart/ductus heraus. */
function runDartAdapter(projectDir: string, extraArgs: string[] = []): RunResult {
  const result = spawnSync(
    'dart',
    ['run', 'ductus:adapter', '--project', projectDir, '--no-debug-file', ...extraArgs],
    { cwd: DART_PKG, encoding: 'utf8', timeout: 120_000 },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runCli(args: string[], cwd: string, env?: Record<string, string>): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    // Zusätzliche Variablen (z. B. DUCTUS_DART_ADAPTER_DIR) ergänzen process.env.
    ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Kopiert ein Beispielprojekt ohne Build-Artefakte in ein Temp-Verzeichnis. */
function copyProject(sourceDir: string, targetDir: string): void {
  const EXCLUDED = new Set(['.dart_tool', 'build', 'pubspec.lock', '.idea']);
  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => !EXCLUDED.has(basename(src)),
  });
}

const CONFIG_MDX = [
  'app:',
  '  name: GoRouterDemo',
  '  locale: de',
  'adapters:',
  '  - dart:',
  '      project: .',
  'llm:',
  '  provider: mock',
  '  model: mock-model',
  'output:',
  '  format: mdx',
  '  dir: docs/',
  '',
].join('\n');

const CONFIG_WEBSITE = [
  'app:',
  '  name: GoRouterDemo',
  '  locale: de',
  'adapters:',
  '  - dart:',
  '      project: .',
  'llm:',
  '  provider: mock',
  '  model: mock-model',
  'output:',
  '  format: website',
  '  dir: site/',
  '  website:',
  // Explizit 'starlight' (Default ist 'journey', DD §O) — dieser E2E-Fall
  // prüft weiterhin das Starlight-Scaffold (MDX + Sidebar + Site-Konfig).
  '    generator: starlight',
  '',
].join('\n');

/** Config für die buildfreie Nutzung (Weg A): KEIN command-Override — die
 *  Auflösungskette (DD §H) muss den Adapter über DUCTUS_DART_ADAPTER_DIR finden. */
const CONFIG_COMMENT = [
  'app:',
  '  name: CommentDemo',
  '  locale: de',
  'adapters:',
  '  - dart:',
  '      project: .',
  'llm:',
  '  provider: mock',
  '  model: mock-model',
  'output:',
  '  format: mdx',
  '  dir: docs/',
  '',
].join('\n');

const tmpRoots: string[] = [];
function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

describe.skipIf(!hasDart || !hasFlutter)('E2E: Beispiel-Apps → Pipeline (M9)', () => {
  /** Temp-Kopie des go_router-Demos mit CLI-Configs (wird im beforeAll befüllt). */
  let tmpGo: string;
  /** Temp-Kopie des comment-Demos OHNE ductus-Dependency (buildfrei, Weg A). */
  let tmpComment: string;

  beforeAll(() => {
    // Einmal bauen — die CLI-Kette läuft gegen dist/ (bin-Vertrag).
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 300_000 });
    expect(existsSync(CLI)).toBe(true);

    // Temp-Kopie des go_router-Demos: Pfad-Abhängigkeit auf dart/ductus wird
    // absolut umgeschrieben, damit die Kopie eigenständig auflösbar ist.
    tmpGo = makeTmpDir('ductus-e2e-go-');
    copyProject(GO_DEMO, tmpGo);
    const pubspecPath = join(tmpGo, 'pubspec.yaml');
    const pubspec = readFileSync(pubspecPath, 'utf8').replace(
      '../../dart/ductus',
      DART_PKG,
    );
    expect(pubspec).toContain(DART_PKG);
    writeFileSync(pubspecPath, pubspec, 'utf8');

    const pubGet = spawnSync('flutter', ['pub', 'get'], {
      cwd: tmpGo,
      encoding: 'utf8',
      timeout: 300_000,
    });
    expect(pubGet.status, pubGet.stderr).toBe(0);

    writeFileSync(join(tmpGo, 'ductus.config.yaml'), CONFIG_MDX, 'utf8');
    writeFileSync(join(tmpGo, 'ductus.website.yaml'), CONFIG_WEBSITE, 'utf8');

    // Temp-Kopie des comment-Demos: pubspec.yaml bleibt unangetastet (KEINE
    // ductus-Dependency, kein pub get) — genau das ist das Versprechen von
    // Weg A (SPEC §5.1: keine Build-Abhängigkeit).
    tmpComment = makeTmpDir('ductus-e2e-comment-');
    copyProject(COMMENT_DEMO, tmpComment);
    writeFileSync(join(tmpComment, 'ductus.config.yaml'), CONFIG_COMMENT, 'utf8');
  }, 600_000);

  afterAll(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
  });

  // ───────────────────────── Adapter direkt (§7.1, DD §H) ─────────────────────

  describe('Dart-Adapter direkt', () => {
    it(
      'go_router-Demo: Ableitung + Annotationen, zwei Läufe byte-identisch (NFR2/A4)',
      () => {
        const first = runDartAdapter(GO_DEMO);
        expect(first.status, first.stderr).toBe(0);

        const graph = JSON.parse(first.stdout) as JourneyGraph;

        // Alle vier Screens vorhanden; dashboard/settings rein abgeleitet (Weg C),
        // login/register durch Annotationen angereichert (Weg B, §5.4).
        const byId = new Map(graph.nodes.map((node) => [node.id, node]));
        for (const id of ['login', 'register', 'dashboard', 'settings']) {
          expect(byId.has(id), `Screen "${id}" fehlt`).toBe(true);
          expect(byId.get(id)?.type).toBe('screen');
        }
        expect(byId.get('dashboard')?.source).toBe('derived');
        expect(byId.get('settings')?.source).toBe('derived');
        expect(byId.get('login')?.source).toBe('annotation');
        expect(byId.get('login')?.title).toBe('Anmeldung');
        expect(byId.get('register')?.source).toBe('annotation');

        // Flow "auth" aus @JourneyFlow; Edge login→dashboard aus @JourneyAction.
        expect(graph.flows.map((flow) => flow.id)).toContain('auth');
        const loginToDashboard = graph.edges.find(
          (edge) => edge.from === 'login' && edge.to === 'dashboard',
        );
        expect(loginToDashboard).toBeDefined();
        expect(loginToDashboard?.condition).toBe('Zugangsdaten gültig');
        expect(loginToDashboard?.source).toBe('annotation');

        // meta.adapters gefüllt (A5).
        expect(graph.meta?.adapters?.[0]?.name).toBe('dart');

        // Determinismus: zweiter Lauf liefert byte-identisches stdout.
        const second = runDartAdapter(GO_DEMO);
        expect(second.status, second.stderr).toBe(0);
        expect(second.stdout).toBe(first.stdout);
      },
      240_000,
    );

    it(
      'comment_demo: @journey:-Blöcke ergeben 4 Screens + Decision + Edges (Weg A)',
      () => {
        const result = runDartAdapter(COMMENT_DEMO);
        expect(result.status, result.stderr).toBe(0);

        const graph = JSON.parse(result.stdout) as JourneyGraph;
        const screens = graph.nodes.filter((node) => node.type === 'screen');
        const decisions = graph.nodes.filter((node) => node.type === 'decision');
        expect(screens.map((node) => node.id).sort()).toEqual([
          'note-detail',
          'note-editor',
          'note-list',
          'settings',
        ]);
        expect(decisions.map((node) => node.id)).toEqual(['save-check']);
        // Alle Nodes stammen aus Annotationen (kein Routing-Paket im Projekt).
        expect(graph.nodes.every((node) => node.source === 'annotation')).toBe(true);

        // Die Decision verzweigt bedingt zurück zur Liste bzw. in den Editor.
        const pairs = graph.edges.map((edge) => `${edge.from}→${edge.to}`);
        expect(pairs).toContain('note-list→note-editor');
        expect(pairs).toContain('note-editor→save-check');
        expect(pairs).toContain('save-check→note-list');
        expect(pairs).toContain('save-check→note-editor');
        const ok = graph.edges.find(
          (edge) => edge.from === 'save-check' && edge.to === 'note-list',
        );
        expect(ok?.condition).toBe('Titel vorhanden');
      },
      120_000,
    );
  });

  // ─────────────────── CLI-Kette auf der Temp-Kopie (§10.1) ───────────────────

  describe('CLI-Kette (extract → generate → check → graph)', () => {
    it(
      'extract: Exit 0, journey-graph.json valide und byte-stabil; 2. Lauf < 10 s (NFR1/NFR2)',
      () => {
        const first = runCli(['extract'], tmpGo);
        expect(first.status, first.stderr).toBe(0);

        const graphPath = join(tmpGo, 'journey-graph.json');
        expect(existsSync(graphPath)).toBe(true);
        const bytes1 = readFileSync(graphPath);

        // Valide nach den Core-Regeln (V1–V4/V6): keine Fehler.
        const graph = JSON.parse(bytes1.toString('utf8')) as JourneyGraph;
        expect(validateGraph(graph).errors).toEqual([]);
        expect(graph.app?.name).toBe('GoRouterDemo');
        expect(graph.nodes.map((node) => node.id)).toContain('login');

        // NFR1-Smoke am warmen zweiten Lauf (der erste kompiliert das Adapter-Binary).
        const startedAt = Date.now();
        const second = runCli(['extract'], tmpGo);
        const elapsedMs = Date.now() - startedAt;
        expect(second.status, second.stderr).toBe(0);
        expect(elapsedMs).toBeLessThan(10_000);

        // NFR2: byte-identisches Artefakt über zwei Läufe.
        expect(readFileSync(graphPath).equals(bytes1)).toBe(true);
      },
      240_000,
    );

    it(
      'generate --offline: MDX mit Frontmatter + Diagramm, Report mit cache/tokens; 2. Lauf nur Cache-Treffer (§8.5)',
      () => {
        const first = runCli(['--offline', 'generate'], tmpGo);
        expect(first.status, first.stderr).toBe(0);

        const docsDir = join(tmpGo, 'docs');
        const files = readdirSync(docsDir).filter((name) => name.endsWith('.mdx')).sort();
        expect(files.length).toBeGreaterThan(0);
        expect(files).toContain('auth.mdx');
        for (const name of files) {
          const content = readFileSync(join(docsDir, name), 'utf8');
          // YAML-Frontmatter mit title/order/sourceRefs (§9.1).
          expect(content.startsWith('---\n')).toBe(true);
          const frontmatter = content.split('---\n')[1] ?? '';
          expect(frontmatter).toMatch(/^title: /m);
          expect(frontmatter).toMatch(/^order: /m);
          expect(frontmatter).toMatch(/^sourceRefs:/m);
          expect(content).toContain('## Ablaufdiagramm');
        }

        // Report (§9.3): Cache-Trefferquote und Token-Bericht vorhanden.
        const reportPath = join(tmpGo, 'ductus-report.json');
        const report1 = JSON.parse(readFileSync(reportPath, 'utf8')) as {
          cache?: { hits: number; misses: number; hitRate: number };
          tokens?: { estimated: unknown; actual: unknown };
        };
        expect(report1.cache).toBeDefined();
        expect(report1.tokens).toBeDefined();
        expect(report1.cache?.hits).toBe(0);
        const segmentCount = (report1.cache?.hits ?? 0) + (report1.cache?.misses ?? 0);
        expect(segmentCount).toBeGreaterThan(0);

        // Zweiter Lauf: unveränderter Graph ⇒ ausschließlich Cache-Treffer.
        const second = runCli(['--offline', 'generate'], tmpGo);
        expect(second.status, second.stderr).toBe(0);
        const report2 = JSON.parse(readFileSync(reportPath, 'utf8')) as {
          cache?: { hits: number; misses: number; hitRate: number };
        };
        expect(report2.cache?.hits).toBe(segmentCount);
        expect(report2.cache?.misses).toBe(0);
        expect(report2.cache?.hitRate).toBe(1);
      },
      240_000,
    );

    it(
      'check: Exit 0 nach generate (Cache vorhanden, keine Verstöße; DD §B.8)',
      () => {
        const result = runCli(['check'], tmpGo);
        expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
        // Alle Segmente sind gecacht — keine "Segment "…": noch nicht generiert"-Zeilen.
        expect(result.stdout).not.toMatch(/^Segment "/m);
        expect(result.stdout).toMatch(/check: OK \(\d+ Warnung\(en\), 0 Segment\(e\) noch nicht generiert\)/);
      },
      120_000,
    );

    it(
      'graph: Mermaid ("flowchart TD") auf stdout',
      () => {
        const result = runCli(['graph'], tmpGo);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('flowchart TD');
        expect(result.stdout).toContain('login');
      },
      120_000,
    );

    it(
      'Website-Modus: Starlight-Scaffold mit MDX, Sidebar (sortiert) und Site-Konfig (§9.2, DD §B.7)',
      () => {
        const result = runCli(['-c', 'ductus.website.yaml', '--offline', 'generate'], tmpGo);
        expect(result.status, result.stderr).toBe(0);

        const siteDir = join(tmpGo, 'site');
        expect(existsSync(join(siteDir, 'astro.config.mjs'))).toBe(true);
        expect(existsSync(join(siteDir, 'ductus.site.json'))).toBe(true);

        const docs = readdirSync(join(siteDir, 'src', 'content', 'docs')).filter((name) =>
          name.endsWith('.mdx'),
        );
        expect(docs).toContain('auth.mdx');

        // Sidebar deterministisch nach order/Dateiname sortiert (NFR2).
        const sidebar = JSON.parse(
          readFileSync(join(siteDir, 'ductus.sidebar.json'), 'utf8'),
        ) as Array<{ label: string; link: string }>;
        expect(sidebar.length).toBeGreaterThan(0);
        const links = sidebar.map((entry) => entry.link);
        expect(links).toContain('/auth/');

        const site = JSON.parse(readFileSync(join(siteDir, 'ductus.site.json'), 'utf8')) as {
          title: string;
          locale: string;
        };
        expect(site.title).toBe('GoRouterDemo');
        expect(site.locale).toBe('de');
      },
      240_000,
    );
  });

  // ───────── CLI-Kette buildfrei (Weg A, §5.1): Auflösung über DD §H ──────────

  describe('CLI-Kette buildfrei (comment_demo ohne ductus-Dependency)', () => {
    // Kette 2 der Auflösung (DD §H): Paketkontext via Umgebungsvariable —
    // das Zielprojekt selbst kennt `ductus` NICHT.
    const ADAPTER_ENV = { DUCTUS_DART_ADAPTER_DIR: DART_PKG };

    it(
      'extract: Exit 0 via DUCTUS_DART_ADAPTER_DIR; 4 Screens + Decision + bedingte Edges',
      () => {
        const result = runCli(['extract'], tmpComment, ADAPTER_ENV);
        expect(result.status, result.stderr).toBe(0);

        const graphPath = join(tmpComment, 'journey-graph.json');
        expect(existsSync(graphPath)).toBe(true);
        const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as JourneyGraph;
        expect(validateGraph(graph).errors).toEqual([]);

        const screens = graph.nodes.filter((node) => node.type === 'screen');
        expect(screens.map((node) => node.id).sort()).toEqual([
          'note-detail',
          'note-editor',
          'note-list',
          'settings',
        ]);
        expect(
          graph.nodes.filter((node) => node.type === 'decision').map((node) => node.id),
        ).toEqual(['save-check']);

        // Bedingte Edges der Decision (§5.1: condition aus @journey:action).
        const conditionByPair = new Map(
          graph.edges.map((edge) => [`${edge.from}→${edge.to}`, edge.condition]),
        );
        expect(conditionByPair.get('save-check→note-list')).toBe('Titel vorhanden');
        expect(conditionByPair.get('save-check→note-editor')).toBe('Titel fehlt');
        expect(conditionByPair.has('note-editor→save-check')).toBe(true);
      },
      240_000,
    );

    it(
      'generate --offline (mock): Exit 0 mit MDX-Ausgabe',
      () => {
        const result = runCli(['--offline', 'generate'], tmpComment, ADAPTER_ENV);
        expect(result.status, result.stderr).toBe(0);

        const docsDir = join(tmpComment, 'docs');
        const files = readdirSync(docsDir).filter((name) => name.endsWith('.mdx')).sort();
        expect(files).toContain('notes.mdx');
        const content = readFileSync(join(docsDir, files[0]!), 'utf8');
        expect(content.startsWith('---\n')).toBe(true);
        expect(content).toMatch(/^title: /m);
      },
      240_000,
    );
  });

  // ───────────── Weg D über das Core-CLI (extra: { fromBuilder: true }) ───────

  describe('CLI-Kette Weg D (fromBuilder über den extra:-Block)', () => {
    const ADAPTER_ENV = { DUCTUS_DART_ADAPTER_DIR: DART_PKG };

    /** Minimal valides Builder-Artefakt (kanonische Form, DD §N). */
    const BUILDER_ARTIFACT = `${JSON.stringify(
      {
        edges: [],
        flows: [],
        meta: { adapters: [{ name: 'dart-builder', version: '0.2.0' }] },
        nodes: [
          {
            id: 'login',
            source: 'annotation',
            sourceRef: { file: 'lib/main.dart', line: 5 },
            title: 'Anmeldung',
            type: 'screen',
          },
        ],
        schemaVersion: '1.0',
      },
      null,
      2,
    )}\n`;

    it(
      'extract mit extra: { fromBuilder: true } reicht das Artefakt durch — kein Scan',
      () => {
        const project = makeTmpDir('ductus-e2e-frombuilder-');
        writeFileSync(join(project, 'ductus_builder.g.json'), BUILDER_ARTIFACT, 'utf8');
        // Absichtlich NICHT literal lesbar: liefe fälschlich ein parse-only-
        // Scan (die frühere Silent-Failure-Regression), bräche extract mit
        // Exit 3 ab statt das Builder-Artefakt durchzureichen.
        mkdirSync(join(project, 'lib'), { recursive: true });
        writeFileSync(
          join(project, 'lib', 'main.dart'),
          [
            "import 'package:ductus/ductus.dart';",
            '',
            'abstract class MyConstants {',
            "  static const String title = 'Anmeldung';",
            '}',
            '',
            "@JourneyScreen(id: 'login', title: MyConstants.title)",
            'class LoginScreen {}',
            '',
          ].join('\n'),
          'utf8',
        );
        writeFileSync(
          join(project, 'ductus.config.yaml'),
          [
            'app:',
            '  name: FromBuilderDemo',
            '  locale: de',
            'adapters:',
            '  - dart:',
            '      project: .',
            '      extra: { fromBuilder: true }',
            'llm:',
            '  provider: mock',
            '  model: mock-model',
            '',
          ].join('\n'),
          'utf8',
        );

        const result = runCli(['extract'], project, ADAPTER_ENV);
        expect(result.status, result.stderr).toBe(0);

        const graphPath = join(project, 'journey-graph.json');
        expect(existsSync(graphPath)).toBe(true);
        const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as JourneyGraph;
        expect(validateGraph(graph).errors).toEqual([]);
        // Provenance des Builder-Artefakts, nicht des Scan-Wegs (DD §N).
        expect(graph.meta?.adapters?.[0]?.name).toBe('dart-builder');
        expect(graph.nodes.map((node) => node.id)).toEqual(['login']);
        // Kein Scan ⇒ auch keine Debug-Datei des Scan-Wegs.
        expect(existsSync(join(project, 'ductus_graph.g.json'))).toBe(false);
      },
      240_000,
    );
  });

  // ──────────────── Adapter-Vertrag §7.1 negativ (fail-fast, §5.4) ────────────

  describe('Adapter-Vertrag: widersprüchliche manuelle Annotationen', () => {
    /** Legt ein Temp-Projekt mit zwei manuellen Quellen für denselben Node an. */
    function makeConflictProject(): string {
      const dir = makeTmpDir('ductus-e2e-conflict-');
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'lib', 'a.dart'),
        [
          '// Manuelle Quelle 1 (Weg B) für node "login".',
          "@JourneyScreen(id: 'login', title: 'Anmeldung A')",
          'class LoginScreenA {}',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(dir, 'lib', 'b.dart'),
        [
          '// Manuelle Quelle 2 (Weg A) für node "login" — Konflikt im Feld "title".',
          '// @journey:screen id="login" title="Anmeldung B"',
          'class LoginScreenB {}',
          '',
        ].join('\n'),
        'utf8',
      );
      return dir;
    }

    it(
      'Adapter direkt: Exit ungleich 0, stderr nennt beide Quellen (§5.4 fail-fast)',
      () => {
        const dir = makeConflictProject();
        const result = runDartAdapter(dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('a.dart');
        expect(result.stderr).toContain('b.dart');
        expect(result.stdout.trim()).toBe('');
      },
      120_000,
    );

    it(
      'CLI extract: AdapterError ⇒ Exit 3 (DD §I)',
      () => {
        const dir = makeConflictProject();
        // Eigenständiger Paketkontext, damit `dart run ductus:adapter` auflösbar ist.
        writeFileSync(
          join(dir, 'pubspec.yaml'),
          [
            'name: conflict_fixture',
            'publish_to: none',
            'environment:',
            '  sdk: ^3.5.0',
            'dependencies:',
            '  ductus:',
            `    path: ${DART_PKG}`,
            '',
          ].join('\n'),
          'utf8',
        );
        const pubGet = spawnSync('dart', ['pub', 'get'], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect(pubGet.status, pubGet.stderr).toBe(0);

        writeFileSync(join(dir, 'ductus.config.yaml'), CONFIG_MDX, 'utf8');
        const result = runCli(['extract'], dir);
        expect(result.status).toBe(3);
        expect(result.stderr).toContain('a.dart');
        expect(result.stderr).toContain('b.dart');
        expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
      },
      240_000,
    );
  });

  // ─────────────────────────── npm-Wrapper-Smoke (§4.3) ───────────────────────

  describe('npm-Wrapper ductus-adapter-dart', () => {
    it(
      'delegiert an dart run und terminiert mit Exit 0',
      () => {
        const result = spawnSync(
          process.execPath,
          [WRAPPER, '--project', tmpGo, '--no-debug-file'],
          { encoding: 'utf8', timeout: 120_000 },
        );
        expect(result.status, result.stderr).toBe(0);
        const graph = JSON.parse(result.stdout) as JourneyGraph;
        expect(graph.nodes.map((node) => node.id)).toContain('login');
      },
      120_000,
    );
  });
});
