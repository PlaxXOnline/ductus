#!/usr/bin/env node
/**
 * Adapter CLI of the Ductus TypeScript adapter:
 *
 *     ductus-adapter-typescript --project <dir> [--config <json-file>]
 *         [--no-debug-file]
 *
 * stdout: exactly one canonical graph JSON; diagnostics on stderr;
 * exit 0 success / 64 usage error / 1 adapter error.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AdapterConfig } from './config.js';
import { AdapterException } from './graph-model.js';
import { runAdapter } from './runner.js';

const USAGE = [
  'Usage: ductus-adapter-typescript --project <dir> [--config <json-file>] [--no-debug-file]',
  '  --project <dir>          Project directory (required).',
  '  --config <json-file>     Path to a JSON configuration file.',
  '  --debug-file             Writes ductus_graph.g.json into the project directory',
  '                           (default; --no-debug-file disables it).',
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
          throw new UsageError(`Error: ${arg} expects a value.`);
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
        throw new UsageError(`Error: unknown option "${arg}".`);
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
    process.stderr.write('Error: --project <dir> is required.\n');
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 64;
    return;
  }
  // Resolve to an absolute path so the invocation works from any cwd.
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
      process.stderr.write(`Error: ${detail}\n`);
    }
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
