/**
 * Ende-zu-Ende-Tests des Adapter-CLI gegen den gebauten dist-Output —
 * Semantik-Spiegel von dart/ductus/test/cli_integration_test.dart.
 * Der Build läuft einmal pro Testdatei im beforeAll (großzügiger Timeout).
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
 * Fixture analog dart/ductus/test/fixtures/full_app: react-router-
 * Konfiguration + @journey:-Kommentare über denselben Ids.
 */
function makeFullApp(): string {
  return writeProject({
    'src/router.tsx': [
      '// Fixture: react-router-Konfiguration. Wird nur geparst (parse-only),',
      '// unaufgelöste Bezeichner sind beabsichtigt.',
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
      '// Fixture: manuelle Annotationen (Weg A) über den abgeleiteten Routen.',
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
  // Einmal pro Testdatei bauen — die CLI-Tests laufen gegen dist/ (bin-Vertrag).
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
  it('Erfolg: Exit 0, parsebares JSON, erwartete Nodes/Edges/Flows, Debug-Datei', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp]);

    expect(result.status, result.stderr).toBe(0);
    const graph = JSON.parse(result.stdout) as GraphJson;

    expect(graph.schemaVersion).toBe('1.0');
    expect(graph.meta.adapters).toEqual([{ name: 'typescript', version: adapterVersion }]);

    // Exakte Menge (Ausgabe ist nach id sortiert) — arrayContaining würde
    // Phantom-Elemente kaschieren.
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'dashboard',
      'dashboard-settings',
      'dashboard_redirect',
      'home',
      'login',
      'profile',
    ]);

    // Manuelle Annotation überschreibt abgeleiteten Screen.
    const login = graph.nodes.find((n) => n.id === 'login');
    expect(login?.title).toBe('Anmeldung');
    expect(login?.source).toBe('annotation');
    expect(login?.tags).toEqual(['auth', 'entry']); // sortiert

    expect(graph.edges.map((e) => e.id)).toEqual([
      'e_dashboard_login',
      'e_dashboard_redirect_dashboard',
      'e_dashboard_redirect_login',
      'e_login_dashboard',
      'e_profile_home',
    ]);

    expect(graph.flows.map((f) => f.id)).toEqual(['auth', 'shell-0']);

    // Nicht zuordenbare Navigation landet als Hinweis auf stderr.
    expect(result.stderr).toContain('/unbekannt');

    // Debug-Datei mit identischem Inhalt.
    const debugFile = join(fullApp, 'ductus_graph.g.json');
    expect(existsSync(debugFile)).toBe(true);
    expect(readFileSync(debugFile, 'utf8')).toBe(result.stdout);
  });

  it('Determinismus: zwei Läufe liefern byte-identisches stdout (NFR2)', () => {
    const fullApp = makeFullApp();
    const first = runCli(['--project', fullApp, '--no-debug-file']);
    const second = runCli(['--project', fullApp, '--no-debug-file']);

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(Buffer.from(second.stdout, 'utf8').equals(Buffer.from(first.stdout, 'utf8'))).toBe(true);
    // Kanonische Form: LF + abschließender Zeilenumbruch, kein Zeitstempel.
    expect(first.stdout.endsWith('}\n')).toBe(true);
    expect(first.stdout).not.toContain('\r');
    expect(first.stdout).not.toContain('generatedAt');
  });

  it('--no-debug-file unterdrückt die Debug-Datei', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp, '--no-debug-file']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(fullApp, 'ductus_graph.g.json'))).toBe(false);
  });

  it('Konflikt: Exit 1, stderr nennt beide Quellen, stdout leer', () => {
    const conflict = writeProject({
      'src/a.tsx': [
        '// Fixture: manuelle Quelle 1 für node "login".',
        '// @journey:screen id="login" title="Anmeldung A"',
        'function LoginScreenA() {',
        '  return null;',
        '}',
        '',
      ].join('\n'),
      'src/b.tsx': [
        '// Fixture: manuelle Quelle 2 für node "login" — Konflikt im Feld "title".',
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
    // Kein Graph auf stdout im Fehlerfall.
    expect(result.stdout).toBe('');
  });

  it('fehlendes --project: Exit 64 mit Usage auf stderr', () => {
    const result = runCli([]);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('--project');
    expect(result.stderr).toContain('Verwendung');
    expect(result.stdout).toBe('');
  });

  it('unbekannte Option: Exit 64 mit Usage auf stderr', () => {
    const result = runCli(['--quatsch']);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain('unbekannte Option');
    expect(result.stderr).toContain('Verwendung');
  });

  it('--config mit leerem deriveFrom schaltet Ableitungen ab', () => {
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
    // Nur manuell annotierte Nodes, keine abgeleiteten Routen.
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['dashboard', 'login']);
    expect(graph.flows.map((f) => f.id)).toEqual(['auth']);
  });

  it('--config mit include-Globs ignoriert Dateien außerhalb', () => {
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

  it('adapterVersion stimmt mit "version" in package.json überein', () => {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    // Die Konstante ist hartkodiert — beim Release-Bump beide nachziehen,
    // sonst meldet meta.adapters.version nicht mehr die tatsächliche
    // Paketversion (zugesagt ist "version: <Paketversion>").
    expect(adapterVersion).toBe(packageJson.version);
  });

  it('Ausgabe ist konform zum Journey-Graph-JSON-Schema', () => {
    const fullApp = makeFullApp();
    const result = runCli(['--project', fullApp, '--no-debug-file']);
    expect(result.status, result.stderr).toBe(0);

    const ajv = new Ajv2020({ allErrors: true });
    const validate = ajv.compile(journeyGraphJsonSchema);
    const valid = validate(JSON.parse(result.stdout));
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
