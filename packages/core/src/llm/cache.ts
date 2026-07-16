/**
 * Segment cache (stored under .ductus/cache/<hash>.json): unchanged segments
 * are not regenerated — saves cost and keeps diffs stable.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaithfulnessViolation, LlmUsage } from '../contracts.js';

export interface CacheEntry {
  markdown: string;
  usage?: LlmUsage;
  violations: FaithfulnessViolation[];
  /** Unconfirmed judge/lexicon hints; absent in legacy entries (⇒ []). */
  hints?: FaithfulnessViolation[];
}

export interface CacheKeyParts {
  /** Canonically serialized segment (see serializeSegment). */
  segmentJson: string;
  promptVersion: string;
  model: string;
  /** Style-guide configuration, e.g. "formal-sie|de". */
  styleKey: string;
}

export class SegmentCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  computeKey(parts: CacheKeyParts): string {
    // Control character as separator so field boundaries cannot shift.
    const material = [parts.promptVersion, parts.model, parts.styleKey, parts.segmentJson].join(
      '\u001f',
    );
    return createHash('sha256').update(material, 'utf8').digest('hex');
  }

  get(key: string): CacheEntry | undefined {
    try {
      const raw = readFileSync(join(this.dir, `${key}.json`), 'utf8');
      const parsed = JSON.parse(raw) as CacheEntry;
      // Corrupt or foreign files count as a miss.
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.markdown === 'string' &&
        Array.isArray(parsed.violations)
      ) {
        return parsed;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  set(key: string, entry: CacheEntry): void {
    writeFileSync(join(this.dir, `${key}.json`), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  }
}
