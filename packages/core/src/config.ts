/**
 * Loading and validation of ductus.config.yaml.
 *
 * Missing values are filled with defaults; hard errors (broken YAML, missing
 * required fields, invalid enum values) throw ConfigError with a precise
 * message. Unknown top-level keys are only warnings (forward-compatible).
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

/** Configuration error ⇒ exit code 3. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigResult {
  config: DuctusConfig;
  /** Unknown top-level keys and the like — not errors (forward-compatible, warn only). */
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

// ─────────────────────────────── Helpers ─────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`"${path}" must be a non-empty string.`);
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
    throw new ConfigError(`"${path}" must be a number.`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new ConfigError(`"${path}" must be true or false.`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ConfigError(`"${path}" must be a list of strings.`);
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
      `"${path}" must be one of ${allowed.join(' | ')} (found: ${JSON.stringify(value)}).`,
    );
  }
  return value as T;
}

// ─────────────────────────────── adapters section ────────────────────────────

const ADAPTER_KNOWN_KEYS = new Set(['name', 'project', 'deriveFrom', 'command', 'extra']);

/**
 * Builds an AdapterConfigEntry from name + options map; unknown keys ⇒ extra.
 *
 * A literal `extra:` block is **flattened** in the process: its keys end up
 * directly in `entry.extra` and thus top-level in the adapter's temporary
 * `--config` JSON (e.g. `extra: { fromBuilder: true }`
 * ⇒ `{"fromBuilder": true}`) — otherwise a double nesting `{"extra": {...}}`
 * would result, which adapters would silently ignore.
 * Unknown flat keys win over the block when both are set.
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
      throw new ConfigError(`"${path}.extra" must be a map of adapter options.`);
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
 * Parses one entry of the adapters list. Supports the spec format
 * (single-key map: `- dart:\n    project: .`), tolerantly also
 * `- name: dart` as well as the shorthand string `- dart`.
 */
function parseAdapterEntry(item: unknown, index: number): AdapterConfigEntry {
  const path = `adapters[${index}]`;

  if (typeof item === 'string') {
    return buildAdapterEntry(requireString(item, path), {}, path);
  }
  if (!isRecord(item)) {
    throw new ConfigError(
      `"${path}" must be a map (e.g. "- dart:" with indented options).`,
    );
  }

  // Tolerant format: `- name: dart` (options on the same level).
  if (typeof item['name'] === 'string') {
    return buildAdapterEntry(requireString(item['name'], `${path}.name`), item, path);
  }

  // Spec format: exactly one key = adapter name, value = options map (or null).
  const keys = Object.keys(item);
  if (keys.length !== 1) {
    throw new ConfigError(
      `"${path}" must have exactly one adapter name as its key ` +
        `(found: ${keys.length === 0 ? 'none' : keys.map((k) => `"${k}"`).join(', ')}). ` +
        `Alternatively use the format "- name: <adapter>".`,
    );
  }
  const name = keys[0]!;
  const options = item[name];
  if (options !== null && options !== undefined && !isRecord(options)) {
    throw new ConfigError(`"${path}.${name}" must be a map of adapter options.`);
  }
  return buildAdapterEntry(name, isRecord(options) ? options : {}, `${path}.${name}`);
}

// ─────────────────────────────── Section parsers ─────────────────────────────

function parseApp(raw: unknown): DuctusConfig['app'] {
  if (!isRecord(raw)) {
    throw new ConfigError('Required section "app" is missing or not a map.');
  }
  const name = requireString(raw['name'], 'app.name');
  const locale = optionalString(raw['locale'], 'app.locale') ?? 'en';
  const platforms = optionalStringArray(raw['platforms'], 'app.platforms');
  return { name, locale, ...(platforms !== undefined ? { platforms } : {}) };
}

