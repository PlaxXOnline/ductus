/**
 * Adapter-Runner: führt einen Adapter-Befehl nach dem Adapter-Vertrag aus
 * (stdout = genau ein Graph-JSON, stderr = Diagnostik, Exit 0/≠0), sammelt
 * beides ein und prüft die Ausgabe syntaktisch gegen das Graph-Schema (A3).
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

/** Adapterfehler ⇒ Exit-Code 3 (wie LLM-/Konfigurationsfehler). */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

const ADAPTER_TIMEOUT_MS = 120_000;
const STDERR_EXCERPT_CHARS = 800;

// Eigene Ajv-Instanz (das Schema trägt eine $id — keine Doppel-Registrierung
// mit der Instanz aus graph/validate.ts riskieren).
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAdapterOutput = ajv.compile<JourneyGraph>(
  journeyGraphJsonSchema as unknown as Record<string, unknown>,
);

export interface RunAdapterOptions {
  /** Verzeichnis der ductus.config.yaml (Basis für relative Pfade). */
  rootDir: string;
  /** Adapter laufen lokal — offline schränkt sie nicht ein (NFR4). */
  offline?: boolean;
  log?: (message: string) => void;
}

/** Kürzt stderr auf einen lesbaren Auszug für Fehlermeldungen. */
function stderrExcerpt(diagnostics: string): string {
  const trimmed = diagnostics.trim();
  if (trimmed === '') return '(keine stderr-Ausgabe)';
  return trimmed.length <= STDERR_EXCERPT_CHARS ? trimmed : `…${trimmed.slice(-STDERR_EXCERPT_CHARS)}`;
}

