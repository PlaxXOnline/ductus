/**
 * Internal contract surface between the core modules (graph/, llm/, output/, CLI).
 *
 * This file contains data shapes only (no implementation), so the modules can
 * be implemented and tested independently of each other. Changes here affect
 * multiple modules — adjust deliberately.
 */

import type {
  AdapterInfo,
  JourneyEdge,
  JourneyFlow,
  JourneyGraph,
  JourneyNode,
  NodeType,
  SourceRef,
} from '@ductus/schema';

// ──────────────────── Configuration (ductus.config.yaml) ─────────────────────

export interface AdapterConfigEntry {
  /** Adapter name, e.g. "dart". */
  name: string;
  /** Project directory relative to the config file. */
  project: string;
  /** Derivation sources (route C), default: ['go_router', 'auto_route']. */
  deriveFrom?: string[];
  /** Explicit command (overrides built-in resolution, NFR6), e.g. "my-adapter --project". */
  command?: string;
  /** Additional adapter-specific keys are passed through unchanged. */
  extra?: Record<string, unknown>;
}

export interface LlmPricing {
  /** USD per 1M input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1M output tokens. */
  outputPerMTokUsd: number;
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'mistral' | 'custom' | 'mock';
  model: string;
  /** Name of the environment variable holding the API key (NFR4: never log/persist). */
  apiKeyEnv: string;
  /** Only for provider "custom": OpenAI-compatible base URL. */
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  faithfulnessCheck: boolean;
  /** More violations than this value ⇒ exit code 2. */
  faithfulnessThreshold: number;
  /** Optional; without prices, only tokens are reported (NFR3). */
  pricing?: LlmPricing;
}

export type Voice = 'formal-sie' | 'informal-du' | 'en-you';
export type Granularity = 'flow' | 'screen';
export type OutputFormat = 'mdx' | 'website';
export type WebsiteGenerator = 'journey' | 'starlight' | 'docusaurus';

export interface StyleConfig {
  voice: Voice;
  granularity: Granularity;
}

export interface OutputConfig {
  format: OutputFormat;
  /** Output directory; in website mode the root of the SSG project. */
  dir: string;
  website: {
    generator: WebsiteGenerator;
    diagrams: boolean;
    /** Optional path to a custom template (overrides the preset). */
    template?: string;
  };
}

export interface DuctusConfig {
  app: { name: string; locale: string; platforms?: string[] };
  adapters: AdapterConfigEntry[];
  llm: LlmConfig;
  style: StyleConfig;
  output: OutputConfig;
  /** Absolute path of the directory containing the config (base for relative paths). */
  rootDir: string;
}

// ─────────────────────────────── Graph pipeline ──────────────────────────────

export type ValidationRule = 'SCHEMA' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

