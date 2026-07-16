/**
 * End-to-end tests of the adapter CLI against the built dist output —
 * semantic mirror of dart/ductus/test/cli_integration_test.dart.
 * The build runs once per test file in beforeAll (generous timeout).
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { journeyGraphJsonSchema } from '@ductus/schema';
import { adapterVersion } from '../src/graph-model.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'adapter-typescript');
const CLI = join(PACKAGE_DIR, 'dist', 'cli.js');

const tmpRoots: string[] = [];

function writeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-adapter-ts-cli-'));
  tmpRoots.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

/**
 * Fixture analogous to dart/ductus/test/fixtures/full_app: react-router
 * configuration + @journey: comments over the same ids.
 */
function makeFullApp(): string {
  return writeProject({
    'src/router.tsx': [
      '// Fixture: react-router configuration. Only parsed (parse-only),',
      '// unresolved identifiers are intentional.',
      '',
      'const router = createBrowserRouter([',
      '  {',
      "    path: '/login',",
      '    element: <LoginScreen />,',
      '  },',
      '  {',
      "    path: '/dashboard',",
      '    element: <DashboardScreen />,',
      '    loader: () => {',
      '      if (!isLoggedIn) {',
      "        return redirect('/login');",
      '      }',
      '      return null;',
      '    },',
      '    children: [',
      '      {',
      "        path: 'settings/:tab',",
      '        element: <SettingsScreen />,',
      '      },',
      '    ],',
      '  },',
      '  {',
      '    element: <AppShell />,',
      '    children: [',
      '      {',
      "        path: '/home',",
      '        element: <HomeScreen />,',
      '      },',
      '      {',
      "        path: '/profile',",
      '        element: <ProfileScreen />,',
      '      },',
      '    ],',
      '  },',
      ']);',
      '',
    ].join('\n'),
    'src/screens.tsx': [
      '// Fixture: manual annotations (path A) over the derived routes.',
      '',
      '// @journey:flow id="auth" title="Anmeldung & Registrierung" start="login"',
      '',
      '// @journey:screen id="login" title="Anmeldung" flow="auth"',
      '//   description="Bildschirm, auf dem sich der Nutzer anmeldet."',
      '//   tags="entry, auth"',
      'function LoginScreen() {',
      '  // @journey:action label="Anmelden" to="dashboard" trigger="submit" condition="Zugangsdaten gültig"',
      '  return null;',
      '}',
      '',
      'function ProfileScreen() {',
      '  const navigate = useNavigate();',
      '  return (',
      '    <div>',
      "      <button onClick={() => navigate('/home')}>Home</button>",
      "      <button onClick={() => navigate('/unbekannt')}>Kaputt</button>",
      '    </div>',
      '  );',
      '}',
      '',
      '// @journey:screen id="dashboard" title="Übersicht"',
      '//   description="Zentrale Übersicht nach der Anmeldung."',
      'function DashboardScreen() {',
      '  // @journey:action label="Abmelden" to="login" trigger="tap"',
      '  return null;',
      '}',
      '',
    ].join('\n'),
  });
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface GraphJson {
  schemaVersion: string;
  flows: Array<{ id: string; title?: string; start?: string }>;
  nodes: Array<{ id: string; title?: string; source?: string; tags?: string[]; flow?: string }>;
  edges: Array<{ id: string; from: string; to: string }>;
  meta: { adapters: Array<{ name: string; version: string }> };
}

beforeAll(() => {
  // Build once per test file — the CLI tests run against dist/ (bin contract).
  execSync('npm run build', {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    timeout: 300_000,
  });
  expect(existsSync(CLI)).toBe(true);
}, 360_000);

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('ductus-adapter-typescript', () => {
  it('success: exit 0, parseable JSON, expected nodes/edges/flows, debug file', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp]);

    expect(result.status, result.stderr).toBe(0);
    const graph = JSON.parse(result.stdout) as GraphJson;

    expect(graph.schemaVersion).toBe('1.0');
    expect(graph.meta.adapters).toEqual([{ name: 'typescript', version: adapterVersion }]);

    // Exact set (output is sorted by id) — arrayContaining would mask
    // phantom elements.
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'dashboard',
      'dashboard-settings',
      'dashboard_redirect',
      'home',
      'login',
      'profile',
    ]);

    // Manual annotation overrides the derived screen.
    const login = graph.nodes.find((n) => n.id === 'login');
    expect(login?.title).toBe('Anmeldung');
    expect(login?.source).toBe('annotation');
    expect(login?.tags).toEqual(['auth', 'entry']); // sorted

    expect(graph.edges.map((e) => e.id)).toEqual([
      'e_dashboard_login',
      'e_dashboard_redirect_dashboard',
      'e_dashboard_redirect_login',
      'e_login_dashboard',
      'e_profile_home',
    ]);

    expect(graph.flows.map((f) => f.id)).toEqual(['auth', 'shell-0']);

    // Unmappable navigation ends up as a note on stderr.
    expect(result.stderr).toContain('/unbekannt');

    // Debug file with identical content.
    const debugFile = join(fullApp, 'ductus_graph.g.json');
    expect(existsSync(debugFile)).toBe(true);
    expect(readFileSync(debugFile, 'utf8')).toBe(result.stdout);
  });

  it('determinism: two runs produce byte-identical stdout (NFR2)', () => {
    const fullApp = makeFullApp();
    const first = runCli(['--project', fullApp, '--no-debug-file']);
    const second = runCli(['--project', fullApp, '--no-debug-file']);

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(Buffer.from(second.stdout, 'utf8').equals(Buffer.from(first.stdout, 'utf8'))).toBe(true);
    // Canonical form: LF + trailing newline, no timestamp.
    expect(first.stdout.endsWith('}\n')).toBe(true);
    expect(first.stdout).not.toContain('\r');
    expect(first.stdout).not.toContain('generatedAt');
  });

  it('--no-debug-file suppresses the debug file', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp, '--no-debug-file']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(fullApp, 'ductus_graph.g.json'))).toBe(false);
  });

  it('conflict: exit 1, stderr cites both sources, stdout empty', () => {
    const conflict = writeProject({
      'src/a.tsx': [
        '// Fixture: manual source 1 for node "login".',
        '// @journey:screen id="login" title="Anmeldung A"',
        'function LoginScreenA() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
      'src/b.tsx': [
        '// Fixture: manual source 2 for node "login" — conflict in field "title".',
        '// @journey:screen id="login" title="Anmeldung B"',
        'function LoginScreenB() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    });
    const result = runCli(['--project', conflict]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/a.tsx:2');
    expect(result.stderr).toContain('src/b.tsx:2');
    expect(result.stderr).toContain('title');
    // No graph on stdout in the error case.
    expect(result.stdout).toBe('');
  });

  it('missing --project: exit 64 with usage on stderr', () => {
    const result = runCli([]);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('--project');
    expect(result.stderr).toContain('Usage');
    expect(result.stdout).toBe('');
  });

  it('unknown option: exit 64 with usage on stderr', () => {
    const result = runCli(['--bogus']);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('unknown option');
    expect(result.stderr).toContain('Usage');
  });

  it('--config with empty deriveFrom disables derivations', () => {
    const fullApp = makeFullApp();
    const configDir = writeProject({ 'config.json': '{"deriveFrom": []}' });

    const result = runCli([
      '--project',
      fullApp,
      '--config',
      join(configDir, 'config.json'),
      '--no-debug-file',
    ]);

    expect(result.status, result.stderr).toBe(0);
    const graph = JSON.parse(result.stdout) as GraphJson;
    // Only manually annotated nodes, no derived routes.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['dashboard', 'login']);
    expect(graph.flows.map((f) => f.id)).toEqual(['auth']);
  });

  it('--config with include globs ignores files outside them', () => {
    const project = writeProject({
      'app/extra.tsx': [
        '// @journey:screen id="extra" title="Extra"',
        'function ExtraScreen() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
      'src/main.tsx': [
        '// @journey:screen id="haupt" title="Haupt"',
        'function HauptScreen() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    });
    const configDir = writeProject({ 'config.json': '{"include": ["app/**"]}' });

    const result = runCli([
      '--project',
      project,
      '--config',
      join(configDir, 'config.json'),
      '--no-debug-file',
    ]);

    expect(result.status, result.stderr).toBe(0);
    const graph = JSON.parse(result.stdout) as GraphJson;
    expect(graph.nodes.map((n) => n.id)).toEqual(['extra']);
  });

  it('adapterVersion matches "version" in package.json', () => {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    // The constant is hard-coded — update both on a release bump, otherwise
    // meta.adapters.version no longer reports the actual package version
    // (the contract is "version: <package version>").
    expect(adapterVersion).toBe(packageJson.version);
  });

  it('output conforms to the journey graph JSON schema', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp, '--no-debug-file']);
    expect(result.status, result.stderr).toBe(0);

    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(journeyGraphJsonSchema);
    const valid = validate(JSON.parse(result.stdout));
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
