/**
 * `ductus init`: legt eine kommentierte ductus.config.yaml an.
 * Erkennt den Projekttyp — pubspec.yaml (Dart/Flutter, app.name +
 * go_router/auto_route ⇒ deriveFrom) vor package.json (TypeScript/JavaScript,
 * name + react-router/next ⇒ deriveFrom) — und überschreibt eine bestehende
 * Config nie stillschweigend (nur mit --force).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { parse } from 'yaml';
import { ConfigError, defaultConfigYaml, type DefaultConfigOptions } from '../config.js';
import { globalOptions, runAction } from './shared.js';

const DART_ROUTING_PACKAGES = ['go_router', 'auto_route'] as const;

/** npm-Paket → deriveFrom-Quelle des TypeScript-Adapters. */
const TS_ROUTING_PACKAGES: Record<string, string> = {
  'react-router': 'react-router',
  'react-router-dom': 'react-router',
  next: 'next',
};

/** Erkennungsergebnis; `detected` sagt, ob die Manifest-Datei existiert. */
interface Detection {
  detected: boolean;
  manifest: string;
  options: DefaultConfigOptions;
}

/** Liest app.name und Routing-Pakete aus einer pubspec.yaml (best effort). */
function detectFromPubspec(dir: string): Detection {
  const manifest = 'pubspec.yaml';
  const pubspecPath = join(dir, manifest);
  if (!existsSync(pubspecPath)) return { detected: false, manifest, options: {} };
  const options: DefaultConfigOptions = { adapter: 'dart' };
  try {
    const pubspec: unknown = parse(readFileSync(pubspecPath, 'utf8'));
    if (pubspec === null || typeof pubspec !== 'object') {
      return { detected: true, manifest, options };
    }
    const record = pubspec as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : undefined;
    const dependencies =
      record['dependencies'] !== null && typeof record['dependencies'] === 'object'
        ? (record['dependencies'] as Record<string, unknown>)
        : {};
    const deriveFrom = DART_ROUTING_PACKAGES.filter((pkg) => pkg in dependencies);
    return {
      detected: true,
      manifest,
      options: {
        ...options,
        ...(name !== undefined ? { appName: name } : {}),
        ...(deriveFrom.length > 0 ? { deriveFrom } : {}),
      },
    };
  } catch {
    // Unlesbare pubspec ⇒ Defaults verwenden, kein harter Fehler.
    return { detected: true, manifest, options };
  }
}

/** Liest app.name und Routing-Pakete aus einer package.json (best effort). */
function detectFromPackageJson(dir: string): Detection {
  const manifest = 'package.json';
  const packageJsonPath = join(dir, manifest);
  if (!existsSync(packageJsonPath)) return { detected: false, manifest, options: {} };
  const options: DefaultConfigOptions = { adapter: 'typescript' };
  try {
    const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (pkg === null || typeof pkg !== 'object') {
      return { detected: true, manifest, options };
    }
    const record = pkg as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : undefined;
    const dependencies: Record<string, unknown> = {};
    for (const key of ['dependencies', 'devDependencies']) {
      const section = record[key];
      if (section !== null && typeof section === 'object') {
        Object.assign(dependencies, section as Record<string, unknown>);
      }
    }
    const deriveFrom = [
      ...new Set(
        Object.keys(TS_ROUTING_PACKAGES)
          .filter((pkgName) => pkgName in dependencies)
          .map((pkgName) => TS_ROUTING_PACKAGES[pkgName]!),
      ),
    ];
    return {
      detected: true,
      manifest,
      options: {
        ...options,
        ...(name !== undefined ? { appName: name } : {}),
        ...(deriveFrom.length > 0 ? { deriveFrom } : {}),
      },
    };
  } catch {
    // Unlesbare package.json ⇒ Defaults verwenden, kein harter Fehler.
    return { detected: true, manifest, options };
  }
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Legt eine ductus.config.yaml an und erkennt das Projekt (pubspec.yaml oder package.json).',
    )
    .option('--force', 'Bestehende Konfigurationsdatei überschreiben')
    .action(async (options: { force?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const configPath = resolve(globals.config);

        if (existsSync(configPath) && options.force !== true) {
          throw new ConfigError(
            `"${configPath}" existiert bereits — nichts überschrieben. Mit --force erneut ausführen.`,
          );
        }

        // Priorität pubspec.yaml vor package.json: Flutter-Projekte tragen
        // oft eine package.json fürs Tooling, der umgekehrte Fall nicht.
        const pubspec = detectFromPubspec(dirname(configPath));
        const packageJson = pubspec.detected
          ? undefined
          : detectFromPackageJson(dirname(configPath));
        const detection = pubspec.detected ? pubspec : packageJson!;
        writeFileSync(configPath, defaultConfigYaml(detection.options), 'utf8');

        const detected = detection.options;
        process.stdout.write(
          [
            `Konfiguration angelegt: ${configPath}`,
            detection.detected
              ? `Erkannt aus ${detection.manifest}: Adapter "${detected.adapter}"` +
                (detected.appName !== undefined ? `, app.name "${detected.appName}"` : '') +
                (detected.deriveFrom !== undefined
                  ? `, Routing: ${detected.deriveFrom.join(', ')}`
                  : '')
              : 'Keine pubspec.yaml/package.json gefunden — bitte adapters und app.name in der Config prüfen.',
            '',
            'Nächste Schritte:',
            '  1. API-Key setzen:   export DUCTUS_LLM_API_KEY=<ihr-key>',
            '  2. Graph erzeugen:   ductus extract',
            '  3. Doku generieren:  ductus generate',
            '',
          ].join('\n'),
        );
        return 0;
      });
    });
}
