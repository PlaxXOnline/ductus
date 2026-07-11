import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GeneratedSegment, GraphSegment } from '../../src/contracts.js';
import { buildReport, writeReport } from '../../src/report.js';

const adapters = [{ name: 'dart', version: '0.1.0' }];

function makeSegment(id: string): GraphSegment {
  return { id, kind: 'flow', title: id, order: 0, nodes: [], edges: [], exits: [] };
}

function makeGenerated(
  id: string,
  violations: GeneratedSegment['violations'],
  hints: GeneratedSegment['hints'] = [],
): GeneratedSegment {
  return { segment: makeSegment(id), markdown: '# x', fromCache: false, violations, hints };
}

describe('buildReport', () => {
  it('nimmt nur Segmente MIT Violations oder Hinweisen in faithfulness auf', () => {
    const report = buildReport({
      adapters,
      warnings: [],
      segments: [
        makeGenerated('clean', []),
        makeGenerated('dirty', [{ claim: 'Es gibt einen Zurück-Button', reason: 'nicht im Graph' }]),
      ],
    });
    expect(report.faithfulness).toEqual([
      {
        segmentId: 'dirty',
        violations: [{ claim: 'Es gibt einen Zurück-Button', reason: 'nicht im Graph' }],
      },
    ]);
  });

  it('führt unbestätigte Hinweise getrennt von Violations auf', () => {
    const report = buildReport({
      adapters,
      warnings: [],
      segments: [
        makeGenerated('hinted', [], [{ claim: 'Grenzfall', reason: 'nur lexikalisch verwandt' }]),
      ],
    });
    expect(report.faithfulness).toEqual([
      {
        segmentId: 'hinted',
        violations: [],
        hints: [{ claim: 'Grenzfall', reason: 'nur lexikalisch verwandt' }],
      },
    ]);
  });

  it('berechnet hitRate = hits/(hits+misses)', () => {
    const report = buildReport({ adapters, warnings: [], cache: { hits: 3, misses: 1 } });
    expect(report.cache).toEqual({ hits: 3, misses: 1, hitRate: 0.75 });
  });

  it('hitRate ist 0 bei 0 Läufen', () => {
    const report = buildReport({ adapters, warnings: [], cache: { hits: 0, misses: 0 } });
    expect(report.cache?.hitRate).toBe(0);
  });

  it('lässt optionale Felder weg, wenn keine Daten vorliegen', () => {
    const report = buildReport({ adapters, warnings: [] });
    expect(report).not.toHaveProperty('cache');
    expect(report).not.toHaveProperty('tokens');
    expect(report).not.toHaveProperty('costUsd');
    expect(report.faithfulness).toEqual([]);
  });

  it('übernimmt tokens, costUsd und warnings', () => {
    const warnings = [
      { rule: 'V5' as const, severity: 'warning' as const, message: 'Node ohne description', nodeId: 'a' },
    ];
    const report = buildReport({
      adapters,
      warnings,
      estimated: { inputTokens: 1000, outputTokens: 500 },
      usage: { inputTokens: 900, outputTokens: 480 },
      costUsd: 0.0123,
    });
    expect(report.tokens).toEqual({
      estimated: { inputTokens: 1000, outputTokens: 500 },
      actual: { inputTokens: 900, outputTokens: 480 },
    });
    expect(report.costUsd).toBe(0.0123);
    expect(report.warnings).toEqual(warnings);
    expect(report.adapters).toEqual(adapters);
  });

  it('nutzt now für generatedAt (deterministisch testbar)', () => {
    const now = new Date('2026-07-08T12:00:00.000Z');
    const report = buildReport({ adapters, warnings: [], now });
    expect(report.generatedAt).toBe('2026-07-08T12:00:00.000Z');
  });
});

describe('writeReport', () => {
  it('schreibt JSON mit 2-Space-Indent, sortierten Schlüsseln und Schluss-Newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-report-'));
    const filePath = join(dir, 'nested', 'ductus-report.json');
    const report = buildReport({
      adapters,
      warnings: [],
      segments: [makeGenerated('dirty', [{ claim: 'x', reason: 'y' }])],
      cache: { hits: 1, misses: 1 },
      estimated: { inputTokens: 10, outputTokens: 5 },
      usage: { inputTokens: 8, outputTokens: 4 },
      costUsd: 0.5,
      now: new Date('2026-07-08T00:00:00.000Z'),
    });
    writeReport(report, filePath);

    const raw = readFileSync(filePath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  "adapters"'); // 2-Space-Indent

    // Top-Level-Schlüssel lexikographisch sortiert
    const topKeys = [...raw.matchAll(/^  "([a-zA-Z]+)":/gm)].map((m) => m[1]);
    expect(topKeys).toEqual([...topKeys].sort());
    expect(topKeys).toEqual([
      'adapters',
      'cache',
      'costUsd',
      'faithfulness',
      'generatedAt',
      'tokens',
      'warnings',
    ]);

    // Auch verschachtelte Schlüssel sortiert (hitRate < hits < misses)
    expect(raw.indexOf('"hitRate"')).toBeLessThan(raw.indexOf('"hits"'));
    expect(raw.indexOf('"hits"')).toBeLessThan(raw.indexOf('"misses"'));

    // Roundtrip bleibt inhaltsgleich
    expect(JSON.parse(raw)).toEqual(report);
  });
});
