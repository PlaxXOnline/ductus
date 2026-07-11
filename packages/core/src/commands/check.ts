/**
 * `ductus check`: Validierung + Faithfulness aus dem
 * Cache — ohne Neuschreiben, ohne LLM-Aufrufe (CI-tauglich).
 */

import type { Command } from 'commander';
import { runCheck } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Prüft Graph-Validität und Faithfulness ohne Dateien zu schreiben (CI).')
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
          process.stdout.write(`check: FEHLER (${result.validation.errors.length} Validierungsfehler)\n`);
          return 1;
        }

        printIssues(result.validation.warnings);
        for (const segmentId of result.notGenerated) {
          process.stdout.write(`Segment "${segmentId}": noch nicht generiert\n`);
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
        // Unbestätigte Hinweise: informativ, ohne Einfluss auf den Schwellwert.
        for (const entry of result.faithfulnessHints) {
          for (const hint of entry.hints) {
            process.stdout.write(`Hinweis "${entry.segmentId}": ${hint.claim} — ${hint.reason}\n`);
          }
        }

        if (violationsTotal > config.llm.faithfulnessThreshold) {
          process.stdout.write(
            `check: FEHLER (${violationsTotal} Faithfulness-Verstöße > Schwellwert ${config.llm.faithfulnessThreshold})\n`,
          );
          return 2;
        }

        process.stdout.write(
          `check: OK (${result.validation.warnings.length} Warnung(en), ` +
            `${result.notGenerated.length} Segment(e) noch nicht generiert)\n`,
        );
        return 0;
      });
    });
}
