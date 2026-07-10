/**
 * ductus-report.json (NFR3): Warnungen, Faithfulness-Flags, Cache-Trefferquote,
 * Token-/Kosten-Bericht. Einziges Artefakt mit Zeitstempel — journey-graph.json
 * bleibt zugunsten der Byte-Stabilität (NFR2) zeitstempelfrei.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AdapterInfo } from '@ductus/schema';
import type { DuctusReport, GeneratedSegment, LlmUsage, ValidationIssue } from './contracts.js';

export interface BuildReportInput {
  adapters: AdapterInfo[];
  warnings: ValidationIssue[];
  segments?: GeneratedSegment[];
  cache?: { hits: number; misses: number };
  estimated?: { inputTokens: number; outputTokens: number };
  usage?: LlmUsage;
  /** Nur wenn llm.pricing konfiguriert ist — ohne Preise wird nur in Token berichtet. */
  costUsd?: number;
  /** Injizierbar für deterministische Tests. */
  now?: Date;
}

export function buildReport(input: BuildReportInput): DuctusReport {
  // Nur Segmente mit tatsächlichen Verstößen aufnehmen — der Report bleibt lesbar.
  const faithfulness = (input.segments ?? [])
    .filter((generated) => generated.violations.length > 0)
    .map((generated) => ({
      segmentId: generated.segment.id,
      violations: generated.violations,
    }));

  const cache = input.cache;
  const totalRuns = cache ? cache.hits + cache.misses : 0;

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    adapters: input.adapters,
    warnings: input.warnings,
    faithfulness,
    ...(cache
      ? {
          cache: {
            hits: cache.hits,
            misses: cache.misses,
            hitRate: totalRuns > 0 ? cache.hits / totalRuns : 0,
          },
        }
      : {}),
    ...(input.estimated && input.usage
      ? { tokens: { estimated: input.estimated, actual: input.usage } }
      : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
  };
}

/** Objekt-Schlüssel rekursiv lexikographisch sortieren (kanonische, diff-stabile Serialisierung). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

export function writeReport(report: DuctusReport, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(sortKeysDeep(report), null, 2)}\n`, 'utf8');
}
