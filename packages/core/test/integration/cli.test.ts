/**
 * Ende-zu-Ende-Tests des ductus-CLI gegen den gebauten dist-Output.
 * Der Build läuft einmal pro Testdatei im beforeAll (großzügiger Timeout).
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
  // Einmal pro Testdatei bauen — die CLI-Tests laufen gegen dist/ (bin-Vertrag).
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 300_000 });
  expect(existsSync(CLI)).toBe(true);
}, 360_000);

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('ductus extract', () => {
  it('schreibt journey-graph.json byte-identisch bei zwei Läufen (NFR2)', () => {
    const dir = makeProject();

    const first = runCli(['extract'], dir);
    expect(first.status, first.stderr).toBe(0);
    const graphPath = join(dir, 'journey-graph.json');
    const bytes1 = readFileSync(graphPath);

    const second = runCli(['extract'], dir);
    expect(second.status, second.stderr).toBe(0);
    const bytes2 = readFileSync(graphPath);

    expect(bytes1.equals(bytes2)).toBe(true);
    expect(first.stdout).toContain('2 Nodes');
    expect(first.stdout).toContain('1 Edges');
    expect(first.stdout).toContain('1 Flows');
    expect(existsSync(join(dir, 'ductus-report.json'))).toBe(true);
  });

  it('meldet Validierungsfehler zeilenweise auf stderr und beendet mit Exit 1', () => {
    const dir = makeProject('dangling');
    const result = runCli(['extract'], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/V1 .*"missing"/);
    // Bei Fehlern wird kein Graph geschrieben.
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('lehnt inkompatible Adapter-schemaVersion als V6 mit Exit 1 ab (NFR7, §10.3)', () => {
    const dir = makeProject('futureversion');
    const result = runCli(['extract'], dir);
    // Validierungsfehler (Exit 1), NICHT AdapterError (Exit 3) — DD §I.
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/V6 Adapter "fake": schemaVersion "2\.0" wird nicht unterstützt/);
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('beendet mit Exit 3 bei fehlender Config bzw. Adapterfehler', () => {
    const noConfig = runCli(['-c', 'gibt-es-nicht.yaml', 'extract'], makeProject());
    expect(noConfig.status).toBe(3);
    expect(noConfig.stderr).toContain('Konfigurationsdatei nicht lesbar');

    const broken = runCli(['extract'], makeProject('fail'));
    expect(broken.status).toBe(3);
    expect(broken.stderr).toContain('Exit-Code 1');
  });
});

describe('ductus generate / check / graph', () => {
  it('generate --offline mit mock schreibt MDX mit Frontmatter und Report (Exit 0)', () => {
    const dir = makeProject();
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status, result.stderr).toBe(0);

    // Vorab-Kostenschätzung (NFR3) erscheint vor der Generierung auf stderr.
    expect(result.stderr).toMatch(/Kostenschätzung \(vorab\).*Segment/);

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

  it('generate --offline mit echtem Provider beendet mit Exit 3 (DD §B.9)', () => {
    const dir = makeProject();
    // provider anthropic statt mock:
    const config = readFileSync(join(dir, 'ductus.config.yaml'), 'utf8');
    writeFileSync(join(dir, 'ductus.config.yaml'), config.replace('provider: mock', 'provider: anthropic'));
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--offline');
  });

  it('check nach generate beendet mit Exit 0 und schreibt nichts neu', () => {
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
    expect(result.stdout).toContain('check: OK (0 Warnung(en), 0 Segment(e) noch nicht generiert)');
    // Alle Segmente sind generiert — kein Segment-Hinweis "noch nicht generiert".
    expect(result.stdout).not.toMatch(/Segment ".*": noch nicht generiert/);

    const after = watched.map((path) => statSync(path).mtimeMs);
    expect(after).toEqual(before);
  });

  it('check vor generate meldet Segmente als noch nicht generiert (Exit 0)', () => {
    const dir = makeProject();
    const result = runCli(['--offline', 'check'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('noch nicht generiert');
  });

  it('graph liefert "flowchart TD" auf stdout und schreibt keine Artefakte', () => {
    const dir = makeProject();
    const result = runCli(['graph'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('flowchart TD');
    expect(result.stdout).toContain('login');
    expect(existsSync(join(dir, 'journey-graph.json'))).toBe(false);
  });

  it('graph --journey liefert das journey-Diagramm des Flow-Hauptpfads statt des Flowcharts', () => {
    const dir = makeProject('flowfull');
    const result = runCli(['graph', '--journey'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      ['journey', '  title Anmeldung', '  section Hauptpfad', '    Login: 3', '    Dashboard: 3', ''].join('\n'),
    );
  });

  it('graph --journey ohne Hauptpfad ≥ 2 Knoten gibt nur einen Hinweis auf stderr (Exit 0)', () => {
    // Im Standard-Graphen gehört nur "login" zum Flow — der Hauptpfad hat 1 Knoten.
    const dir = makeProject();
    const result = runCli(['graph', '--journey'], dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Hinweis: kein journey-Diagramm');
    expect(result.stdout).toBe('');
  });
});

describe('ductus init', () => {
  it('legt eine Config an, erkennt pubspec.yaml und verweigert Überschreiben', () => {
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

    // Zweiter Lauf ohne --force: Exit ≠ 0, Datei bleibt unverändert.
    const second = runCli(['init'], dir);
    expect(second.status).toBe(3);
    expect(second.stderr).toContain('existiert bereits');
    expect(readFileSync(configPath, 'utf8')).toBe(written);

    // Mit --force wird überschrieben.
    const forced = runCli(['init', '--force'], dir);
    expect(forced.status, forced.stderr).toBe(0);
  });
});

describe('ductus generate (Website-Modus, generator journey — DD §O)', () => {
  /**
   * Projekt mit output.format website; ohne generator-Zeile greift der
   * Default 'journey'. Das Template wird über den Repo-Fallback
   * templates/journey aufgelöst (resolveTemplateDir, §9.2).
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

  it('schreibt das journey-Scaffold mit ductus.data.json gemäß Datenvertrag — keine MDX/Sidebar/Site-Dateien', () => {
    // 'flowfull': beide Screens im Flow "auth" ⇒ Hauptpfad login → dashboard.
    const dir = makeJourneyProject('flowfull');
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status, result.stderr).toBe(0);

    const siteDir = join(dir, 'site');
    // Template kopiert; gitignore → .gitignore umbenannt.
    for (const file of ['package.json', 'astro.config.mjs', '.gitignore']) {
      expect(existsSync(join(siteDir, file)), `${file} fehlt`).toBe(true);
    }
    expect(existsSync(join(siteDir, 'gitignore'))).toBe(false);
    // Einzige Daten-Datei ist ductus.data.json — keine Starlight-Artefakte.
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
    // ductusVersion zur Laufzeit aus der package.json von @ductus/core (kein Hardcoding).
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
    // Hauptpfad-Kante trägt den 0-basierten Index; start-Flag nur am Start-Node.
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

  it('schreibt ductus.data.json byte-identisch bei zwei Läufen (NFR2)', () => {
    const dir = makeJourneyProject('flowfull');
    expect(runCli(['--offline', 'generate'], dir).status).toBe(0);
    const dataPath = join(dir, 'site', 'ductus.data.json');
    const bytes1 = readFileSync(dataPath);

    const second = runCli(['--offline', 'generate'], dir);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(dataPath).equals(bytes1)).toBe(true);
  });

  it('lehnt generator docusaurus in Phase 1 mit Exit 3 ab (Guard in runGenerate)', () => {
    const dir = makeJourneyProject(undefined, 'docusaurus');
    const result = runCli(['--offline', 'generate'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('docusaurus');
    expect(result.stderr).toMatch(/journey.*starlight/);
    // Vor dem Guard wurde kein Site-Scaffold erzeugt.
    expect(existsSync(join(dir, 'site'))).toBe(false);
  });
});

describe('ductus generate --build', () => {
  const FAKE_NPM = join(ROOT, 'packages', 'core', 'test', 'fixtures', 'fake-npm.mjs');

  /** Projekt mit output.format website (Site-Wurzel: <dir>/site). */
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
        // Explizit 'starlight' (Default ist 'journey', DD §O) — diese Tests
        // prüfen die Build-Kette gegen das Starlight-Preset.
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
   * Fake-npm via PATH-Prepend (kein echtes npm, offline): protokolliert jeden
   * Aufruf als "<cwd>\t<argumente>" und scheitert optional bei einem Schritt.
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

  /** Wie runCli, aber mit eigener Umgebung (PATH mit Fake-npm). */
  function runCliWithEnv(args: string[], cwd: string, env: NodeJS.ProcessEnv): CliResult {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('ruft npm install und npm run build in dieser Reihenfolge im Site-Verzeichnis auf', () => {
    const dir = makeWebsiteProject();
    const { env, logFile } = fakeNpm(dir);
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status, result.stderr).toBe(0);

    // macOS: /var → /private/var — cwd des Kindprozesses ist der reale Pfad.
    const siteDir = join(realpathSync(dir), 'site');
    const calls = readFileSync(logFile, 'utf8').trim().split('\n');
    expect(calls).toEqual([`${siteDir}\tinstall`, `${siteDir}\trun build`]);
    expect(result.stdout).toContain(`Website gebaut: ${join(siteDir, 'dist')}`);
  });

  it('nutzt npm ci statt install, wenn das Site-Verzeichnis eine package-lock.json enthält', () => {
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

  it('meldet den gescheiterten npm-Schritt und beendet mit Exit 3', () => {
    const dir = makeWebsiteProject();
    const { env, logFile } = fakeNpm(dir, 'install');
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('"npm install" scheiterte mit Exit-Code 1');
    expect(result.stdout).not.toContain('Website gebaut');
    // Nach dem gescheiterten install folgt kein run build mehr.
    expect(readFileSync(logFile, 'utf8')).not.toContain('run build');
  });

  it('--build bei output.format mdx ist ein Usage-Fehler (Exit 3, kein stiller Fallback)', () => {
    const dir = makeProject();
    const result = runCli(['generate', '--build'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--build erfordert output.format: website');
    // Der Fehler kommt VOR der Pipeline — es wurde nichts generiert.
    expect(existsSync(join(dir, 'docs'))).toBe(false);
  });

  it('--build zusammen mit --offline ist ein Usage-Fehler (Exit 3) mit Begründung', () => {
    const dir = makeWebsiteProject();
    const result = runCli(['--offline', 'generate', '--build'], dir);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('--build kann nicht mit --offline kombiniert werden');
    expect(result.stderr).toContain('kein Netzzugriff');
  });

  it('Exit 2 (Faithfulness) wird durch einen erfolgreichen Build nicht auf 0 maskiert', () => {
    const dir = makeWebsiteProject();
    // Erster Lauf füllt den Segment-Cache (mock-Judge: keine Verstöße, Exit 0) …
    const first = runCli(['generate'], dir);
    expect(first.status, first.stderr).toBe(0);

    // … dann einen Cache-Eintrag vergiften: 1 Violation > Schwellwert 0.
    const cacheDir = join(dir, '.ductus', 'cache');
    const entryFile = join(cacheDir, readdirSync(cacheDir).sort()[0]!);
    const entry = JSON.parse(readFileSync(entryFile, 'utf8')) as { violations: unknown[] };
    entry.violations = [{ claim: 'Testbehauptung', reason: 'für den Exit-2-Fall' }];
    writeFileSync(entryFile, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

    const { env, logFile } = fakeNpm(dir);
    const result = runCliWithEnv(['generate', '--build'], dir, env);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Faithfulness');
    // Der Build lief trotzdem vollständig und erfolgreich durch.
    expect(readFileSync(logFile, 'utf8')).toContain('run build');
    expect(result.stdout).toContain('Website gebaut:');
  });
});
