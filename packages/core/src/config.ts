/**
 * Laden und Validieren der ductus.config.yaml.
 *
 * Fehlende Werte werden mit Defaults gefüllt; harte Fehler (kaputtes YAML,
 * fehlende Pflichtfelder, ungültige Enum-Werte) werfen ConfigError mit
 * präziser deutscher Meldung. Unbekannte Top-Level-Schlüssel sind nur
 * Warnungen (vorwärtskompatibel).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import type {
  AdapterConfigEntry,
  DuctusConfig,
  Granularity,
  LlmConfig,
  OutputFormat,
  Voice,
  WebsiteGenerator,
} from './contracts.js';

/** Konfigurationsfehler ⇒ Exit-Code 3. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigResult {
  config: DuctusConfig;
  /** Unbekannte Top-Level-Schlüssel u. Ä. — keine Fehler (vorwärtskompatibel, nur warnen). */
  warnings: string[];
}

// ─────────────────────────────── Defaults ────────────────────────────────────

const KNOWN_TOP_LEVEL_KEYS = ['app', 'adapters', 'llm', 'style', 'output'] as const;

const LLM_PROVIDERS = ['anthropic', 'openai', 'mistral', 'custom', 'mock'] as const;
const VOICES: readonly Voice[] = ['formal-sie', 'informal-du', 'en-you'];
const GRANULARITIES: readonly Granularity[] = ['flow', 'screen'];
const OUTPUT_FORMATS: readonly OutputFormat[] = ['mdx', 'website'];
const WEBSITE_GENERATORS: readonly WebsiteGenerator[] = ['journey', 'starlight', 'docusaurus'];

const LLM_DEFAULTS = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKeyEnv: 'DUCTUS_LLM_API_KEY',
  temperature: 0.2,
  maxTokens: 2048,
  faithfulnessCheck: true,
  faithfulnessThreshold: 0,
} as const;

// ─────────────────────────────── Hilfsfunktionen ─────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`"${path}" muss ein nicht-leerer String sein.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, path);
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ConfigError(`"${path}" muss eine Zahl sein.`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new ConfigError(`"${path}" muss true oder false sein.`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`"${path}" muss eine Liste von Strings sein.`);
  }
  return value as string[];
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ConfigError(
      `"${path}" muss einer von ${allowed.join(' | ')} sein (gefunden: ${JSON.stringify(value)}).`,
    );
  }
  return value as T;
}

// ─────────────────────────────── adapters-Sektion ────────────────────────────

const ADAPTER_KNOWN_KEYS = new Set(['name', 'project', 'deriveFrom', 'command', 'extra']);

/**
 * Baut einen AdapterConfigEntry aus name + Options-Map; unbekannte Keys ⇒ extra.
 *
 * Ein literaler `extra:`-Block wird dabei **abgeflacht**: seine Schlüssel
 * landen direkt in `entry.extra` und damit top-level in der temporären
 * `--config`-JSON des Adapters (z. B. `extra: { fromBuilder: true }`
 * ⇒ `{"fromBuilder": true}`) — sonst entstünde eine doppelte Verschachtelung
 * `{"extra": {...}}`, die Adapter stillschweigend ignorieren würden.
 * Unbekannte flache Schlüssel gewinnen bei Gleichheit über den Block.
 */
