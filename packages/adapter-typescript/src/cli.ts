#!/usr/bin/env node
/**
 * Adapter-CLI des Ductus-TypeScript-Adapters:
 *
 *     ductus-adapter-typescript --project <dir> [--config <json-datei>]
 *         [--no-debug-file]
 *
 * stdout: genau ein kanonisches Graph-JSON; Diagnostik auf stderr;
 * Exit 0 Erfolg / 64 Usage-Fehler / 1 Adapterfehler.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AdapterConfig } from './config.js';
import { AdapterException } from './graph-model.js';
import { runAdapter } from './runner.js';

const USAGE = [
  'Verwendung: ductus-adapter-typescript --project <dir> [--config <json-datei>] [--no-debug-file]',
  '  --project <dir>          Projektverzeichnis (Pflicht).',
  '  --config <json-datei>    Pfad zu einer JSON-Konfigurationsdatei.',
  '  --debug-file             Schreibt ductus_graph.g.json ins Projektverzeichnis',
  '                           (Default; --no-debug-file schaltet ab).',
].join('\n');

interface CliArgs {
  project?: string;
  config?: string;
  debugFile: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { debugFile: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--project':
      case '--config': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new UsageError(`Fehler: ${arg} erwartet einen Wert.`);
        }
        if (arg === '--project') args.project = value;
        else args.config = value;
        i++;
        break;
      }
      case '--debug-file':
        args.debugFile = true;
        break;
      case '--no-debug-file':
        args.debugFile = false;
        break;
      default:
        throw new UsageError(`Fehler: unbekannte Option "${arg}".`);
    }
  }
  return args;
}

class UsageError extends Error {}

function main(argv: string[]): void {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 64;
    return;
  }

  if (args.project === undefined || args.project === '') {
    process.stderr.write('Fehler: --project <dir> ist erforderlich.\n');
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 64;
    return;
  }
  // Absolut auflösen, damit der Aufruf aus beliebigem cwd funktioniert.
  const projectDir = resolve(args.project);

  try {
    const config = AdapterConfig.load(args.config);
    const json = runAdapter({
      projectDir,
      config,
      warn: (message) => process.stderr.write(`${message}\n`),
    });
    process.stdout.write(json);
    if (args.debugFile) {
      writeFileSync(join(projectDir, 'ductus_graph.g.json'), json, 'utf8');
    }
  } catch (error) {
    if (error instanceof AdapterException) {
      for (const message of error.messages) process.stderr.write(`${message}\n`);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Fehler: ${detail}\n`);
    }
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