export interface ValidationIssue {
  rule: ValidationRule;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
  flowId?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface MergeConflictSide {
  value: unknown;
  sourceRef?: SourceRef;
  adapter?: string;
}

/** Two manual sources for the same field — fail fast instead of silent ambiguity. */
export interface MergeConflict {
  kind: 'node' | 'edge' | 'flow';
  id: string;
  field: string;
  a: MergeConflictSide;
  b: MergeConflictSide;
}

// ─────────────────────────────── LLM layer ───────────────────────────────────

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Enforced response format (structured output): Anthropic implements it via
 * tool use, OpenAI/Mistral via response_format json_schema, custom
 * (OpenAI-compatible) conservatively via json_object.
 */
export interface LlmResponseFormat {
  /** Schema name (Anthropic tool name or json_schema.name). */
  name: string;
  /** JSON Schema of the expected response. */
  schema: Record<string, unknown>;
  /**
   * Model-visible description (Anthropic tool description). Optional: providers
   * fall back to their existing default when absent.
   */
  description?: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  /** Optional: the provider should guarantee schema-conformant JSON. */
  responseFormat?: LlmResponseFormat;
}

export interface LlmResponse {
  text: string;
  usage?: LlmUsage;
}

/** Provider-agnostic interface (BYOK — the user brings their own API key). */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Connected graph segment as the unit of generation (segmentation instead of one monolithic prompt). */
export interface GraphSegment {
  /** Unique, deterministic (flow id, screen id, or "_misc"). */
  id: string;
  kind: 'flow' | 'screen' | 'misc';
  title: string;
  /** Stable order for the `order` frontmatter and the sidebar. */
  order: number;
  flow?: JourneyFlow;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  /** Edges leaving the segment (context for the LLM, no room for invention). */
  exits: Array<{ edge: JourneyEdge; toTitle: string }>;
}

export interface FaithfulnessViolation {
  /** The disputed claim from the generated text. */
  claim: string;
  reason: string;
}

export interface GeneratedSegment {
  segment: GraphSegment;
  /** Plain Markdown (without frontmatter — the output module builds that). */
  markdown: string;
  fromCache: boolean;
  usage?: LlmUsage;
  /** Mechanically confirmed violations (deterministic vocabulary check + verified judge findings). */
  violations: FaithfulnessViolation[];
  /** Unconfirmed judge findings — pointers for manual review, do not count against the threshold. */
  hints: FaithfulnessViolation[];
}

export interface GenerateResult {
  segments: GeneratedSegment[];
  cache: { hits: number; misses: number };
  /** Actual consumption (sum over all calls incl. the judge). */
  usage: LlmUsage;
  /** Upfront estimate (NFR3), computed before the first provider call. */
  estimated: { inputTokens: number; outputTokens: number };
}

// ─────────────────────────────── Output ──────────────────────────────────────

export interface MdxPage {
  /** File name without directory, e.g. "auth.mdx". */
  fileName: string;
  frontmatter: {
    title: string;
    flow?: string;
    order: number;
    sourceRefs: SourceRef[];
  };
  /** Full page content below the frontmatter. */
  body: string;
}

// ───────────────── Website generator "journey": ductus.data.json ─────────────

/**
 * Node entry in the data contract: resolved display fields instead of optional
 * schema fields — the template needs no fallback logic.
 * `title`: for type=action label ?? title ?? id, otherwise title ?? id
 * (consistent with renderNode/journeyTaskLabel in output/mermaid.ts).
 */
export interface JourneyWebsiteNode {
  id: string;
  type: NodeType;
  title: string;
  /** node.description ?? "". */
  description: string;
  /** true exactly for the start node of the flow (flow.start). */
  start: boolean;
  /** Back-reference into the source code; null instead of undefined (JSON-stable). */
  sourceRef: SourceRef | null;
}

/** Edge entry in the data contract (missing values as null, JSON-stable). */
export interface JourneyWebsiteEdge {
  id: string;
  from: string;
  to: string;
  /** edge.label ?? "" (trigger/condition are separate). */
  label: string;
  trigger: string | null;
  condition: string | null;
  /**
   * 0-based index of the main-path edge (between mainPath[i] and
   * mainPath[i+1], chosen as in deriveMainPath/segmentToJourney), otherwise null.
   */
  main: number | null;
}

/** One journey entry (= one GraphSegment) in the data contract. */
export interface JourneyWebsiteEntry {
  /** segment.id. */
  id: string;
  /** toSlug(segment.id) — URL segment. */
  slug: string;
  kind: 'flow' | 'screen' | 'misc';
  order: number;
  title: string;
  /** flow.description ?? "". */
  description: string;
  /** flow.start (flows only), otherwise null. */
  startNodeId: string | null;
  /** Sorted by id (NFR2). */
  nodes: JourneyWebsiteNode[];
  /** Sorted by id (NFR2). */
  edges: JourneyWebsiteEdge[];
  /** Node ids of the main path; empty if not a flow segment or path < 2 nodes. */
  mainPath: string[];
  /** Generated LLM Markdown pure (no Mermaid attachments, no aside). */
  markdown: string;
  violations: FaithfulnessViolation[];
}

/** Site-wide metadata of the data contract. */
export interface JourneyWebsiteSite {
  /** config.app.name. */
  title: string;
  /** config.app.locale (e.g. "en"). */
  locale: string;
  /** Version of @ductus/core (deterministic from the package's package.json). */
  ductusVersion: string;
  /** extract.adapterInfos, sorted by name (NFR2). */
  adapters: AdapterInfo[];
  violationsTotal: number;
}

/**
 * Root object of ductus.data.json — the only file that scaffoldWebsite
 * writes in generator="journey" mode in addition to the template. The
 * template reads it at build time. Deterministic (NFR2): stable sorting, LF,
 * trailing newline, NO timestamps.
 */
export interface JourneyWebsiteData {
  dataVersion: '1';
  site: JourneyWebsiteSite;
  /** Sorted by order (tie-break slug, NFR2). */
  journeys: JourneyWebsiteEntry[];
}

// ─────────────────────────────── Report (ductus-report.json) ─────────────────

export interface DuctusReport {
  generatedAt: string;
  adapters: AdapterInfo[];
  warnings: ValidationIssue[];
  faithfulness: Array<{
    segmentId: string;
    violations: FaithfulnessViolation[];
    /** Only present when there are unconfirmed judge hints. */
    hints?: FaithfulnessViolation[];
  }>;
  cache?: { hits: number; misses: number; hitRate: number };
  tokens?: {
    estimated: { inputTokens: number; outputTokens: number };
    actual: LlmUsage;
  };
  /** Only when llm.pricing is configured. */
  costUsd?: number;
}

// ─────────────────────────────── Adapter run ─────────────────────────────────

export interface AdapterRunResult {
  graph: JourneyGraph;
  adapter: AdapterConfigEntry;
  /** stderr diagnostics of the adapter (passed through, never swallowed). */
  diagnostics: string;
}
