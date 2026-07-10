import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AdapterError, resolveDartInvocation, runAdapter } from '../../src/adapters/runner.js';
import type { AdapterConfigEntry } from '../../src/contracts.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-adapter.mjs');

const tmpRoots: string[] = [];

function makeRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-runner-test-'));
  tmpRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function fakeEntry(mode: string | undefined, partial: Partial<AdapterConfigEntry> = {}): AdapterConfigEntry {
  return {
    name: 'fake',
    project: '.',
    command: `node ${FIXTURE}${mode !== undefined ? ` ${mode}` : ''}`,
    ...partial,
  };
}

describe('runAdapter', () => {
  it('reicht den Graphen des Adapters durch (stdout → JourneyGraph)', async () => {
    const result = await runAdapter(fakeEntry(undefined), { rootDir: makeRootDir() });

    expect(result.graph.schemaVersion).toBe('1.0');
    expect(result.graph.nodes.map((n) => n.id)).toEqual(['dashboard', 'login']);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.meta?.adapters).toEqual([{ name: 'fake', version: '1.0.0' }]);
    expect(result.adapter.name).toBe('fake');
  });

  it('schreibt deriveFrom + extra in die temporäre --config-Datei', async () => {
    const logs: string[] = [];
    const entry = fakeEntry(undefined, {
      deriveFrom: ['go_router'],
      extra: { include: ['lib/**'] },
    });
    const result = await runAdapter(entry, { rootDir: makeRootDir(), log: (m) => logs.push(m) });

    // Der Fake-Adapter spiegelt den Config-Inhalt auf stderr (diagnostics).
    const match = /fake-adapter config: ([\s\S]*)/.exec(result.diagnostics);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual({ deriveFrom: ['go_router'], include: ['lib/**'] });
    // stderr wird an log durchgereicht.
    expect(logs.some((line) => line.includes('fake-adapter config:'))).toBe(true);
  });

  it('wirft AdapterError mit stderr-Auszug bei Exit-Code ≠ 0', async () => {
    await expect(runAdapter(fakeEntry('fail'), { rootDir: makeRootDir() })).rejects.toThrowError(
      AdapterError,
    );
    await expect(runAdapter(fakeEntry('fail'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /absichtlicher Fehler/,
    );
  });

  it('wirft AdapterError, wenn stdout kein valides JSON ist (A3)', async () => {
    await expect(runAdapter(fakeEntry('badjson'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /kein gültiges JSON/,
    );
  });

  it('toleriert führende pub-Diagnosezeilen auf stdout und reicht sie als Diagnostik durch', async () => {
    // `dart run`/`dart pub global run` schreiben bei unaufgelöstem Paketkontext
    // "Resolving dependencies..." etc. auf stdout, bevor der Adapter läuft —
    // der Runner schneidet nur diesen Vorspann ab, verschluckt ihn aber nicht.
    const logs: string[] = [];
    const result = await runAdapter(fakeEntry('pubnoise'), {
      rootDir: makeRootDir(),
      log: (m) => logs.push(m),
    });

    expect(result.graph.nodes.map((n) => n.id)).toEqual(['dashboard', 'login']);
    expect(result.diagnostics).toContain('Resolving dependencies...');
    expect(logs.some((line) => line.includes('(pub) Resolving dependencies...'))).toBe(true);
  });

  it('wirft AdapterError bei Schema-Verstoß der Ausgabe (A3)', async () => {
    await expect(runAdapter(fakeEntry('invalid'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /verletzt das Graph-Schema/,
    );
  });

  it('wirft AdapterError bei nicht ausführbarem Befehl', async () => {
    const entry: AdapterConfigEntry = {
      name: 'fake',
      project: '.',
      command: 'ductus-does-not-exist-xyz',
    };
    await expect(runAdapter(entry, { rootDir: makeRootDir() })).rejects.toThrowError(AdapterError);
  });

  it('wirft AdapterError für unbekannte Adapter ohne command', async () => {
    const entry: AdapterConfigEntry = { name: 'cobol', project: '.' };
    await expect(runAdapter(entry, { rootDir: makeRootDir() })).rejects.toThrowError(
      /keine eingebaute Auflösung/,
    );
  });
});

// ──── Auflösungskette für den Dart-Aufruf (buildfrei, ohne pub get im Ziel) ───
//
// Kette 4 (`dart pub global run`) wird hier ausschließlich über die injizierbare
// Prüfung simuliert — der globale pub-Zustand wird in Tests NIE verändert.
describe('resolveDartInvocation (Auflösungskette)', () => {
  /** Schreibt eine pubspec.yaml in ein frisches Temp-Projekt. */
  function makeProjectWithPubspec(pubspec: string | undefined): string {
    const dir = makeRootDir();
    if (pubspec !== undefined) writeFileSync(join(dir, 'pubspec.yaml'), pubspec, 'utf8');
    return dir;
  }

  const notActivated = { getGlobalActivation: () => ({ activated: false }) };

  it('Kette 2: DUCTUS_DART_ADAPTER_DIR ⇒ dart run mit cwd = Adapter-Verzeichnis', () => {
    const adapterDir = makeRootDir();
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: { DUCTUS_DART_ADAPTER_DIR: adapterDir },
      ...notActivated,
    });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(adapterDir);
  });

  it('Kette 2: nicht existierendes Verzeichnis ⇒ AdapterError mit Variablennamen', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    expect(() =>
      resolveDartInvocation(projectDir, {
        env: { DUCTUS_DART_ADAPTER_DIR: join(projectDir, 'gibt-es-nicht') },
        ...notActivated,
      }),
    ).toThrowError(/DUCTUS_DART_ADAPTER_DIR/);
  });

  it('Kette 3: pubspec mit ductus unter dev_dependencies ⇒ cwd = Projekt', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dev_dependencies:', '  flutter_test:', '    sdk: flutter', '  ductus: ^0.1.0', ''].join('\n'),
    );
    const result = resolveDartInvocation(projectDir, { env: {}, ...notActivated });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('Kette 3: pubspec mit ductus unter dependencies (path-Dependency) ⇒ cwd = Projekt', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dependencies:', '  ductus:', '    path: ../ductus', ''].join('\n'),
    );
    const result = resolveDartInvocation(projectDir, { env: {}, ...notActivated });
    expect(result.cwd).toBe(projectDir);
  });

  it('Kette 3 greift NICHT für "ductus" außerhalb der Dependency-Blöcke', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dev_dependencies:', '  flutter_test:', '    sdk: flutter', 'flutter:', '  ductus: nope', ''].join('\n'),
    );
    expect(() => resolveDartInvocation(projectDir, { env: {}, ...notActivated })).toThrowError(
      AdapterError,
    );
  });

  it('Kette 4 (simuliert): hosted-Aktivierung ⇒ dart pub global run (Snapshot, stdout-sauber)', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true }),
    });
    expect(result.argv).toEqual(['dart', 'pub', 'global', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('Kette 4 (simuliert): path-Aktivierung ⇒ dart run mit cwd = Quellverzeichnis', () => {
    // Bei `dart pub global activate --source path` würde `dart pub global run`
    // pub-Resolutionszeilen auf stdout schreiben (Vertragsverletzung: dort
    // darf nur das eine Graph-JSON stehen) — deshalb
    // läuft der Adapter direkt im aktivierten Quellverzeichnis.
    const activatedPath = makeRootDir();
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true, path: activatedPath }),
    });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(activatedPath);
  });

  it('Kette 4 (simuliert): path-Aktivierung mit verschwundenem Verzeichnis ⇒ Fallback pub global run', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true, path: join(projectDir, 'weg') }),
    });
    expect(result.argv).toEqual(['dart', 'pub', 'global', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('Fehlermeldung nennt beide Optionen, wenn keine Kette greift', () => {
    const projectDir = makeProjectWithPubspec(undefined);
    let caught: unknown;
    try {
      resolveDartInvocation(projectDir, { env: {}, ...notActivated });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    const message = (caught as AdapterError).message;
    expect(message).toContain('dart pub add dev:ductus');
    expect(message).toContain('dart pub global activate ductus');
    expect(message).toContain('DUCTUS_DART_ADAPTER_DIR');
  });
});
