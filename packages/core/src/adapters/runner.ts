/**
 * Adapter runner: executes an adapter command according to the adapter
 * contract (stdout = exactly one graph JSON, stderr = diagnostics,
 * exit 0/≠0), collects both, and checks the output syntactically against
 * the graph schema (A3).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JourneyGraph } from '@ductus/schema';
import { journeyGraphJsonSchema } from '@ductus/schema';
import type { AdapterConfigEntry, AdapterRunResult } from '../contracts.js';

/** Adapter error ⇒ exit code 3 (like LLM/configuration errors). */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

const ADAPTER_TIMEOUT_MS = 120_000;
const STDERR_EXCERPT_CHARS = 800;

// Dedicated Ajv instance (the schema carries an $id — do not risk a double
// registration with the instance from graph/validate.ts).
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAdapterOutput = ajv.compile<JourneyGraph>(
  journeyGraphJsonSchema as unknown as Record<string, unknown>,
);

export interface RunAdapterOptions {
  /** Directory of ductus.config.yaml (base for relative paths). */
  rootDir: string;
  /** Adapters run locally — offline does not restrict them (NFR4). */
  offline?: boolean;
  log?: (message: string) => void;
}

/** Trims stderr to a readable excerpt for error messages. */
function stderrExcerpt(diagnostics: string): string {
  const trimmed = diagnostics.trim();
  if (trimmed === '') return '(no stderr output)';
  return trimmed.length <= STDERR_EXCERPT_CHARS ? trimmed : `…${trimmed.slice(-STDERR_EXCERPT_CHARS)}`;
}

