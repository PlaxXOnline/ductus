/**
 * `ductus init` (SPEC §10.1): legt eine kommentierte ductus.config.yaml an.
 * Erkennt pubspec.yaml (app.name, go_router/auto_route ⇒ deriveFrom) und
 * überschreibt eine bestehende Config nie stillschweigend (nur mit --force).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { parse } from 'yaml';
import { ConfigError, defaultConfigYaml, type DefaultConfigOptions } from '../config.js';
import { globalOptions, runAction } from './shared.js';

const ROUTING_PACKAGES = ['go_router', 'auto_route'] as const;

/** Liest app.name und Routing-Pakete aus einer pubspec.yaml (best effort). */
function detectFromPubspec(dir: string): DefaultConfigOptions {
  const pubspecPath = join(dir, 'pubspec.yaml');
  if (!existsSync(pubspecPath)) return {};
  try {
    const pubspec: unknown = parse(readFileSync(pubspecPath, 'utf8'));
    if (pubspec === null || typeof pubspec !== 'object') return {};
    const record = pubspec as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : undefined;
    const dependencies =
      record['dependencies'] !== null && typeof record['dependencies'] === 'object'
        ? (record['dependencies'] as Record<string, unknown>)
        : {};
    const deriveFrom = ROUTING_PACKAGES.filter((pkg) => pkg in dependencies);
    return {
      ...(name !== undefined ? { appName: name } : {}),
      ...(deriveFrom.length > 0 ? { deriveFrom } : {}),
    };
  } catch {
    // Unlesbare pubspec ⇒ Defaults verwenden, kein harter Fehler.
    return {};
  }
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Legt eine ductus.config.yaml an und erkennt das Dart-Projekt (pubspec.yaml).')
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

        const detected = detectFromPubspec(dirname(configPath));
        writeFileSync(configPath, defaultConfigYaml(detected), 'utf8');

        process.stdout.write(
          [
            `Konfiguration angelegt: ${configPath}`,
            detected.appName !== undefined
              ? `Erkannt aus pubspec.yaml: app.name "${detected.appName}"` +
                (detected.deriveFrom !== undefined
                  ? `, Routing: ${detected.deriveFrom.join(', ')}`
                  : '')
              : 'Keine pubspec.yaml gefunden — bitte app.name in der Config prüfen.',
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
