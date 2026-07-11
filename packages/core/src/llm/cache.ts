/**
 * Segment-Cache (Ablage .ductus/cache/<hash>.json): unveränderte Segmente
 * werden nicht neu generiert — spart Kosten und stabilisiert Diffs.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaithfulnessViolation, LlmUsage } from '../contracts.js';

export interface CacheEntry {
  markdown: string;
  usage?: LlmUsage;
  violations: FaithfulnessViolation[];
  /** Unbestätigte Judge-/Lexikon-Hinweise; fehlt in Alt-Einträgen (⇒ []). */
  hints?: FaithfulnessViolation[];
}

export interface CacheKeyParts {
  /** Kanonisch serialisiertes Segment (siehe serializeSegment). */
  segmentJson: string;
  promptVersion: string;
  model: string;
  /** Styleguide-Konfiguration, z. B. "formal-sie|de". */
  styleKey: string;
}

export class SegmentCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  computeKey(parts: CacheKeyParts): string {
    // Steuerzeichen als Trenner, damit sich Feldgrenzen nicht verschieben können.
    const material = [parts.promptVersion, parts.model, parts.styleKey, parts.segmentJson].join(
      '\u001f',
    );
    return createHash('sha256').update(material, 'utf8').digest('hex');
  }

  get(key: string): CacheEntry | undefined {
    try {
      const raw = readFileSync(join(this.dir, `${key}.json`), 'utf8');
      const parsed = JSON.parse(raw) as CacheEntry;
      // Korrupte oder fremde Dateien zählen als Miss.
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
