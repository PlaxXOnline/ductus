import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('passes the adapter graph through (stdout → JourneyGraph)', async () => {
    const result = await runAdapter(fakeEntry(undefined), { rootDir: makeRootDir() });

    expect(result.graph.schemaVersion).toBe('1.0');
    expect(result.graph.nodes.map((n) => n.id)).toEqual(['dashboard', 'login']);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.meta?.adapters).toEqual([{ name: 'fake', version: '1.0.0' }]);
    expect(result.adapter.name).toBe('fake');
  });

  it('writes deriveFrom + extra to the temporary --config file', async () => {
    const logs: string[] = [];
    const entry = fakeEntry(undefined, {
      deriveFrom: ['go_router'],
      extra: { include: ['lib/**'] },
    });
    const result = await runAdapter(entry, { rootDir: makeRootDir(), log: (m) => logs.push(m) });

    // The fake adapter mirrors the config content to stderr (diagnostics).
    const match = /fake-adapter config: ([\s\S]*)/.exec(result.diagnostics);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual({ deriveFrom: ['go_router'], include: ['lib/**'] });
    // stderr is forwarded to log.
    expect(logs.some((line) => line.includes('fake-adapter config:'))).toBe(true);
  });

  it('throws AdapterError with a stderr excerpt on exit code ≠ 0', async () => {
    await expect(runAdapter(fakeEntry('fail'), { rootDir: makeRootDir() })).rejects.toThrowError(
      AdapterError,
    );
    await expect(runAdapter(fakeEntry('fail'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /intentional failure/,
    );
  });

  it('throws AdapterError when stdout is not valid JSON (A3)', async () => {
    await expect(runAdapter(fakeEntry('badjson'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /stdout is not valid JSON/,
    );
  });

  it('tolerates leading pub diagnostic lines on stdout and forwards them as diagnostics', async () => {
    // With an unresolved package context, `dart run`/`dart pub global run`
    // write "Resolving dependencies..." etc. to stdout before the adapter
    // runs — the runner only trims this preamble but does not swallow it.
    const logs: string[] = [];
    const result = await runAdapter(fakeEntry('pubnoise'), {
      rootDir: makeRootDir(),
      log: (m) => logs.push(m),
    });

    expect(result.graph.nodes.map((n) => n.id)).toEqual(['dashboard', 'login']);
    expect(result.diagnostics).toContain('Resolving dependencies...');
    expect(logs.some((line) => line.includes('(pub) Resolving dependencies...'))).toBe(true);
  });

  it('throws AdapterError when the output violates the schema (A3)', async () => {
    await expect(runAdapter(fakeEntry('invalid'), { rootDir: makeRootDir() })).rejects.toThrowError(
      /violates the graph schema/,
    );
  });

  it('throws AdapterError for a non-executable command', async () => {
    const entry: AdapterConfigEntry = {
      name: 'fake',
      project: '.',
      command: 'ductus-does-not-exist-xyz',
    };
    await expect(runAdapter(entry, { rootDir: makeRootDir() })).rejects.toThrowError(AdapterError);
  });

  it('throws AdapterError for unknown adapters without a command', async () => {
    const entry: AdapterConfigEntry = { name: 'cobol', project: '.' };
    await expect(runAdapter(entry, { rootDir: makeRootDir() })).rejects.toThrowError(
      /no built-in resolution/,
    );
  });

  it('typescript: uses ductus-adapter-typescript from node_modules/.bin next to the config', async () => {
    // Binary stub in node_modules/.bin that runs the fake adapter.
    const rootDir = makeRootDir();
    const binDir = join(rootDir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const binary = join(binDir, 'ductus-adapter-typescript');
    writeFileSync(binary, `#!/bin/sh\nexec node "${FIXTURE}" "$@"\n`, { mode: 0o755 });

    const entry: AdapterConfigEntry = { name: 'typescript', project: '.' };
    const result = await runAdapter(entry, { rootDir });
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(['dashboard', 'login']);
  });

  it('typescript: AdapterError with installation hint when the binary is missing', async () => {
    const entry: AdapterConfigEntry = { name: 'typescript', project: '.' };
    const previousPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      await expect(runAdapter(entry, { rootDir: makeRootDir() })).rejects.toThrowError(
        /@ductus\/adapter-typescript/,
      );
    } finally {
      process.env['PATH'] = previousPath;
    }
  });
});

// ─── Resolution chain for the Dart invocation (build-free, no pub get in the target) ───
//
// Chain 4 (`dart pub global run`) is simulated here exclusively via the
// injectable check — the global pub state is NEVER modified in tests.
describe('resolveDartInvocation (resolution chain)', () => {
  /** Writes a pubspec.yaml into a fresh temp project. */
  function makeProjectWithPubspec(pubspec: string | undefined): string {
    const dir = makeRootDir();
    if (pubspec !== undefined) writeFileSync(join(dir, 'pubspec.yaml'), pubspec, 'utf8');
    return dir;
  }

  const notActivated = { getGlobalActivation: () => ({ activated: false }) };

  it('chain 2: DUCTUS_DART_ADAPTER_DIR ⇒ dart run with cwd = adapter directory', () => {
    const adapterDir = makeRootDir();
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: { DUCTUS_DART_ADAPTER_DIR: adapterDir },
      ...notActivated,
    });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(adapterDir);
  });

  it('chain 2: non-existent directory ⇒ AdapterError naming the variable', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    expect(() =>
      resolveDartInvocation(projectDir, {
        env: { DUCTUS_DART_ADAPTER_DIR: join(projectDir, 'gibt-es-nicht') },
        ...notActivated,
      }),
    ).toThrowError(/DUCTUS_DART_ADAPTER_DIR/);
  });

  it('chain 3: pubspec with ductus under dev_dependencies ⇒ cwd = project', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dev_dependencies:', '  flutter_test:', '    sdk: flutter', '  ductus: ^0.1.0', ''].join('\n'),
    );
    const result = resolveDartInvocation(projectDir, { env: {}, ...notActivated });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('chain 3: pubspec with ductus under dependencies (path dependency) ⇒ cwd = project', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dependencies:', '  ductus:', '    path: ../ductus', ''].join('\n'),
    );
    const result = resolveDartInvocation(projectDir, { env: {}, ...notActivated });
    expect(result.cwd).toBe(projectDir);
  });

  it('chain 3 does NOT apply to "ductus" outside the dependency blocks', () => {
    const projectDir = makeProjectWithPubspec(
      ['name: demo', 'dev_dependencies:', '  flutter_test:', '    sdk: flutter', 'flutter:', '  ductus: nope', ''].join('\n'),
    );
    expect(() => resolveDartInvocation(projectDir, { env: {}, ...notActivated })).toThrowError(
      AdapterError,
    );
  });

  it('chain 4 (simulated): hosted activation ⇒ dart pub global run (snapshot, stdout-clean)', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true }),
    });
    expect(result.argv).toEqual(['dart', 'pub', 'global', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('chain 4 (simulated): path activation ⇒ dart run with cwd = source directory', () => {
    // With `dart pub global activate --source path`, `dart pub global run`
    // would write pub resolution lines to stdout (a contract violation: only
    // the single graph JSON may appear there) — so the adapter runs directly
    // in the activated source directory instead.
    const activatedPath = makeRootDir();
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true, path: activatedPath }),
    });
    expect(result.argv).toEqual(['dart', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(activatedPath);
  });

  it('chain 4 (simulated): path activation with a vanished directory ⇒ fallback pub global run', () => {
    const projectDir = makeProjectWithPubspec('name: demo\n');
    const result = resolveDartInvocation(projectDir, {
      env: {},
      getGlobalActivation: () => ({ activated: true, path: join(projectDir, 'weg') }),
    });
    expect(result.argv).toEqual(['dart', 'pub', 'global', 'run', 'ductus:adapter']);
    expect(result.cwd).toBe(projectDir);
  });

  it('the error message names both options when no chain applies', () => {
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
