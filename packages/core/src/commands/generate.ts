/**
 * `ductus generate` (SPEC §10.1): extract + LLM-Generierung → MDX/Website.
 * Exit 1 bei Validierungsfehlern, Exit 2 bei Faithfulness über Schwellwert
 * (Output wird trotzdem geschrieben, Verstöße stehen im Report), Exit 3 bei
 * Config-/LLM-/Adapterfehlern (DD §I). `--build` baut nach dem Website-Export
 * zusätzlich die Website (npm ci/install + npm run build, DD §M).
 */

import { resolve } from 'node:path';
import type { Command } from 'commander';
import { buildWebsite } from '../output/website.js';
import { runGenerate } from '../pipeline.js';
import { globalOptions, loadConfigWithWarnings, printIssues, runAction, stderrLog } from './shared.js';

export function registerGenerate(program: Command): void {
  program
    .command('generate')
    .description('Erzeugt Endnutzer-Dokumentation (MDX oder Website) aus dem Graphen.')
    .option(
      '--build',
      'Website nach dem Export bauen: npm ci/install + npm run build im Site-Verzeichnis (nur output.format: website)',
    )
    .action(async (options: { build?: boolean }, command: Command) => {
      await runAction(async () => {
        const globals = globalOptions(command);

        // Usage-Fehler (DD §M): --offline garantiert "kein Netz" — npm ci/install
        // würde das brechen. Kein stiller Fallback, Exit 3 (DD §I).
        if (options.build === true && globals.offline === true) {
          process.stderr.write(
            'Fehler: --build kann nicht mit --offline kombiniert werden — --offline garantiert ' +
              '"kein Netzzugriff", npm ci/install würde das brechen.\n',
          );
          return 3;
        }

        const config = loadConfigWithWarnings(globals.config);

        // Usage-Fehler (DD §M): --build ist nur im Website-Modus sinnvoll —
        // kein stiller Fallback, Exit 3 (DD §I).
        if (options.build === true && config.output.format !== 'website') {
          process.stderr.write(
            `Fehler: --build erfordert output.format: website (konfiguriert: "${config.output.format}").\n`,
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
            `Generiert: ${result.segments.length} Segment(e) ` +
              `(Cache: ${result.cache.hits} Treffer, ${result.cache.misses} neu)\n`,
          );
          process.stdout.write(
            `Token: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out ` +
              `(geschätzt: ${result.estimated.inputTokens} / ${result.estimated.outputTokens})` +
              (run.costUsd !== undefined ? `, Kosten ~${run.costUsd.toFixed(4)} USD` : '') +
              '\n',
          );
        }
        for (const path of run.writtenDocs) {
          process.stdout.write(`Geschrieben: ${path}\n`);
        }
        if (run.reportPath !== undefined) {
          process.stdout.write(`Report: ${run.reportPath}\n`);
        }

        const faithfulnessExceeded = run.violationsTotal > config.llm.faithfulnessThreshold;
        if (faithfulnessExceeded) {
          process.stderr.write(
            `Faithfulness: ${run.violationsTotal} Verstoß/Verstöße über Schwellwert ` +
              `${config.llm.faithfulnessThreshold} — Details im Report.\n`,
          );
        }

        // Build erst NACH der Faithfulness-Meldung (DD §M): ein erfolgreicher
        // Build maskiert Exit 2 nicht; scheitert der Build, wirft buildWebsite
        // WebsiteBuildError und dessen Exit 3 gewinnt (via runAction).
        if (options.build === true) {
          const siteDir = resolve(config.rootDir, config.output.dir);
          const distDir = await buildWebsite({ siteDir, log: stderrLog });
          process.stdout.write(`Website gebaut: ${distDir}\n`);
        }

        return faithfulnessExceeded ? 2 : 0;
      });
    });
}
