/**
 * `ductus init`: creates a commented ductus.config.yaml.
 * Detects the project type — pubspec.yaml (Dart/Flutter, app.name +
 * go_router/auto_route ⇒ deriveFrom) before package.json (TypeScript/JavaScript,
 * name + react-router/next ⇒ deriveFrom) — and never silently overwrites an
 * existing config (only with --force).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { parse } from 'yaml';
import { ConfigError, defaultConfigYaml, type DefaultConfigOptions } from '../config.js';
import { globalOptions, runAction } from './shared.js';

const DART_ROUTING_PACKAGES = ['go_router', 'auto_route'] as const;

/** npm package → deriveFrom source of the TypeScript adapter. */
const TS_ROUTING_PACKAGES: Record<string, string> = {
  'react-router': 'react-router',
  'react-router-dom': 'react-router',
  next: 'next',
};

/** Detection result; `detected` says whether the manifest file exists. */
interface Detection {
  detected: boolean;
  manifest: string;
  options: DefaultConfigOptions;
}

/** Reads app.name and routing packages from a pubspec.yaml (best effort). */
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
    // Unreadable pubspec ⇒ use defaults, no hard error.
    return { detected: true, manifest, options };
  }
}

/** Reads app.name and routing packages from a package.json (best effort). */
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
    // Unreadable package.json ⇒ use defaults, no hard error.
    return { detected: true, manifest, options };
  }
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description(
      'Creates a ductus.config.yaml and detects the project (pubspec.yaml or package.json).',
    )
    .option('--force', 'Overwrite an existing configuration file')
    .action(async (options: { force?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const configPath = resolve(globals.config);

        if (existsSync(configPath) && options.force !== true) {
          throw new ConfigError(
            `"${configPath}" already exists — nothing overwritten. Run again with --force.`,
          );
        }

        // pubspec.yaml takes priority over package.json: Flutter projects
        // often carry a package.json for tooling, the reverse does not happen.
        const pubspec = detectFromPubspec(dirname(configPath));
        const packageJson = pubspec.detected
          ? undefined
          : detectFromPackageJson(dirname(configPath));
        const detection = pubspec.detected ? pubspec : packageJson!;
        writeFileSync(configPath, defaultConfigYaml(detection.options), 'utf8');

        const detected = detection.options;
        process.stdout.write(
          [
            `Configuration created: ${configPath}`,
            detection.detected
              ? `Detected from ${detection.manifest}: adapter "${detected.adapter}"` +
                (detected.appName !== undefined ? `, app.name "${detected.appName}"` : '') +
                (detected.deriveFrom !== undefined
                  ? `, routing: ${detected.deriveFrom.join(', ')}`
                  : '')
              : 'No pubspec.yaml/package.json found — please review adapters and app.name in the config.',
            '',
            'Next steps:',
            '  1. Set the API key:   export DUCTUS_LLM_API_KEY=<your-key>',
            '  2. Build the graph:   ductus extract',
            '  3. Generate docs:     ductus generate',
            '',
          ].join('\n'),
        );
        return 0;
      });
    });
}
