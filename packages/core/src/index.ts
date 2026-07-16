/**
 * Public API of @ductus/core: data shapes (contracts), graph pipeline,
 * LLM layer, output modules, report, config, pipeline, and adapter runner.
 */

// Data shapes (contracts.ts) — types only.
export type * from './contracts.js';

// Graph pipeline (merge, validation, canonical serialization).
export * from './graph/index.js';

// LLM layer (BYOK, segmentation, cache, costs).
export * from './llm/index.js';

// Output (MDX, website, Mermaid, slugs, journey data contract).
export { buildMdxPages, writeMdxPages } from './output/mdx.js';
export { deriveMainPath, graphToMermaid, segmentToJourney, segmentToMermaid } from './output/mermaid.js';
export type { MainPath } from './output/mermaid.js';
export { buildJourneyData, serializeJourneyData } from './output/journey-data.js';
export type { BuildJourneyDataInput } from './output/journey-data.js';
export { toSlug } from './output/slug.js';
export { outputStrings } from './output/strings.js';
export type { OutputStrings } from './output/strings.js';
export { buildWebsite, scaffoldWebsite, WebsiteBuildError } from './output/website.js';
export type { BuildWebsiteOptions, ScaffoldWebsiteOptions, WebsiteBuildSpawn } from './output/website.js';

// Report (ductus-report.json).
export { buildReport, writeReport } from './report.js';
export type { BuildReportInput } from './report.js';

// Configuration (ductus.config.yaml).
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

// Adapter runner.
export { AdapterError, runAdapter } from './adapters/runner.js';
export type { RunAdapterOptions } from './adapters/runner.js';
