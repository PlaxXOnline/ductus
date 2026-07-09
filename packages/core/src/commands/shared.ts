/**
 * Gemeinsame CLI-Bausteine: globale Optionen, Config-Laden mit Warnungs-Ausgabe,
 * Ausgabe von Validierungs-Issues und zentrale Fehler-→-Exit-Code-Abbildung
 * (SPEC §10.3, DD §I). NFR4: API-Key-Werte erscheinen in keiner Ausgabe —
 * alle Meldungen stammen aus Modulen, die Keys nie in Fehlertexte aufnehmen.
 */

import type { Command } from 'commander';
import { AdapterError } from '../adapters/runner.js';
import { ConfigError, loadConfig } from '../config.js';
import type { DuctusConfig, ValidationIssue } from '../contracts.js';
import { MergeError } from '../graph/index.js';
import { WebsiteBuildError } from '../output/website.js';
import { LlmError } from '../pipeline.js';

export interface GlobalOptions {
  config: string;
  offline?: boolean;
}

/** Globale Optionen des Programms (auch aus Subcommand-Kontext erreichbar). */
export function globalOptions(command: Command): GlobalOptions {
  const opts = command.optsWithGlobals<{ config?: string; offline?: boolean }>();
  return {
    config: opts.config ?? './ductus.config.yaml',
    ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
  };
}

/** Lädt die Config und gibt Warnungen (unbekannte Top-Level-Keys) auf stderr aus. */
export function loadConfigWithWarnings(configPath: string): DuctusConfig {
  const { config, warnings } = loadConfig(configPath);
  for (const warning of warnings) {
    process.stderr.write(`Warnung: ${warning}\n`);
  }
  return config;
}

/** Log-Funktion der Pipeline: Fortschritt/Diagnostik gehört auf stderr. */
export function stderrLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Gibt Issues zeilenweise als "<rule> <message>" auf stderr aus (CI-tauglich). */
export function printIssues(issues: ValidationIssue[]): void {
  for (const issue of issues) {
    process.stderr.write(`${issue.rule} ${issue.message}\n`);
  }
}

/** Exit-Code-Abbildung (DD §I). */
function exitCodeFor(error: unknown): number {
  if (error instanceof MergeError) return 1;
  if (
    error instanceof ConfigError ||
    error instanceof LlmError ||
    error instanceof AdapterError ||
    error instanceof WebsiteBuildError
  ) {
    return 3;
  }
  return 3;
}

/**
 * Führt eine Kommando-Aktion aus und setzt process.exitCode; Fehler werden
 * kompakt gemeldet (kein Stacktrace — die Meldungen sind selbsterklärend).
 */
export async function runAction(fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Fehler: ${message}\n`);
    process.exitCode = exitCodeFor(error);
  }
}
