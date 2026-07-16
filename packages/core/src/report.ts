/**
 * ductus-report.json (NFR3): warnings, faithfulness flags, cache hit rate,
 * token/cost report. The only artifact with a timestamp — journey-graph.json
 * stays timestamp-free in favor of byte stability (NFR2).
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
  /** Only when llm.pricing is configured — without prices, only tokens are reported. */
  costUsd?: number;
  /** Injectable for deterministic tests. */
  now?: Date;
}

export function buildReport(input: BuildReportInput): DuctusReport {
  // Include only segments with violations or hints — keeps the report readable.
  const faithfulness = (input.segments ?? [])
    .filter((generated) => generated.violations.length > 0 || generated.hints.length > 0)
    .map((generated) => ({
      segmentId: generated.segment.id,
      violations: generated.violations,
      ...(generated.hints.length > 0 ? { hints: generated.hints } : {}),
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

/** Sort object keys recursively and lexicographically (canonical, diff-stable serialization). */
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
