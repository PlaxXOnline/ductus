/**
 * End-to-end tests of the ductus CLI against the built dist output.
 * The build runs once per test file in beforeAll (generous timeout).
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLI = join(ROOT, 'packages', 'core', 'dist', 'cli.js');
const FIXTURE = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'fake-adapter.mjs');

const tmpRoots: string[] = [];

function makeProject(adapterMode?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-cli-test-'));
  tmpRoots.push(dir);
  const command = `node ${FIXTURE}${adapterMode !== undefined ? ` ${adapterMode}` : ''}`;
  writeFileSync(
    join(dir, 'ductus.config.yaml'),
    [
      'app:',
      '  name: TestApp',
      '  locale: de',
      'adapters:',
      '  - fake:',
      `      command: ${command}`,
      'llm:',
      '  provider: mock',
      '  model: mock-model',
      'output:',
      '  format: mdx',
      '  dir: docs/',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  // Build once per test file — the CLI tests run against dist/ (bin contract).
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 300_000 });
  expect(existsSync(CLI)).toBe(true);
}, 360_000);

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('ductus extract', () => {
  it('writes journey-graph.json byte-identically across two runs (NFR2)', () => {
    const dir = makeProject();

    const first = runCli(['extract'], dir);
    expect(first.status, first.stderr).toBe(0);
    const graphPath = join(dir, 'journey-graph.json');
    const bytes1 = readFileSync(graphPath);

    const second = runCli(['extract'], dir);
    expect(second.status, second.stderr).toBe(0);
    const bytes2 = readFileSync(graphPath);

    expect(bytes1.equals(bytes2)).toBe(true);
    expect(first.stdout).toContain('2 nodes');
    expect(first.stdout).toContain('1 edges');
    expect(first.stdout).toContain('1 flows');
    expect(existsSync(join(dir, 'ductus-report.json'))).toBe(true);
  });

  it('reports validation errors line by line on stderr and exits with 1', () => {
    const dir = makeProject('dangling');
    const result = runCli(['extract'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/V1 .*"missing"/);
    // No graph is written on errors.
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('rejects an incompatible adapter schemaVersion as V6 with exit 1 (NFR7)', () => {
    const dir = makeProject('futureversion');
    const result = runCli(['extract'], dir);
    // Classified as a validation error (exit 1), NOT as an AdapterError (exit 3).
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/V6 Adapter "fake": schemaVersion "2\.0" is not supported/);
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('exits with 3 on a missing config or an adapter failure', () => {
    const noConfig = runCli(['-c', 'gibt-es-nicht.yaml', 'extract'], makeProject());
    expect(noConfig.status).toBe(3);
    expect(noConfig.stderr).toContain('Cannot read config file');

    const broken = runCli(['extract'], makeProject('fail'));
    expect(broken.status).toBe(3);
    expect(broken.stderr).toContain('exit code 1');
  });
});

describe('ductus generate / check / graph', () => {
  it('generate --offline with mock writes MDX with frontmatter and a report (exit 0)', () => {
    const dir = makeProject();
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status, result.stderr).toBe(0);

    // The upfront cost estimate (NFR3) appears on stderr before generation.
    expect(result.stderr).toMatch(/Cost estimate \(upfront\).*segment/);

    const docsDir = join(dir, 'docs');
    const files = readdirSync(docsDir).sort();
    expect(files).toEqual(['auth.mdx', 'misc.mdx']);
    const authMdx = readFileSync(join(docsDir, 'auth.mdx'), 'utf8');
    expect(authMdx.startsWith('---\n')).toBe(true);
    expect(authMdx).toContain('title: Anmeldung');
    expect(authMdx).toContain('order: 1');

    const report = JSON.parse(readFileSync(join(dir, 'ductus-report.json'), 'utf8')) as {
      cache?: { hits: number; misses: number };
      tokens?: unknown;
      faithfulness: unknown[];
    };
    expect(report.cache).toEqual({ hits: 0, misses: 2, hitRate: 0 });
    expect(report.tokens).toBeDefined();
    expect(report.faithfulness).toEqual([]);
  });

  it('generate --offline with a real provider exits with 3 (only mock is network-free)', () => {
    const dir = makeProject();
    // provider anthropic instead of mock:
    const config = readFileSync(join(dir, 'ductus.config.yaml'), 'utf8');
    writeFileSync(join(dir, 'ductus.config.yaml'), config.replace('provider: mock', 'provider: anthropic'));
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--offline');
  });

  it('check after generate exits with 0 and rewrites nothing', () => {
    const dir = makeProject();
    expect(runCli(['--offline', 'generate'], dir).status).toBe(0);

    const watched = [
      join(dir, 'journey-graph.json'),
      join(dir, 'ductus-report.json'),
      join(dir, 'docs', 'auth.mdx'),
    ];
    const before = watched.map((path) => statSync(path).mtimeMs);

    const result = runCli(['--offline', 'check'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('check: OK (0 warning(s), 0 segment(s) not generated yet)');
    // All segments are generated — no "not generated yet" segment line.
    expect(result.stdout).not.toMatch(/Segment ".*": not generated yet/);

    const after = watched.map((path) => statSync(path).mtimeMs);
    expect(after).toEqual(before);
  });

  it('check before generate reports segments as not generated yet (exit 0)', () => {
    const dir = makeProject();
    const result = runCli(['--offline', 'check'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('not generated yet');
  });

  it('graph prints "flowchart TD" on stdout and writes no artifacts', () => {
    const dir = makeProject();
    const result = runCli(['graph'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('flowchart TD');
    expect(result.stdout).toContain('login');
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('graph --journey prints the journey diagram of the flow main path instead of the flowchart', () => {
    const dir = makeProject('flowfull');
    const result = runCli(['graph', '--journey'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      ['journey', '  title Anmeldung', '  section Hauptpfad', '    Login: 3', '    Dashboard: 3', ''].join('\n'),
    );
  });

  it('graph --journey without a main path of ≥ 2 nodes prints only a note on stderr (exit 0)', () => {
    // In the standard graph only "login" belongs to the flow — the main path has 1 node.
    const dir = makeProject();
    const result = runCli(['graph', '--journey'], dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Note: no journey diagram');
    expect(result.stdout).toBe('');
  });
});

describe('ductus init', () => {
  it('creates a config, detects pubspec.yaml and refuses to overwrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-init-test-'));
    tmpRoots.push(dir);
    writeFileSync(
      join(dir, 'pubspec.yaml'),
      ['name: flutter_demo_app', 'dependencies:', '  flutter:', '    sdk: flutter', '  go_router: ^14.0.0', ''].join('\n'),
      'utf8',
    );

    const first = runCli(['init'], dir);
    expect(first.status, first.stderr).toBe(0);
    const configPath = join(dir, 'ductus.config.yaml');
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain('name: flutter_demo_app');
    expect(written).toContain('deriveFrom: [go_router]');
    expect(first.stdout).toContain('ductus extract');

    // Second run without --force: exit ≠ 0, file stays unchanged.
    const second = runCli(['init'], dir);
    expect(second.status).toBe(3);
    expect(second.stderr).toContain('already exists');
    expect(readFileSync(configPath, 'utf8')).toBe(written);

    // With --force it is overwritten.
    const forced = runCli(['init', '--force'], dir);
    expect(forced.status, forced.stderr).toBe(0);
  });

  it('detects package.json (TypeScript project) and derives deriveFrom from the dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-init-ts-test-'));
    tmpRoots.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'web-demo-app',
        dependencies: { react: '^19.0.0', 'react-router-dom': '^7.0.0' },
      }),
      'utf8',
    );

    const result = runCli(['init'], dir);
    expect(result.status, result.stderr).toBe(0);
    const written = readFileSync(join(dir, 'ductus.config.yaml'), 'utf8');
    expect(written).toContain('name: web-demo-app');
    expect(written).toContain('- typescript:');
    expect(written).toContain('deriveFrom: [react-router]');
    expect(result.stdout).toContain('Detected from package.json');
  });

  it('prefers pubspec.yaml when both manifests exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-init-both-test-'));
    tmpRoots.push(dir);
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: flutter_app\n', 'utf8');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tooling' }), 'utf8');

    const result = runCli(['init'], dir);
    expect(result.status, result.stderr).toBe(0);
    const written = readFileSync(join(dir, 'ductus.config.yaml'), 'utf8');
    expect(written).toContain('- dart:');
    expect(written).toContain('name: flutter_app');
  });
});

describe('ductus generate (website mode, generator journey — default)', () => {
  /**
   * Project with output.format website; without a generator line the default
   * 'journey' applies. The template is resolved via the repo fallback
   * templates/journey (resolveTemplateDir).
   */
  function makeJourneyProject(adapterMode?: string, generator?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-cli-journey-'));
    tmpRoots.push(dir);
    const command = `node ${FIXTURE}${adapterMode !== undefined ? ` ${adapterMode}` : ''}`;
    writeFileSync(
      join(dir, 'ductus.config.yaml'),
      [
        'app:',
        '  name: TestApp',
        '  locale: de',
        'adapters:',
        '  - fake:',
        `      command: ${command}`,
        'llm:',
        '  provider: mock',
        '  model: mock-model',
        'output:',
        '  format: website',
        '  dir: site/',
        ...(generator !== undefined ? ['  website:', `    generator: ${generator}`] : []),
        '',
      ].join('\n'),
      'utf8',
    );
    return dir;
  }

  it('writes the journey scaffold with ductus.data.json per the data contract — no MDX/sidebar/site files', () => {
    // 'flowfull': both screens in the flow "auth" ⇒ main path login → dashboard.
    const dir = makeJourneyProject('flowfull');
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status, result.stderr).toBe(0);

    const siteDir = join(dir, 'site');
    // Template copied; gitignore → .gitignore renamed.
    for (const file of ['package.json', 'astro.config.mjs', '.gitignore']) {
      expect(existsSync(join(siteDir, file)), `${file} missing`).toBe(true);
    }
    expect(existsSync(join(siteDir, 'gitignore'))).toBe(false);
    // The only data file is ductus.data.json — no Starlight artifacts.
    expect(existsSync(join(siteDir, 'src', 'content', 'docs'))).toBe(false);
    expect(existsSync(join(siteDir, 'ductus.sidebar.json'))).toBe(false);
    expect(existsSync(join(siteDir, 'ductus.site.json'))).toBe(false);

    const raw = readFileSync(join(siteDir, 'ductus.data.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const data = JSON.parse(raw) as {
      dataVersion: string;
      site: {
        title: string;
        locale: string;
        ductusVersion: string;
        adapters: Array<{ name: string; version: string }>;
        violationsTotal: number;
      };
      journeys: Array<{
        id: string;
        slug: string;
        kind: string;
        startNodeId: string | null;
        nodes: Array<{ id: string; start: boolean; sourceRef: { file: string } | null }>;
        edges: Array<{ id: string; main: number | null }>;
        mainPath: string[];
        markdown: string;
      }>;
    };

    expect(data.dataVersion).toBe('1');
    expect(data.site.title).toBe('TestApp');
    expect(data.site.locale).toBe('de');
    expect(data.site.adapters).toEqual([{ name: 'fake', version: '1.0.0' }]);
    expect(data.site.violationsTotal).toBe(0);
    // ductusVersion comes from @ductus/core's package.json at runtime (no hardcoding).
    const corePkg = JSON.parse(
      readFileSync(join(ROOT, 'packages', 'core', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(data.site.ductusVersion).toBe(corePkg.version);

    const auth = data.journeys.find((journey) => journey.id === 'auth');
    expect(auth).toBeDefined();
    expect(auth?.slug).toBe('auth');
    expect(auth?.kind).toBe('flow');
    expect(auth?.startNodeId).toBe('login');
    expect(auth?.mainPath).toEqual(['login', 'dashboard']);
    expect(auth?.markdown.length).toBeGreaterThan(0);
    // The main-path edge carries the 0-based index; the start flag only on the start node.
    expect(auth?.edges.find((edge) => edge.id === 'e_login_dashboard')?.main).toBe(0);
    const login = auth?.nodes.find((node) => node.id === 'login');
    expect(login?.start).toBe(true);
    expect(login?.sourceRef).toEqual({
      file: 'lib/screens/login.dart',
      line: 12,
      symbol: 'LoginScreen',
    });
    expect(auth?.nodes.find((node) => node.id === 'dashboard')?.sourceRef).toBeNull();
  });

  it('writes ductus.data.json byte-identically across two runs (NFR2)', () => {
    const dir = makeJourneyProject('flowfull');
    expect(runCli(['--offline', 'generate'], dir).status).toBe(0);
    const dataPath = join(dir, 'site', 'ductus.data.json');
    const bytes1 = readFileSync(dataPath);

    const second = runCli(['--offline', 'generate'], dir);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(dataPath).equals(bytes1)).toBe(true);
  });

  it('rejects generator docusaurus in phase 1 with exit 3 (guard in runGenerate)', () => {
    const dir = makeJourneyProject(undefined, 'docusaurus');
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('docusaurus');
    expect(result.stderr).toMatch(/journey.*starlight/);
    // No site scaffold was created before the guard.
    expect(existsSync(join(dir, 'site'))).toBe(false);
  });
});