function buildAdapterEntry(
  name: string,
  options: Record<string, unknown>,
  path: string,
): AdapterConfigEntry {
  const project = optionalString(options['project'], `${path}.project`) ?? '.';
  const deriveFrom = optionalStringArray(options['deriveFrom'], `${path}.deriveFrom`);
  const command = optionalString(options['command'], `${path}.command`);

  const extra: Record<string, unknown> = {};
  const extraBlock = options['extra'];
  if (extraBlock !== undefined && extraBlock !== null) {
    if (!isRecord(extraBlock)) {
      throw new ConfigError(`"${path}.extra" muss eine Map mit Adapter-Optionen sein.`);
    }
    Object.assign(extra, extraBlock);
  }
  for (const key of Object.keys(options)) {
    if (!ADAPTER_KNOWN_KEYS.has(key)) extra[key] = options[key];
  }

  return {
    name,
    project,
    ...(deriveFrom !== undefined ? { deriveFrom } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/**
 * Parst einen Eintrag der adapters-Liste. Unterstützt das Spec-Format
 * (Ein-Schlüssel-Map: `- dart:\n    project: .`), tolerant auch
 * `- name: dart` sowie den Kurzstring `- dart`.
 */
function parseAdapterEntry(item: unknown, index: number): AdapterConfigEntry {
  const path = `adapters[${index}]`;

  if (typeof item === 'string') {
    return buildAdapterEntry(requireString(item, path), {}, path);
  }
  if (!isRecord(item)) {
    throw new ConfigError(
      `"${path}" muss eine Map sein (z. B. "- dart:" mit eingerückten Optionen).`,
    );
  }

  // Tolerantes Format: `- name: dart` (Optionen auf derselben Ebene).
  if (typeof item['name'] === 'string') {
    return buildAdapterEntry(requireString(item['name'], `${path}.name`), item, path);
  }

  // Spec-Format: genau ein Schlüssel = Adapter-Name, Wert = Options-Map (oder null).
  const keys = Object.keys(item);
  if (keys.length !== 1) {
    throw new ConfigError(
      `"${path}" muss genau einen Adapter-Namen als Schlüssel haben ` +
        `(gefunden: ${keys.length === 0 ? 'keinen' : keys.map((k) => `"${k}"`).join(', ')}). ` +
        `Alternativ das Format "- name: <adapter>" verwenden.`,
    );
  }
  const name = keys[0]!;
  const options = item[name];
  if (options !== null && options !== undefined && !isRecord(options)) {
    throw new ConfigError(`"${path}.${name}" muss eine Map mit Adapter-Optionen sein.`);
  }
  return buildAdapterEntry(name, isRecord(options) ? options : {}, `${path}.${name}`);
}

// ─────────────────────────────── Sektions-Parser ─────────────────────────────

function parseApp(raw: unknown): DuctusConfig['app'] {
  if (!isRecord(raw)) {
    throw new ConfigError('Pflichtsektion "app" fehlt oder ist keine Map.');
  }
  const name = requireString(raw['name'], 'app.name');
  const locale = optionalString(raw['locale'], 'app.locale') ?? 'de';
  const platforms = optionalStringArray(raw['platforms'], 'app.platforms');
  return { name, locale, ...(platforms !== undefined ? { platforms } : {}) };
}

function parseAdapters(raw: unknown): AdapterConfigEntry[] {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
    throw new ConfigError('Pflichtsektion "adapters" fehlt oder ist leer (mindestens ein Adapter nötig).');
  }
  if (!Array.isArray(raw)) {
    throw new ConfigError('"adapters" muss eine Liste sein (z. B. "- dart:").');
  }
  return raw.map((item, index) => parseAdapterEntry(item, index));
}

function parseLlm(raw: unknown): LlmConfig {
  const section = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(section)) throw new ConfigError('"llm" muss eine Map sein.');

  const provider = requireEnum(section['provider'], LLM_PROVIDERS, 'llm.provider', LLM_DEFAULTS.provider);
  const model = optionalString(section['model'], 'llm.model') ?? LLM_DEFAULTS.model;
  const apiKeyEnv = optionalString(section['apiKeyEnv'], 'llm.apiKeyEnv') ?? LLM_DEFAULTS.apiKeyEnv;
  const baseUrl = optionalString(section['baseUrl'], 'llm.baseUrl');
  const temperature = optionalNumber(section['temperature'], 'llm.temperature') ?? LLM_DEFAULTS.temperature;
  const maxTokens = optionalNumber(section['maxTokens'], 'llm.maxTokens') ?? LLM_DEFAULTS.maxTokens;
  const faithfulnessCheck =
    optionalBoolean(section['faithfulnessCheck'], 'llm.faithfulnessCheck') ??
    LLM_DEFAULTS.faithfulnessCheck;
  const faithfulnessThreshold =
    optionalNumber(section['faithfulnessThreshold'], 'llm.faithfulnessThreshold') ??
    LLM_DEFAULTS.faithfulnessThreshold;

  if (faithfulnessThreshold < 0) {
    throw new ConfigError('"llm.faithfulnessThreshold" darf nicht negativ sein.');
  }
  if (maxTokens <= 0 || !Number.isInteger(maxTokens)) {
    throw new ConfigError('"llm.maxTokens" muss eine positive Ganzzahl sein.');
  }
  if (provider === 'custom' && baseUrl === undefined) {
    throw new ConfigError('"llm.baseUrl" ist Pflicht, wenn llm.provider "custom" ist.');
  }

  let pricing: LlmConfig['pricing'];
  const rawPricing = section['pricing'];
  if (rawPricing !== undefined && rawPricing !== null) {
    if (!isRecord(rawPricing)) throw new ConfigError('"llm.pricing" muss eine Map sein.');
    const inputPerMTokUsd = optionalNumber(rawPricing['inputPerMTokUsd'], 'llm.pricing.inputPerMTokUsd');
    const outputPerMTokUsd = optionalNumber(rawPricing['outputPerMTokUsd'], 'llm.pricing.outputPerMTokUsd');
    if (inputPerMTokUsd === undefined || outputPerMTokUsd === undefined) {
      throw new ConfigError(
        '"llm.pricing" braucht beide Werte: inputPerMTokUsd und outputPerMTokUsd (USD je 1M Token).',
      );
    }
    pricing = { inputPerMTokUsd, outputPerMTokUsd };
  }

  return {
    provider,
    model,
    apiKeyEnv,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    temperature,
    maxTokens,
    faithfulnessCheck,
    faithfulnessThreshold,
    ...(pricing !== undefined ? { pricing } : {}),
  };
}

function parseStyle(raw: unknown): DuctusConfig['style'] {
  const section = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(section)) throw new ConfigError('"style" muss eine Map sein.');
  return {
    voice: requireEnum(section['voice'], VOICES, 'style.voice', 'formal-sie'),
    granularity: requireEnum(section['granularity'], GRANULARITIES, 'style.granularity', 'flow'),
  };
}

