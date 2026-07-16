/**
 * End-to-end verification of the real phase-1 pipeline on the example apps:
 * Dart adapter directly, the complete CLI chain
 * (extract/generate/check/graph), website mode, NFR1/NFR2 smoke and
 * the negative adapter contract case (stdout must be exactly one graph JSON).
 *
 * Prerequisites: Dart and Flutter SDK in the PATH (present in CI/dev);
 * without them the suite is skipped. All artifacts go to temp
 * directories — the repository stays clean.
 */

import { spawnSync } from 'node:child_process';
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

/** Tools in the PATH? Without Dart/Flutter, E2E is pointless ⇒ skip the suite. */
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

/** Direct adapter invocation from the dart/ductus package context. */
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
    // Extra variables (e.g. DUCTUS_DART_ADAPTER_DIR) extend process.env.
    ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Copies an example project without build artifacts into a temp directory. */
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
  // Explicitly 'starlight' (the default would be 'journey') — this E2E case
  // keeps exercising the Starlight scaffold (MDX + sidebar + site config).
  '    generator: starlight',
  '',
].join('\n');

/** Config for the build-free usage (path A): NO command override — the
 *  resolution chain must find the adapter via DUCTUS_DART_ADAPTER_DIR. */
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

describe.skipIf(!hasDart || !hasFlutter)('E2E: example apps → pipeline (M9)', () => {
  /** Temp copy of the go_router demo with CLI configs (filled in beforeAll). */
  let tmpGo: string;
  /** Temp copy of the comment demo WITHOUT a ductus dependency (build-free, path A). */
  let tmpComment: string;

  beforeAll(() => {
    // dist/ is built once for the whole run by the vitest global setup —
    // the CLI chain runs against dist/ (bin contract).
    expect(existsSync(CLI), `${CLI} missing — global setup did not build?`).toBe(true);

    // Temp copy of the go_router demo: the path dependency on dart/ductus is
    // rewritten to an absolute path so the copy resolves on its own.
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

    // Temp copy of the comment demo: pubspec.yaml stays untouched (NO ductus
    // dependency, no pub get) — exactly the promise of path A
    // (comment convention: no build dependency).
    tmpComment = makeTmpDir('ductus-e2e-comment-');
    copyProject(COMMENT_DEMO, tmpComment);
    writeFileSync(join(tmpComment, 'ductus.config.yaml'), CONFIG_COMMENT, 'utf8');
  }, 600_000);

  afterAll(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
  });

  // ───────────────────────── Adapter directly (contract smoke) ────────────────

  describe('Dart adapter directly', () => {
    it(
      'go_router demo: derivation + annotations, two runs byte-identical (NFR2/A4)',
      () => {
        const first = runDartAdapter(GO_DEMO);
        expect(first.status, first.stderr).toBe(0);

        const graph = JSON.parse(first.stdout) as JourneyGraph;

        // All four screens present; dashboard/settings purely derived (path C),
        // login/register enriched by annotations (path B overrides derived
        // values field by field).
        const byId = new Map(graph.nodes.map((node) => [node.id, node]));
        for (const id of ['login', 'register', 'dashboard', 'settings']) {
          expect(byId.has(id), `Screen "${id}" missing`).toBe(true);
          expect(byId.get(id)?.type).toBe('screen');
        }
        expect(byId.get('dashboard')?.source).toBe('derived');
        expect(byId.get('settings')?.source).toBe('derived');
        expect(byId.get('login')?.source).toBe('annotation');
        expect(byId.get('login')?.title).toBe('Sign in');
        expect(byId.get('register')?.source).toBe('annotation');

        // Flow "auth" from @JourneyFlow; edge login→dashboard from @JourneyAction.
        expect(graph.flows.map((flow) => flow.id)).toContain('auth');
        const loginToDashboard = graph.edges.find(
          (edge) => edge.from === 'login' && edge.to === 'dashboard',
        );
        expect(loginToDashboard).toBeDefined();
        expect(loginToDashboard?.condition).toBe('Credentials valid');
        expect(loginToDashboard?.source).toBe('annotation');

        // meta.adapters filled (A5).
        expect(graph.meta?.adapters?.[0]?.name).toBe('dart');

        // Determinism: the second run yields byte-identical stdout.
        const second = runDartAdapter(GO_DEMO);
        expect(second.status, second.stderr).toBe(0);
        expect(second.stdout).toBe(first.stdout);
      },
      240_000,
    );

    it(
      'comment_demo: @journey: blocks yield 4 screens + decision + edges (path A)',
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
        // All nodes originate from annotations (no routing package in the project).
        expect(graph.nodes.every((node) => node.source === 'annotation')).toBe(true);

        // The decision branches conditionally back to the list or into the editor.
        const pairs = graph.edges.map((edge) => `${edge.from}→${edge.to}`);
        expect(pairs).toContain('note-list→note-editor');
        expect(pairs).toContain('note-editor→save-check');
        expect(pairs).toContain('save-check→note-list');
        expect(pairs).toContain('save-check→note-editor');
        const ok = graph.edges.find(
          (edge) => edge.from === 'save-check' && edge.to === 'note-list',
        );
        expect(ok?.condition).toBe('Title present');
      },
      120_000,
    );
  });

  // ─────────────────── CLI chain on the temp copy ─────────────────────────────

  describe('CLI chain (extract → generate → check → graph)', () => {
    it(
      'extract: exit 0, journey-graph.json valid and byte-stable; 2nd run < 10 s (NFR1/NFR2)',
      () => {
        const first = runCli(['extract'], tmpGo);
        expect(first.status, first.stderr).toBe(0);

        const graphPath = join(tmpGo, 'journey-graph.json');
        expect(existsSync(graphPath)).toBe(true);
        const bytes1 = readFileSync(graphPath);

        // Valid per the core rules (V1–V4/V6): no errors.
        const graph = JSON.parse(bytes1.toString('utf8')) as JourneyGraph;
        expect(validateGraph(graph).errors).toEqual([]);
        expect(graph.app?.name).toBe('GoRouterDemo');
        expect(graph.nodes.map((node) => node.id)).toContain('login');

        // NFR1 smoke on the warm second run (the first compiles the adapter binary).
        const startedAt = Date.now();
        const second = runCli(['extract'], tmpGo);
        const elapsedMs = Date.now() - startedAt;
        expect(second.status, second.stderr).toBe(0);
        expect(elapsedMs).toBeLessThan(10_000);

        // NFR2: byte-identical artifact across two runs.
        expect(readFileSync(graphPath).equals(bytes1)).toBe(true);
      },
      240_000,
    );

    it(
      'generate --offline: MDX with frontmatter + diagram, report with cache/tokens; 2nd run only cache hits',
      () => {
        const first = runCli(['--offline', 'generate'], tmpGo);
        expect(first.status, first.stderr).toBe(0);

        const docsDir = join(tmpGo, 'docs');
        const files = readdirSync(docsDir).filter((name) => name.endsWith('.mdx')).sort();
        expect(files.length).toBeGreaterThan(0);
        expect(files).toContain('auth.mdx');
        for (const name of files) {
          const content = readFileSync(join(docsDir, name), 'utf8');
          // YAML frontmatter with title/order/sourceRefs (traceability).
          expect(content.startsWith('---\n')).toBe(true);
          const frontmatter = content.split('---\n')[1] ?? '';
          expect(frontmatter).toMatch(/^title: /m);
          expect(frontmatter).toMatch(/^order: /m);
          expect(frontmatter).toMatch(/^sourceRefs:/m);
          expect(content).toContain('## Ablaufdiagramm');
        }

        // Report (ductus-report.json): cache hit rate and token report present.
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

        // Second run: unchanged graph ⇒ cache hits only.
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
      'check: exit 0 after generate (cache present, no violations, no LLM call)',
      () => {
        const result = runCli(['check'], tmpGo);
        expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
        // All segments are cached — no "Segment "…": not generated yet" lines.
        expect(result.stdout).not.toMatch(/^Segment "/m);
        expect(result.stdout).toMatch(/check: OK \(\d+ warning\(s\), 0 segment\(s\) not generated yet\)/);
      },
      120_000,
    );

    it(
      'graph: Mermaid ("flowchart TD") on stdout',
      () => {
        const result = runCli(['graph'], tmpGo);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('flowchart TD');
        expect(result.stdout).toContain('login');
      },
      120_000,
    );

    it(
      'website mode: Starlight scaffold with MDX under src/content/docs/, sidebar (sorted) and site config',
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

        // Sidebar deterministically sorted by order/file name (NFR2).
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

  // ───────── CLI chain build-free (path A): adapter via the resolution chain ──

  describe('CLI chain build-free (comment_demo without a ductus dependency)', () => {
    // Chain 2 of the resolution: package context via environment variable —
    // the target project itself does NOT know `ductus`.
    const ADAPTER_ENV = { DUCTUS_DART_ADAPTER_DIR: DART_PKG };

    it(
      'extract: exit 0 via DUCTUS_DART_ADAPTER_DIR; 4 screens + decision + conditional edges',
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

        // Conditional edges of the decision (condition from @journey:action).
        const conditionByPair = new Map(
          graph.edges.map((edge) => [`${edge.from}→${edge.to}`, edge.condition]),
        );
        expect(conditionByPair.get('save-check→note-list')).toBe('Title present');
        expect(conditionByPair.get('save-check→note-editor')).toBe('Title missing');
        expect(conditionByPair.has('note-editor→save-check')).toBe(true);
      },
      240_000,
    );

    it(
      'generate --offline (mock): exit 0 with MDX output',
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

  // ───────────── Path D via the core CLI (extra: { fromBuilder: true }) ───────

  describe('CLI chain path D (fromBuilder via the extra: block)', () => {
    const ADAPTER_ENV = { DUCTUS_DART_ADAPTER_DIR: DART_PKG };

    /** Minimal valid builder artifact (canonical form: sorted keys, LF). */
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
      'extract with extra: { fromBuilder: true } passes the artifact through — no scan',
      () => {
        const project = makeTmpDir('ductus-e2e-frombuilder-');
        writeFileSync(join(project, 'ductus_builder.g.json'), BUILDER_ARTIFACT, 'utf8');
        // Deliberately NOT readable literally: if a parse-only scan ran by
        // mistake (the earlier silent-failure regression), extract would abort
        // with exit 3 instead of passing the builder artifact through.
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
        // Provenance of the builder artifact ("dart-builder"), not the scan path ("dart").
        expect(graph.meta?.adapters?.[0]?.name).toBe('dart-builder');
        expect(graph.nodes.map((node) => node.id)).toEqual(['login']);
        // No scan ⇒ no debug file of the scan path either.
        expect(existsSync(join(project, 'ductus_graph.g.json'))).toBe(false);
      },
      240_000,
    );
  });

  // ──────────────── Adapter contract negative (fail-fast on conflict) ─────────

  describe('adapter contract: conflicting manual annotations', () => {
    /** Creates a temp project with two manual sources for the same node. */
    function makeConflictProject(): string {
      const dir = makeTmpDir('ductus-e2e-conflict-');
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'lib', 'a.dart'),
        [
          '// Manual source 1 (path B) for node "login".',
          "@JourneyScreen(id: 'login', title: 'Anmeldung A')",
          'class LoginScreenA {}',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(dir, 'lib', 'b.dart'),
        [
          '// Manual source 2 (path A) for node "login" — conflict in the field "title".',
          '// @journey:screen id="login" title="Anmeldung B"',
          'class LoginScreenB {}',
          '',
        ].join('\n'),
        'utf8',
      );
      return dir;
    }

    it(
      'adapter directly: exit non-zero, stderr names both sources (fail-fast instead of silent ambiguity)',
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
      'CLI extract: AdapterError ⇒ exit 3',
      () => {
        const dir = makeConflictProject();
        // Standalone package context so `dart run ductus:adapter` resolves.
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

  // ─────────────────────────── npm wrapper smoke ──────────────────────────────

  describe('npm wrapper ductus-adapter-dart', () => {
    it(
      'delegates to dart run and terminates with exit 0',
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

// ────────────────── E2E: TypeScript adapter (no SDK required) ────────────────
//
// Always runs (pure Node): react_router_demo → `- typescript:` resolution
// via the PATH → extract/generate.
describe('E2E: TypeScript adapter → pipeline', () => {
  const TS_DEMO = join(ROOT, 'examples', 'react_router_demo');
  const TS_CLI = join(ROOT, 'packages', 'adapter-typescript', 'dist', 'cli.js');

  let tsEnv: { PATH: string };
  let tmpTs: string;

  beforeAll(() => {
    // dist/ is built once for the whole run by the vitest global setup —
    // the CLI chain runs against dist/ (bin contract).
    expect(existsSync(CLI), `${CLI} missing — global setup did not build?`).toBe(true);
    expect(existsSync(TS_CLI), `${TS_CLI} missing — global setup did not build?`).toBe(true);

    // Own PATH shim instead of node_modules/.bin: in CI, npm ci runs BEFORE
    // the build, dist/cli.js is missing at install time and npm then does not
    // create the workspace bin link.
    const binDir = makeTmpDir('ductus-e2e-ts-bin-');
    const shim = join(binDir, 'ductus-adapter-typescript');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${TS_CLI}" "$@"\n`, {
      mode: 0o755,
    });
    tsEnv = { PATH: `${binDir}:${process.env['PATH'] ?? ''}` };

    tmpTs = makeTmpDir('ductus-e2e-ts-');
    copyProject(TS_DEMO, tmpTs);
  }, 600_000);

  it(
    'extract: resolves `- typescript:` via the PATH and writes journey-graph.json byte-stably',
    () => {
      const first = runCli(['extract'], tmpTs, tsEnv);
      expect(first.status, first.stderr).toBe(0);

      const graphPath = join(tmpTs, 'journey-graph.json');
      expect(existsSync(graphPath)).toBe(true);
      const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as JourneyGraph;
      expect(graph.meta?.adapters?.map((a) => a.name)).toContain('typescript');
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.nodes.some((node) => node.source === 'annotation')).toBe(true);
      expect(graph.nodes.some((node) => node.source === 'derived')).toBe(true);
      expect(validateGraph(graph).errors).toEqual([]);
      expect(existsSync(join(tmpTs, 'ductus-report.json'))).toBe(true);

      // NFR2: second run ⇒ byte-identical file.
      const firstBytes = readFileSync(graphPath);
      const second = runCli(['extract'], tmpTs, tsEnv);
      expect(second.status, second.stderr).toBe(0);
      expect(readFileSync(graphPath).equals(firstBytes)).toBe(true);
    },
    240_000,
  );

  it(
    'generate --offline (mock): produces MDX from the TypeScript graph',
    () => {
      const result = runCli(['--offline', 'generate'], tmpTs, tsEnv);
      expect(result.status, result.stderr).toBe(0);
      const docsDir = join(tmpTs, 'docs');
      expect(existsSync(docsDir)).toBe(true);
      const mdxFiles = readdirSync(docsDir).filter((name) => name.endsWith('.mdx'));
      expect(mdxFiles.length).toBeGreaterThan(0);
    },
    240_000,
  );
});
