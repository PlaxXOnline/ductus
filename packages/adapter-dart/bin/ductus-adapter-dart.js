#!/usr/bin/env node
/**
 * Thin wrapper around the Dart adapter CLI:
 *
 *   ductus-adapter-dart --project <dir> [--config <file>] [--no-debug-file]
 *
 * Delegates to `dart run ductus:adapter` — the actual parsing step runs in
 * the Dart toolchain, keeping the npm core language-neutral. stdout remains
 * the adapter contract (exactly one JSON document); this wrapper passes
 * stdout/stderr and the exit code through unchanged.
 *
 * `dart run ductus:adapter` needs a package context that knows `ductus`.
 * The target project itself needs NO build dependency for this —
 * resolution chain (implemented identically in the core runner):
 *   2. DUCTUS_DART_ADAPTER_DIR: directory with a ductus package context ⇒ cwd = that directory.
 *   3. Target project declares `ductus` in its pubspec.yaml ⇒ cwd = project.
 *   4. Globally activated package ⇒ `dart pub global run ductus:adapter`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

const project = readOption('--project');
if (!project) {
  process.stderr.write('ductus-adapter-dart: --project <dir> is required\n');
  process.exit(1);
}
const projectDir = resolve(project);
if (!existsSync(projectDir)) {
  process.stderr.write(`ductus-adapter-dart: project directory not found: ${projectDir}\n`);
  process.exit(1);
}

/** Simple line-based YAML check (chain step 3): does pubspec.yaml declare `ductus`? */
function pubspecDeclaresDuctus(dir) {
  const pubspecPath = join(dir, 'pubspec.yaml');
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

/**
 * READ-ONLY check whether `ductus` is globally activated (chain step 4). For
 * a path activation pub also reports the source directory — the adapter then
 * runs via `dart run` directly there (avoids pub resolution lines on stdout —
 * only the single graph JSON may appear there).
 */
function ductusGlobalActivation() {
  const result = spawnSync('dart', ['pub', 'global', 'list'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) return { activated: false };
  const match = /^ductus\s+\S+(?:\s+at path\s+"([^"]+)")?/m.exec(result.stdout ?? '');
  if (match === null) return { activated: false };
  return { activated: true, path: match[1] };
}

// Resolution chain — --project is still passed through as an absolute path.
let dartArgs;
let cwd;
const adapterDir = (process.env.DUCTUS_DART_ADAPTER_DIR ?? '').trim();
const activation = adapterDir === '' && !pubspecDeclaresDuctus(projectDir)
  ? ductusGlobalActivation()
  : undefined;
if (adapterDir !== '') {
  const dir = resolve(adapterDir);
  if (!existsSync(dir)) {
    process.stderr.write(
      `ductus-adapter-dart: DUCTUS_DART_ADAPTER_DIR points to a non-existent directory: ${dir}\n`,
    );
    process.exit(1);
  }
  dartArgs = ['run', 'ductus:adapter'];
  cwd = dir;
} else if (pubspecDeclaresDuctus(projectDir)) {
  dartArgs = ['run', 'ductus:adapter'];
  cwd = projectDir;
} else if (activation?.activated && activation.path !== undefined && existsSync(activation.path)) {
  dartArgs = ['run', 'ductus:adapter'];
  cwd = activation.path;
} else if (activation?.activated) {
  dartArgs = ['pub', 'global', 'run', 'ductus:adapter'];
  cwd = projectDir;
} else {
  process.stderr.write(
    'ductus-adapter-dart: `ductus:adapter` cannot be resolved — the target project does not ' +
      'declare `ductus` and the package is not globally activated. Options: ' +
      '`dart pub add dev:ductus` in the target project OR `dart pub global activate ductus` ' +
      '(alternatively set DUCTUS_DART_ADAPTER_DIR to a directory with a ductus package context).\n',
  );
  process.exit(1);
}

// stdout is buffered instead of inherited: with unresolved dependencies pub may
// write lines like "Resolving dependencies..." to stdout BEFORE the adapter.
// The wrapper upholds the adapter contract at its boundary by redirecting such
// preamble (everything before the first line starting with "{") to stderr —
// nothing is swallowed, stdout stays exactly one JSON document.
const result = spawnSync('dart', [...dartArgs, ...args], {
  cwd,
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error && result.error.code === 'ENOENT') {
  process.stderr.write(
    'ductus-adapter-dart: `dart` was not found. Please install the Dart SDK ' +
      '(https://dart.dev/get-dart) and make sure it is on your PATH.\n',
  );
  process.exit(1);
}

let stdout = result.stdout ?? '';
if (result.status === 0 && !stdout.trimStart().startsWith('{')) {
  const lines = stdout.split('\n');
  const firstJsonLine = lines.findIndex((line) => line.startsWith('{'));
  if (firstJsonLine > 0) {
    for (const line of lines.slice(0, firstJsonLine)) {
      if (line.trim() !== '') process.stderr.write(`(pub) ${line}\n`);
    }
    stdout = lines.slice(firstJsonLine).join('\n');
  }
}
process.stdout.write(stdout);
process.exit(result.status ?? 1);