function parseOutput(raw: unknown): DuctusConfig['output'] {
  const section = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(section)) throw new ConfigError('"output" muss eine Map sein.');

  const rawWebsite = section['website'] === undefined || section['website'] === null ? {} : section['website'];
  if (!isRecord(rawWebsite)) throw new ConfigError('"output.website" muss eine Map sein.');
  const template = optionalString(rawWebsite['template'], 'output.website.template');

  return {
    format: requireEnum(section['format'], OUTPUT_FORMATS, 'output.format', 'mdx'),
    dir: optionalString(section['dir'], 'output.dir') ?? 'docs/',
    website: {
      generator: requireEnum(rawWebsite['generator'], WEBSITE_GENERATORS, 'output.website.generator', 'journey'),
      diagrams: optionalBoolean(rawWebsite['diagrams'], 'output.website.diagrams') ?? true,
      ...(template !== undefined ? { template } : {}),
    },
  };
}

// ─────────────────────────────── loadConfig ──────────────────────────────────

export function loadConfig(configPath: string): LoadConfigResult {
  const absolutePath = resolve(configPath);

  let text: string;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch {
    throw new ConfigError(
      `Konfigurationsdatei nicht lesbar: "${absolutePath}". Mit "ductus init" anlegen oder Pfad via -c angeben.`,
    );
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Ungültiges YAML in "${absolutePath}": ${detail}`);
  }
  if (!isRecord(raw)) {
    throw new ConfigError(`"${absolutePath}" muss eine YAML-Map mit den Sektionen app/adapters/… sein.`);
  }

  const warnings: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(KNOWN_TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      warnings.push(`Unbekannter Top-Level-Schlüssel "${key}" wird ignoriert.`);
    }
  }

  const config: DuctusConfig = {
    app: parseApp(raw['app']),
    adapters: parseAdapters(raw['adapters']),
    llm: parseLlm(raw['llm']),
    style: parseStyle(raw['style']),
    output: parseOutput(raw['output']),
    rootDir: dirname(absolutePath),
  };

  return { config, warnings };
}

// ─────────────────────────────── defaultConfigYaml (init) ────────────────────

/** Adapter, für die `ductus init` eine Vorlage erzeugen kann. */
export type InitAdapterName = 'dart' | 'typescript';

const INIT_DERIVE_DEFAULTS: Record<InitAdapterName, string[]> = {
  dart: ['go_router', 'auto_route'],
  typescript: ['react-router', 'next'],
};

export interface DefaultConfigOptions {
  appName?: string;
  locale?: string;
  /** Adapter der Vorlage; Default: dart. */
  adapter?: InitAdapterName;
  /** Erkannte Ableitungsquellen; Default je Adapter (siehe INIT_DERIVE_DEFAULTS). */
  deriveFrom?: string[];
}

/** YAML-sicherer Skalar: einfache Bezeichner bleiben roh, Rest wird gequotet. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

/** Kommentierte Konfigurationsvorlage für `ductus init`. */
export function defaultConfigYaml(opts: DefaultConfigOptions = {}): string {
  const appName = opts.appName ?? 'MyApp';
  const locale = opts.locale ?? 'de';
  const adapter = opts.adapter ?? 'dart';
  const deriveFrom = opts.deriveFrom && opts.deriveFrom.length > 0
    ? opts.deriveFrom
    : INIT_DERIVE_DEFAULTS[adapter];

  return [
    '# Ductus-Konfiguration',
    'app:',
    `  name: ${yamlScalar(appName)}`,
    `  locale: ${yamlScalar(locale)}`,
    '',
    'adapters:',
    `  - ${adapter}:`,
    '      project: .',
    `      deriveFrom: [${deriveFrom.map(yamlScalar).join(', ')}]`,
    '',
    'llm:',
    '  provider: anthropic        # anthropic | openai | mistral | custom | mock',
    `  model: ${LLM_DEFAULTS.model}`,
    `  apiKeyEnv: ${LLM_DEFAULTS.apiKeyEnv}`,
    '  temperature: 0.2',
    '  faithfulnessCheck: true',
    '',
    'style:',
    '  voice: formal-sie          # formal-sie | informal-du | en-you',
    '  granularity: flow          # flow | screen',
    '',
    'output:',
    '  format: mdx                # mdx | website',
    '  dir: docs/',
    '  website:',
    '    generator: journey       # journey | starlight | docusaurus',
    '    diagrams: true',
    '',
  ].join('\n');
}
