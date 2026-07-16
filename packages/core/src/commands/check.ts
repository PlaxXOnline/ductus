/**
 * `ductus check`: validation + faithfulness from the
 * cache — no rewriting, no LLM calls (CI-friendly).
 */

import type { Command } from 'commander';
import { runCheck } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Checks graph validity and faithfulness without writing files (CI).')
    .action(async (_options: Record<string, never>, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);
        const config = loadConfigWithWarnings(globals.config);
        const result = await runCheck(config, {
          ...(globals.offline !== undefined ? { offline: globals.offline } : {}),
          log: stderrLog,
        });

        if (result.validation.errors.length > 0) {
          printIssues(result.validation.errors);
          process.stdout.write(`check: FAILED (${result.validation.errors.length} validation error(s))\n`);
          return 1;
        }

        printIssues(result.validation.warnings);
        for (const segmentId of result.notGenerated) {
          process.stdout.write(`Segment "${segmentId}": not generated yet\n`);
        }

        const violationsTotal = result.faithfulnessViolations.reduce(
          (sum, entry) => sum + entry.violations.length,
          0,
        );
        for (const entry of result.faithfulnessViolations) {
          for (const violation of entry.violations) {
            process.stdout.write(
              `Faithfulness "${entry.segmentId}": ${violation.claim} — ${violation.reason}\n`,
            );
          }
        }
        // Unconfirmed hints: informational, no effect on the threshold.
        for (const entry of result.faithfulnessHints) {
          for (const hint of entry.hints) {
            process.stdout.write(`Hint "${entry.segmentId}": ${hint.claim} — ${hint.reason}\n`);
          }
        }

        if (violationsTotal > config.llm.faithfulnessThreshold) {
          process.stdout.write(
            `check: FAILED (${violationsTotal} faithfulness violations > threshold ${config.llm.faithfulnessThreshold})\n`,
          );
          return 2;
        }

        process.stdout.write(
          `check: OK (${result.validation.warnings.length} warning(s), ` +
            `${result.notGenerated.length} segment(s) not generated yet)\n`,
        );
        return 0;
      });
    });
}
