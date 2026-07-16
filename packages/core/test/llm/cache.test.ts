import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SegmentCache, type CacheEntry, type CacheKeyParts } from '../../src/llm/cache.js';

const baseParts: CacheKeyParts = {
  segmentJson: '{"id": "auth"}',
  promptVersion: '1',
  model: 'test-model',
  styleKey: 'formal-sie|de',
};

function freshCache(): SegmentCache {
  return new SegmentCache(mkdtempSync(join(tmpdir(), 'ductus-cache-test-')));
}

describe('SegmentCache.computeKey', () => {
  it('returns a stable sha256 hex key', () => {
    const cache = freshCache();
    const a = cache.computeKey(baseParts);
    const b = cache.computeKey({ ...baseParts });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with every component', () => {
    const cache = freshCache();
    const base = cache.computeKey(baseParts);
    expect(cache.computeKey({ ...baseParts, model: 'anderes-modell' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, promptVersion: '2' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, styleKey: 'informal-du|de' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, segmentJson: '{"id": "billing"}' })).not.toBe(base);
  });
});

describe('SegmentCache get/set', () => {
  it('round-trips including usage and violations', () => {
    const cache = freshCache();
    const key = cache.computeKey(baseParts);
    expect(cache.get(key)).toBeUndefined();

    const entry: CacheEntry = {
      markdown: '## Doku\n',
      usage: { inputTokens: 10, outputTokens: 20 },
      violations: [{ claim: 'A', reason: 'B' }],
    };
    cache.set(key, entry);
    expect(cache.get(key)).toEqual(entry);
  });

  it('treats corrupt files as a miss', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-cache-test-'));
    const cache = new SegmentCache(dir);
    const key = cache.computeKey(baseParts);
    writeFileSync(join(dir, `${key}.json`), '{kein json', 'utf8');
    expect(cache.get(key)).toBeUndefined();

    // Valid JSON with the wrong shape also counts as a miss.
    writeFileSync(join(dir, `${key}.json`), '{"foo": 1}', 'utf8');
    expect(cache.get(key)).toBeUndefined();
  });
});
