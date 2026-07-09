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
  it('liefert einen stabilen sha256-Hex-Key', () => {
    const cache = freshCache();
    const a = cache.computeKey(baseParts);
    const b = cache.computeKey({ ...baseParts });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ändert sich mit jedem Bestandteil', () => {
    const cache = freshCache();
    const base = cache.computeKey(baseParts);
    expect(cache.computeKey({ ...baseParts, model: 'anderes-modell' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, promptVersion: '2' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, styleKey: 'informal-du|de' })).not.toBe(base);
    expect(cache.computeKey({ ...baseParts, segmentJson: '{"id": "billing"}' })).not.toBe(base);
  });
});

describe('SegmentCache get/set', () => {
  it('macht einen Roundtrip inklusive usage und violations', () => {
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

  it('behandelt korrupte Dateien als Miss', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductus-cache-test-'));
    const cache = new SegmentCache(dir);
    const key = cache.computeKey(baseParts);
    writeFileSync(join(dir, `${key}.json`), '{kein json', 'utf8');
    expect(cache.get(key)).toBeUndefined();

    // Valides JSON mit falscher Form zählt ebenfalls als Miss.
    writeFileSync(join(dir, `${key}.json`), '{"foo": 1}', 'utf8');
    expect(cache.get(key)).toBeUndefined();
  });
});
