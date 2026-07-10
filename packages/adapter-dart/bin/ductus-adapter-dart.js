#!/usr/bin/env node
/**
 * Dünner Wrapper um das Dart-Adapter-CLI:
 *
 *   ductus-adapter-dart --project <dir> [--config <file>] [--no-debug-file]
 *
 * Delegiert an `dart run ductus:adapter` — der eigentliche Parsing-Schritt
 * läuft in der Dart-Toolchain, der npm-Kern bleibt sprachneutral. stdout
 * bleibt der Adapter-Vertrag (genau ein JSON-Dokument); dieser Wrapper
 * reicht stdout/stderr und Exit-Code unverändert durch.
 *
 * `dart run ductus:adapter` braucht einen Paketkontext, der `ductus` kennt.
 * Das Zielprojekt selbst braucht dafür KEINE Build-Abhängigkeit —
 * Auflösungskette (identisch im Core-Runner implementiert):
 *   2. DUCTUS_DART_ADAPTER_DIR: Verzeichnis mit ductus-Paketkontext ⇒ cwd = dieses Verzeichnis.
 *   3. Zielprojekt deklariert `ductus` in der pubspec.yaml ⇒ cwd = Projekt.
 *   4. Global aktiviertes Paket ⇒ `dart pub global run ductus:adapter`.
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
  process.stderr.write('ductus-adapter-dart: --project <dir> ist erforderlich\n');
  process.exit(1);
}
const projectDir = resolve(project);
if (!existsSync(projectDir)) {
  process.stderr.write(`ductus-adapter-dart: Projektverzeichnis nicht gefunden: ${projectDir}\n`);
  process.exit(1);
}

/** Einfacher zeilenbasierter YAML-Check (Kette 3): pubspec.yaml deklariert `ductus`? */
function pubspecDeclaresDuctus(dir) {
  const pubspecPath = join(dir, 'pubspec.yaml');
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

/**
 * Prüft NUR lesend, ob `ductus` global aktiviert ist (Kette 4). Bei
 * path-Aktivierung liefert pub das Quellverzeichnis mit — dann läuft der
 * Adapter via `dart run` direkt dort (vermeidet pub-Resolutionszeilen
 * auf stdout — dort darf nur das eine Graph-JSON stehen).
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

// Auflösungskette — --project wird weiterhin absolut durchgereicht.
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
      `ductus-adapter-dart: DUCTUS_DART_ADAPTER_DIR verweist auf ein nicht existierendes Verzeichnis: ${dir}\n`,
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
    'ductus-adapter-dart: `ductus:adapter` ist nicht auflösbar — das Zielprojekt deklariert ' +
      '`ductus` nicht und das Paket ist nicht global aktiviert. Optionen: ' +
      '`dart pub add dev:ductus` im Zielprojekt ODER `dart pub global activate ductus` ' +
      '(alternativ DUCTUS_DART_ADAPTER_DIR auf ein Verzeichnis mit ductus-Paketkontext setzen).\n',
  );
  process.exit(1);
}

// stdout wird gepuffert statt geerbt: pub kann bei unaufgelösten Dependencies
// Zeilen wie "Resolving dependencies..." VOR dem Adapter auf stdout schreiben.
// Der Wrapper hält den Adapter-Vertrag an seiner Grenze ein, indem er solchen
// Vorspann (alles vor der ersten mit "{" beginnenden Zeile) nach stderr
// umleitet — nichts wird verschluckt, stdout bleibt genau ein JSON-Dokument.
const result = spawnSync('dart', [...dartArgs, ...args], {
  cwd,
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error && result.error.code === 'ENOENT') {
  process.stderr.write(
    'ductus-adapter-dart: `dart` wurde nicht gefunden. Bitte das Dart SDK installieren ' +
      '(https://dart.dev/get-dart) und sicherstellen, dass es im PATH liegt.\n',
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
