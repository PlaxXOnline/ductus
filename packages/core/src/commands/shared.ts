/**
 * Shared CLI building blocks: global options, config loading with warning
 * output, printing of validation issues, and the central error-to-exit-code
 * mapping (1 validation/merge conflict, 3 LLM/config/adapter/build).
 * NFR4: API key values never appear in any output —
 * all messages come from modules that never include keys in error texts.
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

/** Global options of the program (also reachable from subcommand context). */
export function globalOptions(command: Command): GlobalOptions {
  const opts = command.optsWithGlobals<{ config?: string; offline?: boolean }>();
  return {
    config: opts.config ?? './ductus.config.yaml',
    ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
  };
}

/** Loads the config and prints warnings (unknown top-level keys) to stderr. */
export function loadConfigWithWarnings(configPath: string): DuctusConfig {
  const { config, warnings } = loadConfig(configPath);
  for (const warning of warnings) {
    process.stderr.write(`Warning: ${warning}\n`);
  }
  return config;
}

/** Log function for the pipeline: progress/diagnostics belong on stderr. */
export function stderrLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Prints issues line by line as "<rule> <message>" to stderr (CI-friendly). */
export function printIssues(issues: ValidationIssue[]): void {
  for (const issue of issues) {
    process.stderr.write(`${issue.rule} ${issue.message}\n`);
  }
}

/** Exit-code mapping: merge conflict ⇒ 1, all other error classes ⇒ 3. */
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
 * Runs a command action and sets process.exitCode; errors are reported
 * briefly (no stack trace — the messages are self-explanatory).
 */
export async function runAction(fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = exitCodeFor(error);
  }
}
