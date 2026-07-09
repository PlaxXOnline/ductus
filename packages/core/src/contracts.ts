/**
 * Interne Vertragsfläche zwischen den Core-Modulen (graph/, llm/, output/, CLI).
 *
 * Diese Datei enthält ausschließlich Datenformen (keine Implementierung), damit
 * die Module unabhängig voneinander implementiert und getestet werden können.
 * Änderungen hier betreffen mehrere Module — nur bewusst anpassen.
 */

import type {
  AdapterInfo,
  JourneyEdge,
  JourneyFlow,
  JourneyGraph,
  JourneyNode,
  SourceRef,
} from '@ductus/schema';

// ─────────────────────────────── Konfiguration (§10.2) ───────────────────────

export interface AdapterConfigEntry {
  /** Adapter-Name, z. B. "dart". */
  name: string;
  /** Projektverzeichnis relativ zur Config-Datei. */
  project: string;
  /** Ableitungsquellen (Weg C), Default: ['go_router', 'auto_route']. */
  deriveFrom?: string[];
  /** Expliziter Befehl (überschreibt eingebaute Auflösung, NFR6), z. B. "my-adapter --project". */
  command?: string;
  /** Weitere adapterspezifische Schlüssel werden unverändert durchgereicht. */
  extra?: Record<string, unknown>;
}

export interface LlmPricing {
  /** USD je 1M Input-Token. */
  inputPerMTokUsd: number;
  /** USD je 1M Output-Token. */
  outputPerMTokUsd: number;
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'custom' | 'mock';
  model: string;
  /** Name der Umgebungsvariable mit dem API-Key (NFR4: nie loggen/persistieren). */
  apiKeyEnv: string;
  /** Nur für provider "custom": OpenAI-kompatible Basis-URL. */
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  faithfulnessCheck: boolean;
  /** Mehr Verstöße als dieser Wert ⇒ Exit-Code 2. */
  faithfulnessThreshold: number;
  /** Optional; ohne Preise wird nur in Token berichtet (NFR3). */
  pricing?: LlmPricing;
}

export type Voice = 'formal-sie' | 'informal-du' | 'en-you';
export type Granularity = 'flow' | 'screen';
export type OutputFormat = 'mdx' | 'website';
export type WebsiteGenerator = 'starlight' | 'docusaurus';

export interface StyleConfig {
  voice: Voice;
  granularity: Granularity;
}

export interface OutputConfig {
  format: OutputFormat;
  /** Ausgabeverzeichnis; im Website-Modus die Wurzel des SSG-Projekts. */
  dir: string;
  website: {
    generator: WebsiteGenerator;
    diagrams: boolean;
    /** Optionaler Pfad zu einem eigenen Template (überschreibt das Preset). */
    template?: string;
  };
}

export interface DuctusConfig {
  app: { name: string; locale: string; platforms?: string[] };
  adapters: AdapterConfigEntry[];
  llm: LlmConfig;
  style: StyleConfig;
  output: OutputConfig;
  /** Absoluter Pfad des Verzeichnisses, in dem die Config liegt (Basis für rel. Pfade). */
  rootDir: string;
}

// ─────────────────────────────── Graph-Pipeline ──────────────────────────────

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

/** Zwei manuelle Quellen für dasselbe Feld (§5.4) — fail-fast. */
export interface MergeConflict {
  kind: 'node' | 'edge' | 'flow';
  id: string;
  field: string;
  a: MergeConflictSide;
  b: MergeConflictSide;
}

// ─────────────────────────────── LLM-Schicht (§8) ────────────────────────────

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
}

export interface LlmResponse {
  text: string;
  usage?: LlmUsage;
}

/** Provider-agnostische Schnittstelle (BYOK, §8.2). */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Zusammenhängendes Graph-Segment als Generierungseinheit (§8.3 Schritt 1). */
export interface GraphSegment {
  /** Eindeutig, deterministisch (Flow-id, Screen-id oder "_misc"). */
  id: string;
  kind: 'flow' | 'screen' | 'misc';
  title: string;
  /** Stabile Reihenfolge für `order`-Frontmatter und Sidebar. */
  order: number;
  flow?: JourneyFlow;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  /** Kanten, die das Segment verlassen (Kontext für das LLM, keine Erfindungsfläche). */
  exits: Array<{ edge: JourneyEdge; toTitle: string }>;
}

export interface FaithfulnessViolation {
  /** Die beanstandete Behauptung aus dem generierten Text. */
  claim: string;
  reason: string;
}

export interface GeneratedSegment {
  segment: GraphSegment;
  /** Reines Markdown (ohne Frontmatter — die baut das Output-Modul). */
  markdown: string;
  fromCache: boolean;
  usage?: LlmUsage;
  violations: FaithfulnessViolation[];
}

export interface GenerateResult {
  segments: GeneratedSegment[];
  cache: { hits: number; misses: number };
  /** Tatsächlicher Verbrauch (Summe über alle Aufrufe inkl. Judge). */
  usage: LlmUsage;
  /** Vorab-Schätzung (NFR3), vor dem ersten Provider-Aufruf berechnet. */
  estimated: { inputTokens: number; outputTokens: number };
}

// ─────────────────────────────── Ausgabe (§9) ────────────────────────────────

export interface MdxPage {
  /** Dateiname ohne Verzeichnis, z. B. "auth.mdx". */
  fileName: string;
  frontmatter: {
    title: string;
    flow?: string;
    order: number;
    sourceRefs: SourceRef[];
  };
  /** Vollständiger Seiteninhalt unterhalb des Frontmatters. */
  body: string;
}

// ─────────────────────────────── Report (§9.3) ───────────────────────────────

export interface DuctusReport {
  generatedAt: string;
  adapters: AdapterInfo[];
  warnings: ValidationIssue[];
  faithfulness: Array<{ segmentId: string; violations: FaithfulnessViolation[] }>;
  cache?: { hits: number; misses: number; hitRate: number };
  tokens?: {
    estimated: { inputTokens: number; outputTokens: number };
    actual: LlmUsage;
  };
  /** Nur wenn llm.pricing konfiguriert ist. */
  costUsd?: number;
}

// ─────────────────────────────── Adapter-Lauf (§7) ───────────────────────────

export interface AdapterRunResult {
  graph: JourneyGraph;
  adapter: AdapterConfigEntry;
  /** stderr-Diagnostik des Adapters (wird durchgereicht, nie verschluckt). */
  diagnostics: string;
}
