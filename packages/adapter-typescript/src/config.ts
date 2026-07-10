/**
 * Adapter-Konfiguration aus der temporären --config-JSON des Core
 * (adapters:-Sektion der ductus.config.yaml, abgeflacht auf top-level).
 */

import { readFileSync } from 'node:fs';
import { AdapterException } from './graph-model.js';

/** Ableitungsquellen (Weg C), die dieser Adapter kennt. */
export const KNOWN_DERIVE_SOURCES = ['react-router', 'next'] as const;

const DEFAULT_DERIVE_FROM: readonly string[] = [...KNOWN_DERIVE_SOURCES];

/**
 * Default-Globs: die üblichen Quellwurzeln von TS/JS-Projekten. Wer Code
 * außerhalb hält, setzt `include` explizit in der adapters:-Sektion.
 */
const DEFAULT_INCLUDE: readonly string[] = ['src/**', 'app/**', 'pages/**', 'lib/**'];

export class AdapterConfig {
  readonly deriveFrom: readonly string[];
  readonly include: readonly string[];

  constructor(opts: { deriveFrom?: readonly string[]; include?: readonly string[] } = {}) {
    this.deriveFrom = opts.deriveFrom ?? DEFAULT_DERIVE_FROM;
    this.include = opts.include ?? DEFAULT_INCLUDE;
  }

  get deriveReactRouter(): boolean {
    return this.deriveFrom.includes('react-router');
  }

  get deriveNext(): boolean {
    return this.deriveFrom.includes('next');
  }

  static load(path: string | undefined): AdapterConfig {
    if (path === undefined) return new AdapterConfig();

    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new AdapterException([`Konfigurationsdatei nicht gefunden: ${path}`]);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AdapterException([`Ungültiges JSON in ${path}: ${detail}`]);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AdapterException([`${path}: erwartet ein JSON-Objekt.`]);
    }
    const record = raw as Record<string, unknown>;

    return new AdapterConfig({
      ...(record['deriveFrom'] !== undefined
        ? { deriveFrom: stringList(record['deriveFrom'], 'deriveFrom', path) }
        : {}),
      ...(record['include'] !== undefined
        ? { include: stringList(record['include'], 'include', path) }
        : {}),
    });
  }
}

function stringList(value: unknown, key: string, path: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new AdapterException([`${path}: "${key}" muss eine Liste von Strings sein.`]);
  }
  return value as string[];
}
