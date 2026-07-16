import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JourneyGraph } from '@ductus/schema';
import type { LlmConfig, LlmProvider } from '../../src/contracts.js';
import { generateDocs } from '../../src/llm/generate.js';
import { JUDGE_MARKER } from '../../src/llm/prompts.js';
import { createProvider } from '../../src/llm/providers.js';

const graph: JourneyGraph = {
  schemaVersion: '1.0',
  flows: [{ id: 'auth', title: 'Anmeldung', start: 'login' }],
  nodes: [
    { id: 'login', type: 'screen', title: 'Login', flow: 'auth', source: 'derived' },
    { id: 'dashboard', type: 'screen', title: 'Dashboard', flow: 'auth', source: 'derived' },
    { id: 'settings', type: 'screen', title: 'Einstellungen', source: 'derived' },
  ],
  edges: [
    { id: 'e1', from: 'login', to: 'dashboard', trigger: 'tap', label: 'Anmelden', source: 'annotation' },
    { id: 'e2', from: 'dashboard', to: 'settings', trigger: 'tap', source: 'derived' },
  ],
};

const llm: LlmConfig = {
  provider: 'mock',
  model: 'mock-1',
  apiKeyEnv: 'UNUSED',
  temperature: 0,
  maxTokens: 1000,
  faithfulnessCheck: true,
  faithfulnessThreshold: 0,
};

function options(cacheDir: string, log?: (msg: string) => void) {
  return {
    graph,
    provider: createProvider(llm, {}),
    llm,
    voice: 'formal-sie' as const,
    locale: 'de',
    granularity: 'flow' as const,
    cacheDir,
    ...(log ? { log } : {}),
  };
}

describe('generateDocs', () => {
  it('generates all segments on the first run (misses) and serves the second entirely from cache', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'ductus-generate-test-'));

    const first = await generateDocs(options(cacheDir));
    // Flow "auth" + "_misc" (settings without a flow).
    expect(first.segments.map((s) => s.segment.id)).toEqual(['auth', '_misc']);
    expect(first.cache).toEqual({ hits: 0, misses: 2 });
    expect(first.segments.every((s) => !s.fromCache)).toBe(true);
    expect(first.segments.every((s) => s.violations.length === 0)).toBe(true);
    expect(first.usage.inputTokens).toBeGreaterThan(0);
    expect(first.usage.outputTokens).toBeGreaterThan(0);
    expect(first.estimated.inputTokens).toBeGreaterThan(0);
    expect(first.estimated.outputTokens).toBeGreaterThan(0);
    expect(readdirSync(cacheDir)).toHaveLength(2);

    const second = await generateDocs(options(cacheDir));
    expect(second.cache).toEqual({ hits: 2, misses: 0 });
    expect(second.segments.every((s) => s.fromCache)).toBe(true);
    // No real calls ⇒ usage 0.
    expect(second.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    // Determinism: Markdown byte-identical to the first run.
    expect(second.segments.map((s) => s.markdown)).toEqual(first.segments.map((s) => s.markdown));
    expect(second.segments.every((s) => s.violations.length === 0)).toBe(true);
    // The estimate is identical regardless of the cache.
    expect(second.estimated).toEqual(first.estimated);
  });

  it('estimates fewer tokens without faithfulnessCheck and calls no judge', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'ductus-generate-test-'));
    const withCheck = await generateDocs(options(mkdtempSync(join(tmpdir(), 'ductus-generate-test-'))));
    const noCheckLlm: LlmConfig = { ...llm, faithfulnessCheck: false };
    const withoutCheck = await generateDocs({
      ...options(cacheDir),
      llm: noCheckLlm,
      provider: createProvider(noCheckLlm, {}),
    });
    expect(withoutCheck.estimated.inputTokens).toBeLessThan(withCheck.estimated.inputTokens);
    expect(withoutCheck.estimated.outputTokens).toBeLessThan(withCheck.estimated.outputTokens);
    expect(withoutCheck.segments.every((s) => s.violations.length === 0)).toBe(true);
  });

  it('does not cache segments whose judge response was unparsable', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'ductus-generate-test-'));
    let judgeCalls = 0;
    const flakyJudgeProvider: LlmProvider = {
      name: 'flaky-judge',
      complete: (request) => {
        if (request.system.includes(JUDGE_MARKER)) {
          judgeCalls += 1;
          // The first judge call returns prose instead of JSON, then valid JSON.
          const text = judgeCalls === 1 ? 'Kein JSON, sorry.' : '{"violations": []}';
          return Promise.resolve({ text });
        }
        return Promise.resolve({ text: '## Doku' });
      },
    };

    const first = await generateDocs({ ...options(cacheDir), provider: flakyJudgeProvider });
    expect(first.segments[0]!.violations[0]!.claim).toBe('(judge response unparsable)');
    // Only the second (successful) segment is in the cache.
    expect(readdirSync(cacheDir)).toHaveLength(1);

    const second = await generateDocs({ ...options(cacheDir), provider: flakyJudgeProvider });
    // The failed segment is regenerated and this time judged cleanly.
    expect(second.cache).toEqual({ hits: 1, misses: 1 });
    expect(second.segments.every((s) => s.violations.length === 0)).toBe(true);
    expect(readdirSync(cacheDir)).toHaveLength(2);
  });

  it('reports progress via the optional log callback', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'ductus-generate-test-'));
    const logs: string[] = [];
    await generateDocs(options(cacheDir, (msg) => logs.push(msg)));
    expect(logs.some((m) => m.includes('auth'))).toBe(true);

    logs.length = 0;
    await generateDocs(options(cacheDir, (msg) => logs.push(msg)));
    expect(logs.some((m) => m.includes('served from cache'))).toBe(true);
  });
});