function parseAdapters(raw: unknown): AdapterConfigEntry[] {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
    throw new ConfigError('Required section "adapters" is missing or empty (at least one adapter is required).');
  }
  if (!Array.isArray(raw)) {
    throw new ConfigError('"adapters" must be a list (e.g. "- dart:").');
  }
  return raw.map((item, index) => parseAdapterEntry(item, index));
}

function parseLlm(raw: unknown): LlmConfig {
  const section = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(section)) throw new ConfigError('"llm" must be a map.');

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
    throw new ConfigError('"llm.faithfulnessThreshold" must not be negative.');
  }
  if (maxTokens <= 0 || !Number.isInteger(maxTokens)) {
    throw new ConfigError('"llm.maxTokens" must be a positive integer.');
  }
  if (provider === 'custom' && baseUrl === undefined) {
    throw new ConfigError('"llm.baseUrl" is required when llm.provider is "custom".');
  }

  let pricing: LlmConfig['pricing'];
  const rawPricing = section['pricing'];
  if (rawPricing !== undefined && rawPricing !== null) {
    if (!isRecord(rawPricing)) throw new ConfigError('"llm.pricing" must be a map.');
    const inputPerMTokUsd = optionalNumber(rawPricing['inputPerMTokUsd'], 'llm.pricing.inputPerMTokUsd');
    const outputPerMTokUsd = optionalNumber(rawPricing['outputPerMTokUsd'], 'llm.pricing.outputPerMTokUsd');
    if (inputPerMTokUsd === undefined || outputPerMTokUsd === undefined) {
      throw new ConfigError(
        '"llm.pricing" requires both values: inputPerMTokUsd and outputPerMTokUsd (USD per 1M tokens).',
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
  if (!isRecord(section)) throw new ConfigError('"style" must be a map.');
  return {
    voice: requireEnum(section['voice'], VOICES, 'style.voice', 'en-you'),
    granularity: requireEnum(section['granularity'], GRANULARITIES, 'style.granularity', 'flow'),
  };
}

function parseOutput(raw: unknown): DuctusConfig['output'] {
  const section = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(section)) throw new ConfigError('"output" must be a map.');

  const rawWebsite = section['website'] === undefined || section['website'] === null ? {} : section['website'];
  if (!isRecord(rawWebsite)) throw new ConfigError('"output.website" must be a map.');
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
      `Cannot read config file: "${absolutePath}". Create it with "ductus init" or pass a path via -c.`,
    );
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid YAML in "${absolutePath}": ${detail}`);
  }
  if (!isRecord(raw)) {
    throw new ConfigError(`"${absolutePath}" must be a YAML map with the sections app/adapters/….`);
  }

  const warnings: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(KNOWN_TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      warnings.push(`Unknown top-level key "${key}" is ignored.`);
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

/** Adapters for which `ductus init` can generate a template. */
export type InitAdapterName = 'dart' | 'typescript';

const INIT_DERIVE_DEFAULTS: Record<InitAdapterName, string[]> = {
  dart: ['go_router', 'auto_route'],
  typescript: ['react-router', 'next'],
};

export interface DefaultConfigOptions {
  appName?: string;
  locale?: string;
  /** Adapter of the template; default: dart. */
  adapter?: InitAdapterName;
  /** Detected derivation sources; default per adapter (see INIT_DERIVE_DEFAULTS). */
  deriveFrom?: string[];
}

/** YAML-safe scalar: plain identifiers stay raw, everything else is quoted. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

/** Commented configuration template for `ductus init`. */
export function defaultConfigYaml(opts: DefaultConfigOptions = {}): string {
  const appName = opts.appName ?? 'MyApp';
  const locale = opts.locale ?? 'en';
  const adapter = opts.adapter ?? 'dart';
  const deriveFrom = opts.deriveFrom && opts.deriveFrom.length > 0
    ? opts.deriveFrom
    : INIT_DERIVE_DEFAULTS[adapter];

  return [
    '# Ductus configuration',
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
    '  voice: en-you              # formal-sie | informal-du | en-you',
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