/** Sucht ein Binary in <rootDir>/node_modules/.bin und im PATH. */
function findBinary(name: string, rootDir: string): string | undefined {
  const local = join(rootDir, 'node_modules', '.bin', name);
  if (existsSync(local)) return local;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir !== '' && existsSync(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

/**
 * Einfacher YAML-Check (Kette 3 der Auflösung): deklariert die pubspec.yaml des
 * Zielprojekts `ductus` unter dependencies/dev_dependencies? Ein Zeilen-Scan
 * genügt — es geht nur um die Frage "ist das Paket auflösbar?", nicht um
 * vollständiges YAML-Parsing.
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
    // Neuer Top-Level-Key beendet den (dev_)dependencies-Block.
    if (/^\S/.test(line)) inDependencies = false;
    if (inDependencies && /^\s+ductus\s*:/.test(line)) return true;
  }
  return false;
}

/** Ergebnis der rein lesenden Abfrage der globalen pub-Aktivierung (Kette 4). */
export interface GlobalActivation {
  activated: boolean;
  /** Quellverzeichnis bei `dart pub global activate --source path`. */
  path?: string;
}

/**
 * Prüft NUR lesend, ob `ductus` global aktiviert ist (Kette 4) —
 * `dart pub global list` verändert den globalen pub-Zustand nicht.
 * Bei path-Aktivierung liefert pub die Quelle mit (`ductus 0.1.0 at path "…"`).
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

/** Testbar injizierbare Teile der Dart-Auflösung (globalen pub-Zustand nie anfassen). */
export interface DartResolutionOptions {
  /** Umgebungsvariablen (Default: process.env). */
  env?: Record<string, string | undefined>;
  /** Abfrage für Kette 4 (Default: `dart pub global list`, rein lesend). */
  getGlobalActivation?: () => GlobalActivation;
}

/**
 * Auflösungskette für `dart run ductus:adapter` OHNE Build-Abhängigkeit im
 * Zielprojekt (der Kommentar-Weg soll buildfrei bleiben) — identisch im
 * npm-Wrapper implementiert:
 *   2. DUCTUS_DART_ADAPTER_DIR: Paketkontext, der `ductus` kennt ⇒ cwd = dieses Verzeichnis.
 *   3. Zielprojekt deklariert `ductus` in der pubspec.yaml ⇒ cwd = Projekt.
 *   4. Global aktiviertes Paket: bei path-Aktivierung `dart run` mit cwd =
 *      Quellverzeichnis (vermeidet pub-Resolutionszeilen auf stdout), sonst
 *      `dart pub global run ductus:adapter` (Snapshot, stdout-sauber).
 * (Kette 1, entry.command, behandelt resolveCommand vorab.)
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
        `Adapter "dart": DUCTUS_DART_ADAPTER_DIR verweist auf ein nicht existierendes Verzeichnis: "${dir}".`,
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
    'Adapter "dart": `ductus:adapter` ist nicht auflösbar — das Zielprojekt deklariert `ductus` ' +
      'nicht und das Paket ist nicht global aktiviert. Optionen: `dart pub add dev:ductus` im ' +
      'Zielprojekt ODER `dart pub global activate ductus` (alternativ DUCTUS_DART_ADAPTER_DIR ' +
      'auf ein Verzeichnis mit ductus-Paketkontext setzen).',
  );
}

/**
 * Auflösung für den TypeScript-Adapter — der Adapter läuft selbst in Node:
 *   1. Paket-Auflösung via require.resolve ab Zielprojekt bzw. ab dem
 *      Config-Verzeichnis (inkl. Parent-node_modules/Hoisting) ⇒ das
 *      CLI-Modul wird direkt mit dem eigenen Node gestartet — plattformneutral,
 *      kein Shell-Shim nötig (Windows: die .bin-Shims sind ohne Shell nicht
 *      spawnbar).
 *   2. Binary `ductus-adapter-typescript` in node_modules/.bin bzw. im PATH
 *      (global installiert).
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
      // Paket von hier aus nicht auflösbar — nächste Basis bzw. Binary-Suche.
    }
  }
  const binary = findBinary('ductus-adapter-typescript', rootDir);
  if (binary !== undefined) return { argv: [binary], cwd: rootDir };
  throw new AdapterError(
    'Adapter "typescript": `@ductus/adapter-typescript` ist nicht auflösbar — weder als ' +
      'npm-Paket vom Zielprojekt bzw. vom Verzeichnis der ductus.config.yaml aus, noch als ' +
      'Binary `ductus-adapter-typescript` im PATH. Optionen: ' +
      '`npm install -D @ductus/adapter-typescript` im Zielprojekt ODER ' +
      '`npm install -g @ductus/adapter-typescript`.',
  );
}

/**
 * Befehlsauflösung: expliziter entry.command gewinnt (Kette 1); für
 * "dart" gibt es eine eingebaute Auflösung (npm-Wrapper-Binary, sonst die
 * Kette aus resolveDartInvocation — ohne Build-Abhängigkeit im Zielprojekt
 * nutzbar), für "typescript" die Kette aus resolveTypescriptInvocation
 * (require.resolve, dann Binary — der Adapter läuft selbst in Node).
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
    `Adapter "${entry.name}": kein "command" konfiguriert und keine eingebaute Auflösung bekannt (NFR6: command angeben).`,
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
      rejectPromise(new AdapterError(`Adapter "${adapterName}": leerer Befehl.`));
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
        new AdapterError(`Adapter "${adapterName}": Befehl "${executable}" nicht ausführbar (${error.message}).`),
      );
    });

    child.on('close', (code, signal) => {
      // stderr-Diagnostik des Adapters immer durchreichen — nie verschlucken.
      if (log !== undefined) {
        for (const line of diagnostics.split('\n')) {
          if (line.trim() !== '') log(`[${adapterName}] ${line}`);
        }
      }
      if (signal !== null) {
        rejectPromise(
          new AdapterError(
            `Adapter "${adapterName}": abgebrochen (Signal ${signal}, Timeout ${ADAPTER_TIMEOUT_MS / 1000} s). stderr: ${stderrExcerpt(diagnostics)}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new AdapterError(
            `Adapter "${adapterName}": Exit-Code ${code ?? '?'}. stderr: ${stderrExcerpt(diagnostics)}`,
          ),
        );
        return;
      }
      resolvePromise({ stdout, diagnostics });
    });
  });
}

/**
 * Entfernt führende pub-Diagnosezeilen vor dem ersten JSON-Objekt.
 *
 * `dart run`/`dart pub global run` schreiben bei unaufgelösten Dependencies
 * Zeilen wie "Resolving dependencies..." auf stdout, BEVOR das Adapter-Programm
 * läuft — dagegen kann der Adapter selbst nichts tun (sein stdout-Vertrag
 * gilt für ihn ab Programmstart). Abgeschnitten wird ausschließlich Vorspann bis zur ersten
 * Zeile, die mit "{" beginnt; der Vorspann wird als Diagnostik zurückgegeben,
 * damit nichts verschluckt wird. Parst der Rest nicht, greift weiterhin der
 * strikte A3-Fehler mit dem Original-stdout.
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

/** Formatiert Ajv-Fehler kompakt für die AdapterError-Meldung. */
function formatSchemaErrors(): string {
  return (validateAdapterOutput.errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath === '' ? '/' : e.instancePath}: ${e.message ?? 'ungültig'}`)
    .join('; ');
}

/**
 * Führt einen Adapter aus: --project <absolut> --config <tmpfile>,
 * stdout = Graph-JSON (Ajv-geprüft, A3), stderr = Diagnostik. Die temporäre
 * Config-Datei (deriveFrom/extra) wird nach dem Lauf aufgeräumt.
 */
export async function runAdapter(
  entry: AdapterConfigEntry,
  opts: RunAdapterOptions,
): Promise<AdapterRunResult> {
  const projectDir = resolve(opts.rootDir, entry.project);
  const { argv, cwd } = resolveCommand(entry, opts.rootDir, projectDir);

  // Adapter-Konfiguration aus der adapters:-Sektion der ductus.config.yaml:
  // deriveFrom + adapterspezifische extra-Schlüssel (abgeflacht auf top-level).
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
        `Adapter "${entry.name}": stdout ist kein gültiges JSON (A3). Anfang: ${JSON.stringify(stdout.slice(0, 120))}`,
      );
    }
    if (!validateAdapterOutput(parsed)) {
      throw new AdapterError(
        `Adapter "${entry.name}": Ausgabe verletzt das Graph-Schema (A3): ${formatSchemaErrors()}`,
      );
    }

    const allDiagnostics = noise.length > 0 ? `${noise.join('\n')}\n${diagnostics}` : diagnostics;
    return { graph: parsed, adapter: entry, diagnostics: allDiagnostics };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