describe('ductus generate --build', () => {
  const FAKE_NPM = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'fake-npm.mjs');

  /** Project with output.format website (site root: <dir>/site). */
  function makeWebsiteProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-cli-build-'));
    tmpRoots.push(dir);
    writeFileSync(
      join(dir, 'ductus.config.yaml'),
      [
        'app:',
        '  name: TestApp',
        '  locale: de',
        'adapters:',
        '  - fake:',
        `      command: node ${FIXTURE}`,
        'llm:',
        '  provider: mock',
        '  model: mock-model',
        'output:',
        '  format: website',
        '  dir: site/',
        '  website:',
        // Explicitly 'starlight' (the default would be 'journey') — these
        // tests exercise the build chain against the Starlight preset.
        '    generator: starlight',
        '',
      ].join('\n'),
      'utf8',
    );
    return dir;
  }

  interface FakeNpm {
    env: NodeJS.ProcessEnv;
    logFile: string;
  }

  /**
   * Fake npm via PATH prepend (no real npm, offline): logs every call as
   * "<cwd>\t<arguments>" and optionally fails at one step.
   */
  function fakeNpm(dir: string, failStep?: string): FakeNpm {
    const binDir = join(dir, 'fake-bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, 'npm'),
      `#!/bin/sh\nexec "${process.execPath}" "${FAKE_NPM}" "$@"\n`,
      { mode: 0o755 },
    );
    const logFile = join(dir, 'npm-calls.log');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env['PATH'] ?? ''}`,
      DUCTUS_FAKE_NPM_LOG: logFile,
      ...(failStep !== undefined ? { DUCTUS_FAKE_NPM_FAIL: failStep } : {}),
    };
    return { env, logFile };
  }

  /** Like runCli, but with a custom environment (PATH with fake npm). */
  function runCliWithEnv(args: string[], cwd: string, env: NodeJS.ProcessEnv): CliResult {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('calls npm install and npm run build in this order in the site directory', () => {
    const dir = makeWebsiteProject();
    const { env, logFile } = fakeNpm(dir);
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status, result.stderr).toBe(0);

    // macOS: /var → /private/var — the child process cwd is the real path.
    const siteDir = join(realpathSync(dir), 'site');
    const calls = readFileSync(logFile, 'utf8').trim().split('\n');
    expect(calls).toEqual([`${siteDir}\tinstall`, `${siteDir}\trun build`]);
    expect(result.stdout).toContain(`Website built: ${join(siteDir, 'dist')}`);
  });

  it('uses npm ci instead of install when the site directory contains a package-lock.json', () => {
    const dir = makeWebsiteProject();
    mkdirSync(join(dir, 'site'), { recursive: true });
    writeFileSync(join(dir, 'site', 'package-lock.json'), '{}\n', 'utf8');
    const { env, logFile } = fakeNpm(dir);
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status, result.stderr).toBe(0);

    const steps = readFileSync(logFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('\t')[1]);
    expect(steps).toEqual(['ci', 'run build']);
  });

  it('reports the failed npm step and exits with 3', () => {
    const dir = makeWebsiteProject();
    const { env, logFile } = fakeNpm(dir, 'install');
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('"npm install" failed with exit code 1');
    expect(result.stdout).not.toContain('Website built');
    // No run build follows the failed install.
    expect(readFileSync(logFile, 'utf8')).not.toContain('run build');
  });

  it('--build with output.format mdx is a usage error (exit 3, no silent fallback)', () => {
    const dir = makeProject();
    const result = runCli(['generate', '--build'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--build requires output.format: website');
    // The error occurs BEFORE the pipeline — nothing was generated.
    expect(existsSync(join(dir, 'docs'))).toBe(false);
  });

  it('--build together with --offline is a usage error (exit 3) with an explanation', () => {
    const dir = makeWebsiteProject();
    const result = runCli(['--offline', 'generate', '--build'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--build cannot be combined with --offline');
    expect(result.stderr).toContain('no network access');
  });

  it('exit 2 (faithfulness) is not masked to 0 by a successful build', () => {
    const dir = makeWebsiteProject();
    // The first run fills the segment cache (mock judge: no violations, exit 0) …
    const first = runCli(['generate'], dir);
    expect(first.status, first.stderr).toBe(0);

    // … then poison one cache entry: 1 violation > threshold 0.
    const cacheDir = join(dir, '.ductus', 'cache');
    const entryFile = join(cacheDir, readdirSync(cacheDir).sort()[0]!);
    const entry = JSON.parse(readFileSync(entryFile, 'utf8')) as { violations: unknown[] };
    entry.violations = [{ claim: 'Testbehauptung', reason: 'für den Exit-2-Fall' }];
    writeFileSync(entryFile, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

    const { env, logFile } = fakeNpm(dir);
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Faithfulness');
    // The build still ran to completion successfully.
    expect(readFileSync(logFile, 'utf8')).toContain('run build');
    expect(result.stdout).toContain('Website built:');
  });
});
