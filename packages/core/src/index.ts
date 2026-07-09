/**
 * Öffentliche API von @ductus/core: Datenformen (contracts), Graph-Pipeline,
 * LLM-Schicht, Ausgabe-Module, Report, Config, Pipeline und Adapter-Runner.
 */

// Datenformen (contracts.ts) — nur Typen.
export type * from './contracts.js';

// Graph-Pipeline (Merge, Validierung, kanonische Serialisierung).
export * from './graph/index.js';

// LLM-Schicht (BYOK, Segmentierung, Cache, Kosten).
export * from './llm/index.js';

// Ausgabe (MDX, Website, Mermaid, Slugs).
export { buildMdxPages, writeMdxPages } from './output/mdx.js';
export { graphToMermaid, segmentToJourney, segmentToMermaid } from './output/mermaid.js';
export { toSlug } from './output/slug.js';
export { buildWebsite, scaffoldWebsite, WebsiteBuildError } from './output/website.js';
export type { BuildWebsiteOptions, ScaffoldWebsiteOptions, WebsiteBuildSpawn } from './output/website.js';

// Report (§9.3).
export { buildReport, writeReport } from './report.js';
export type { BuildReportInput } from './report.js';

// Konfiguration (§10.2).
export { ConfigError, defaultConfigYaml, loadConfig } from './config.js';
export type { DefaultConfigOptions, LoadConfigResult } from './config.js';

// Pipeline (extract/generate/check).
export { LlmError, runCheck, runExtract, runGenerate } from './pipeline.js';
export type {
  CheckResult,
  ExtractResult,
  GenerateRunResult,
  PipelineOptions,
} from './pipeline.js';

// Adapter-Runner (§7).
export { AdapterError, runAdapter } from './adapters/runner.js';
export type { RunAdapterOptions } from './adapters/runner.js';
