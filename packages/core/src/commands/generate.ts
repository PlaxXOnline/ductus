/**
 * `ductus generate`: extract + LLM generation → MDX/website.
 * Exit 1 on validation errors, exit 2 on faithfulness above threshold
 * (output is still written, violations are listed in the report), exit 3 on
 * config/LLM/adapter errors. `--build` additionally builds the website after
 * the export (npm ci/install + npm run build in the site directory).
 */

import { resolve } from 'node:path';
import type { Command } from 'commander';
import { buildWebsite } from '../output/website.js';
import { runGenerate } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerGenerate(program: Command): void {
  program
    .command('generate')
    .description('Generates end-user documentation (MDX or website) from the graph.')
    .option(
      '--build',
      'Build the website after the export: npm ci/install + npm run build in the site directory (output.format: website only)',
    )
    .action(async (options: { build?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);

        // Usage error: --offline guarantees "no network access" — npm ci/install
        // would break that. No silent fallback, exit 3.
        if (options.build === true && globals.offline === true) {
          process.stderr.write(
            'Error: --build cannot be combined with --offline — --offline guarantees ' +
              '"no network access", npm ci/install would break that.\n',
          );
          return 3;
        }

        const config = loadConfigWithWarnings(globals.config);

        // Usage error: --build only makes sense in website mode —
        // no silent fallback, exit 3.
        if (options.build === true && config.output.format !== 'website') {
          process.stderr.write(
            `Error: --build requires output.format: website (configured: "${config.output.format}").\n`,
          );
          return 3;
        }

        const run = await runGenerate(config, {
          ...(globals.offline !== undefined ? { offline: globals.offline } : {}),
          log: stderrLog,
        });

        if (run.extract.validation.errors.length > 0) {
          printIssues(run.extract.validation.errors);
          return 1;
        }

        const result = run.result;
        if (result !== undefined) {
          process.stdout.write(
            `Generated: ${result.segments.length} segment(s) ` +
              `(cache: ${result.cache.hits} hits, ${result.cache.misses} new)\n`,
          );
          process.stdout.write(
            `Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out ` +
              `(estimated: ${result.estimated.inputTokens} / ${result.estimated.outputTokens})` +
              (run.costUsd !== undefined ? `, cost ~${run.costUsd.toFixed(4)} USD` : '') +
              '\n',
          );
        }
        for (const path of run.writtenDocs) {
          process.stdout.write(`Wrote: ${path}\n`);
        }
        if (run.reportPath !== undefined) {
          process.stdout.write(`Report: ${run.reportPath}\n`);
        }

        const faithfulnessExceeded = run.violationsTotal > config.llm.faithfulnessThreshold;
        if (faithfulnessExceeded) {
          process.stderr.write(
            `Faithfulness: ${run.violationsTotal} violation(s) above threshold ` +
              `${config.llm.faithfulnessThreshold} — see the report for details.\n`,
          );
        }

        // Build only AFTER the faithfulness message: a successful build does
        // not mask exit 2; if the build fails, buildWebsite throws
        // WebsiteBuildError and its exit 3 wins (via runAction).
        if (options.build === true) {
          const siteDir = resolve(config.rootDir, config.output.dir);
          const distDir = await buildWebsite({ siteDir, log: stderrLog });
          process.stdout.write(`Website built: ${distDir}\n`);
        }

        return faithfulnessExceeded ? 2 : 0;
      });
    });
}