/** Looks for a binary in <rootDir>/node_modules/.bin and in the PATH. */
function findBinary(name: string, rootDir: string): string | undefined {
  const local = join(rootDir, 'node_modules', '.bin', name);
  if (existsSync(local)) return local;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir !== '' && existsSync(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

/**
 * Simple YAML check (chain 3 of the resolution): does the target project's
 * pubspec.yaml declare `ductus` under dependencies/dev_dependencies? A line
 * scan is enough — the only question is "is the package resolvable?", not
 * full YAML parsing.
 */
function pubspecDeclaresDuctus(projectDir: string): boolean {
  const pubspecPath = join(projectDir, 'pubspec.yaml');
  if (!existsSync(pubspecPath)) return false;
  let inDependencies = false;
  for (const line of readFileSync(pubspecPath, 'utf8').split('\n')) {
    if (/^(dependencies|dev_dependencies)\s*:/.test(line)) {
      inDependencies = true;
      continue;
    }
    // A new top-level key ends the (dev_)dependencies block.
    if (/^\S/.test(line)) inDependencies = false;
    if (inDependencies && /^\s+ductus\s*:/.test(line)) return true;
  }
  return false;
}

/** Result of the read-only query of the global pub activation (chain 4). */
export interface GlobalActivation {
  activated: boolean;
  /** Source directory for `dart pub global activate --source path`. */
  path?: string;
}

/**
 * Checks READ-ONLY whether `ductus` is globally activated (chain 4) —
 * `dart pub global list` does not modify the global pub state.
 * For a path activation, pub includes the source (`ductus 0.1.0 at path "…"`).
 */
function ductusGlobalActivation(): GlobalActivation {
  const result = spawnSync('dart', ['pub', 'global', 'list'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) return { activated: false };
  const match = /^ductus\s+\S+(?:\s+at path\s+"([^"]+)")?/m.exec(result.stdout ?? '');
  if (match === null) return { activated: false };
  return { activated: true, ...(match[1] !== undefined ? { path: match[1] } : {}) };
}

/** Injectable parts of the Dart resolution for tests (never touch the global pub state). */
export interface DartResolutionOptions {
  /** Environment variables (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Query for chain 4 (default: `dart pub global list`, read-only). */
  getGlobalActivation?: () => GlobalActivation;
}

/**
 * Resolution chain for `dart run ductus:adapter` WITHOUT a build dependency
 * in the target project (the comment-based route should stay build-free) —
 * implemented identically in the npm wrapper:
 *   2. DUCTUS_DART_ADAPTER_DIR: package context that knows `ductus` ⇒ cwd = that directory.
 *   3. Target project declares `ductus` in its pubspec.yaml ⇒ cwd = project.
 *   4. Globally activated package: for a path activation, `dart run` with cwd =
 *      source directory (avoids pub resolution lines on stdout), otherwise
 *      `dart pub global run ductus:adapter` (snapshot, stdout-clean).
 * (Chain 1, entry.command, is handled upfront by resolveCommand.)
 */
export function resolveDartInvocation(
  projectDir: string,
  opts: DartResolutionOptions = {},
): { argv: string[]; cwd: string } {
  const env = opts.env ?? process.env;
  const adapterDir = env['DUCTUS_DART_ADAPTER_DIR'];
  if (adapterDir !== undefined && adapterDir.trim() !== '') {
    const dir = resolve(adapterDir.trim());
    if (!existsSync(dir)) {
      throw new AdapterError(
        `Adapter "dart": DUCTUS_DART_ADAPTER_DIR points to a non-existent directory: "${dir}".`,
      );
    }
    return { argv: ['dart', 'run', 'ductus:adapter'], cwd: dir };
  }
  if (pubspecDeclaresDuctus(projectDir)) {
    return { argv: ['dart', 'run', 'ductus:adapter'], cwd: projectDir };
  }
  const activation = (opts.getGlobalActivation ?? ductusGlobalActivation)();
  if (activation.activated) {
    if (activation.path !== undefined && existsSync(activation.path)) {
      return { argv: ['dart', 'run', 'ductus:adapter'], cwd: activation.path };
    }
    return { argv: ['dart', 'pub', 'global', 'run', 'ductus:adapter'], cwd: projectDir };
  }
  throw new AdapterError(
    'Adapter "dart": `ductus:adapter` cannot be resolved — the target project does not ' +
      'declare `ductus` and the package is not globally activated. Options: ' +
      '`dart pub add dev:ductus` in the target project OR `dart pub global activate ductus` ' +
      '(alternatively set DUCTUS_DART_ADAPTER_DIR to a directory with a ductus package context).',
  );
}

/**
 * Resolution for the TypeScript adapter — the adapter itself runs in Node:
 *   1. Package resolution via require.resolve from the target project or from
 *      the config directory (incl. parent node_modules/hoisting) ⇒ the CLI
 *      module is started directly with our own Node — platform-neutral, no
 *      shell shim needed (Windows: the .bin shims cannot be spawned without
 *      a shell).
 *   2. Binary `ductus-adapter-typescript` in node_modules/.bin or in the PATH
 *      (installed globally).
 */
export function resolveTypescriptInvocation(
  rootDir: string,
  projectDir: string,
): { argv: string[]; cwd: string } {
  for (const base of [projectDir, rootDir]) {
    try {
      const require_ = createRequire(join(base, 'noop.js'));
      const mainEntry = require_.resolve('@ductus/adapter-typescript');
      const cli = join(dirname(mainEntry), 'cli.js');
      if (existsSync(cli)) {
        return { argv: [process.execPath, cli], cwd: rootDir };
      }
    } catch {
      // Package not resolvable from here — try the next base or the binary search.
    }
  }
  const binary = findBinary('ductus-adapter-typescript', rootDir);
  if (binary !== undefined) return { argv: [binary], cwd: rootDir };
  throw new AdapterError(
    'Adapter "typescript": `@ductus/adapter-typescript` cannot be resolved — neither as an ' +
      'npm package from the target project or from the directory of ductus.config.yaml, nor ' +
      'as a `ductus-adapter-typescript` binary in the PATH. Options: ' +
      '`npm install -D @ductus/adapter-typescript` in the target project OR ' +
      '`npm install -g @ductus/adapter-typescript`.',
  );
}

/**
 * Command resolution: an explicit entry.command wins (chain 1); "dart" has a
 * built-in resolution (npm wrapper binary, otherwise the chain from
 * resolveDartInvocation — usable without a build dependency in the target
 * project), "typescript" uses the chain from resolveTypescriptInvocation
 * (require.resolve, then binary — the adapter itself runs in Node).
 */
function resolveCommand(
  entry: AdapterConfigEntry,
  rootDir: string,
  projectDir: string,
): { argv: string[]; cwd: string } {
  if (entry.command !== undefined && entry.command.trim() !== '') {
    return { argv: entry.command.trim().split(/\s+/), cwd: rootDir };
  }
  if (entry.name === 'dart') {
    const binary = findBinary('ductus-adapter-dart', rootDir);
    if (binary !== undefined) return { argv: [binary], cwd: rootDir };
    return resolveDartInvocation(projectDir);
  }
  if (entry.name === 'typescript') {
    return resolveTypescriptInvocation(rootDir, projectDir);
  }
  throw new AdapterError(
    `Adapter "${entry.name}": no "command" configured and no built-in resolution known (NFR6: specify command).`,
  );
}

interface SpawnResult {
  stdout: string;
  diagnostics: string;
}

function runCommand(
  argv: string[],
  args: string[],
  cwd: string,
  adapterName: string,
  log?: (message: string) => void,
): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const [executable, ...baseArgs] = argv;
    if (executable === undefined) {
      rejectPromise(new AdapterError(`Adapter "${adapterName}": empty command.`));
      return;
    }
    const child = spawn(executable, [...baseArgs, ...args], {
      cwd,
      timeout: ADAPTER_TIMEOUT_MS,
      env: process.env,
    });

    let stdout = '';
    let diagnostics = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      diagnostics += chunk;
    });

    child.on('error', (error) => {
      rejectPromise(
        new AdapterError(`Adapter "${adapterName}": command "${executable}" is not executable (${error.message}).`),
      );
    });

    child.on('close', (code, signal) => {
      // Always pass through the adapter's stderr diagnostics — never swallow them.
      if (log !== undefined) {
        for (const line of diagnostics.split('\n')) {
          if (line.trim() !== '') log(`[${adapterName}] ${line}`);
        }
      }
      if (signal !== null) {
        rejectPromise(
          new AdapterError(
            `Adapter "${adapterName}": aborted (signal ${signal}, timeout ${ADAPTER_TIMEOUT_MS / 1000} s). stderr: ${stderrExcerpt(diagnostics)}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new AdapterError(
            `Adapter "${adapterName}": exit code ${code ?? '?'}. stderr: ${stderrExcerpt(diagnostics)}`,
          ),
        );
        return;
      }
      resolvePromise({ stdout, diagnostics });
    });
  });
}

/**
 * Removes leading pub diagnostic lines before the first JSON object.
 *
 * With unresolved dependencies, `dart run`/`dart pub global run` write lines
 * like "Resolving dependencies..." to stdout BEFORE the adapter program runs
 * — the adapter itself can do nothing about that (its stdout contract applies
 * from program start). Only the preamble up to the first line starting with
 * "{" is cut off; the preamble is returned as diagnostics so nothing gets
 * swallowed. If the rest does not parse, the strict A3 error with the
 * original stdout still applies.
 */
function stripLeadingPubNoise(stdout: string): { jsonText: string; noise: string[] } {
  if (stdout.trimStart().startsWith('{')) return { jsonText: stdout, noise: [] };
  const lines = stdout.split('\n');
  const firstJsonLine = lines.findIndex((line) => line.startsWith('{'));
  if (firstJsonLine <= 0) return { jsonText: stdout, noise: [] };
  return {
    jsonText: lines.slice(firstJsonLine).join('\n'),
    noise: lines.slice(0, firstJsonLine).filter((line) => line.trim() !== ''),
  };
}

/** Formats Ajv errors compactly for the AdapterError message. */
function formatSchemaErrors(): string {
  return (validateAdapterOutput.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath === '' ? '/' : e.instancePath}: ${e.message ?? 'invalid'}`)
    .join('; ');
}

/**
 * Runs an adapter: --project <absolute> --config <tmpfile>,
 * stdout = graph JSON (Ajv-checked, A3), stderr = diagnostics. The temporary
 * config file (deriveFrom/extra) is cleaned up after the run.
 */
export async function runAdapter(
  entry: AdapterConfigEntry,
  opts: RunAdapterOptions,
): Promise<AdapterRunResult> {
  const projectDir = resolve(opts.rootDir, entry.project);
  const { argv, cwd } = resolveCommand(entry, opts.rootDir, projectDir);

  // Adapter configuration from the adapters: section of ductus.config.yaml:
  // deriveFrom + adapter-specific extra keys (flattened to top level).
  const adapterConfig: Record<string, unknown> = {
    ...(entry.deriveFrom !== undefined ? { deriveFrom: entry.deriveFrom } : {}),
    ...(entry.extra ?? {}),
  };

  const tmpDir = await mkdtemp(join(tmpdir(), 'ductus-adapter-'));
  const configFile = join(tmpDir, 'adapter-config.json');
  try {
    await writeFile(configFile, `${JSON.stringify(adapterConfig, null, 2)}\n`, 'utf8');

    const { stdout, diagnostics } = await runCommand(
      argv,
      ['--project', projectDir, '--config', configFile],
      cwd,
      entry.name,
      opts.log,
    );

    const { jsonText, noise } = stripLeadingPubNoise(stdout);
    if (noise.length > 0 && opts.log !== undefined) {
      for (const line of noise) opts.log(`[${entry.name}] (pub) ${line}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new AdapterError(
        `Adapter "${entry.name}": stdout is not valid JSON (A3). Beginning: ${JSON.stringify(stdout.slice(0, 120))}`,
      );
    }
    if (!validateAdapterOutput(parsed)) {
      throw new AdapterError(
        `Adapter "${entry.name}": output violates the graph schema (A3): ${formatSchemaErrors()}`,
      );
    }

    const allDiagnostics = noise.length > 0 ? `${noise.join('\n')}\n${diagnostics}` : diagnostics;
    return { graph: parsed, adapter: entry, diagnostics: allDiagnostics };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
