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
  NodeType,
  SourceRef,
} from '@ductus/schema';

// ──────────────────── Konfiguration (ductus.config.yaml) ─────────────────────

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
export type WebsiteGenerator = 'journey' | 'starlight' | 'docusaurus';

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

/** Zwei manuelle Quellen für dasselbe Feld — fail-fast statt stiller Mehrdeutigkeit. */
export interface MergeConflict {
  kind: 'node' | 'edge' | 'flow';
  id: string;
  field: string;
  a: MergeConflictSide;
  b: MergeConflictSide;
}

// ─────────────────────────────── LLM-Schicht ─────────────────────────────────

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

/** Provider-agnostische Schnittstelle (BYOK — der Nutzer bringt den eigenen API-Key). */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Zusammenhängendes Graph-Segment als Generierungseinheit (Segmentierung statt Monolith-Prompt). */
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

// ─────────────────────────────── Ausgabe ─────────────────────────────────────

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

// ───────────────── Website-Generator "journey": ductus.data.json ─────────────

/**
 * Node-Eintrag im Datenvertrag: aufgelöste Anzeige-Felder statt optionaler
 * Schema-Felder — das Template braucht keine Fallback-Logik.
 * `title`: für type=action label ?? title ?? id, sonst title ?? id
 * (konsistent zu renderNode/journeyTaskLabel in output/mermaid.ts).
 */
export interface JourneyWebsiteNode {
  id: string;
  type: NodeType;
  title: string;
  /** node.description ?? "". */
  description: string;
  /** true genau für den Start-Node des Flows (flow.start). */
  start: boolean;
  /** Rückverweis in den Quellcode; null statt undefined (JSON-stabil). */
  sourceRef: SourceRef | null;
}

/** Kanten-Eintrag im Datenvertrag (fehlende Werte als null, JSON-stabil). */
export interface JourneyWebsiteEdge {
  id: string;
  from: string;
  to: string;
  /** edge.label ?? "" (trigger/condition stehen separat). */
  label: string;
  trigger: string | null;
  condition: string | null;
  /**
   * 0-basierter Index der Hauptpfad-Kante (zwischen mainPath[i] und
   * mainPath[i+1], gewählt wie in deriveMainPath/segmentToJourney), sonst null.
   */
  main: number | null;
}

/** Ein Journey-Eintrag (= ein GraphSegment) im Datenvertrag. */
export interface JourneyWebsiteEntry {
  /** segment.id. */
  id: string;
  /** toSlug(segment.id) — URL-Segment. */
  slug: string;
  kind: 'flow' | 'screen' | 'misc';
  order: number;
  title: string;
  /** flow.description ?? "". */
  description: string;
  /** flow.start (nur flows), sonst null. */
  startNodeId: string | null;
  /** Nach id sortiert (NFR2). */
  nodes: JourneyWebsiteNode[];
  /** Nach id sortiert (NFR2). */
  edges: JourneyWebsiteEdge[];
  /** Node-IDs des Hauptpfads; leer wenn kein flow-Segment oder Pfad < 2 Nodes. */
  mainPath: string[];
  /** Generiertes LLM-Markdown pur (ohne Mermaid-Anhänge, ohne Aside). */
  markdown: string;
  violations: FaithfulnessViolation[];
}

/** Site-weite Metadaten des Datenvertrags. */
export interface JourneyWebsiteSite {
  /** config.app.name. */
  title: string;
  /** config.app.locale (z. B. "de"). */
  locale: string;
  /** Version von @ductus/core (deterministisch aus der package.json des Pakets). */
  ductusVersion: string;
  /** extract.adapterInfos, nach name sortiert (NFR2). */
  adapters: AdapterInfo[];
  violationsTotal: number;
}

/**
 * Wurzelobjekt der ductus.data.json — die einzige Datei, die scaffoldWebsite
 * im Modus generator="journey" zusätzlich zum Template schreibt. Das Template
 * liest sie zur Buildzeit. Deterministisch (NFR2): stabile Sortierung, LF,
 * abschließender Zeilenumbruch, KEINE Zeitstempel.
 */
export interface JourneyWebsiteData {
  dataVersion: '1';
  site: JourneyWebsiteSite;
  /** Nach order sortiert (Tie-Break slug, NFR2). */
  journeys: JourneyWebsiteEntry[];
}

// ─────────────────────────────── Report (ductus-report.json) ─────────────────

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

// ─────────────────────────────── Adapter-Lauf ────────────────────────────────

export interface AdapterRunResult {
  graph: JourneyGraph;
  adapter: AdapterConfigEntry;
  /** stderr-Diagnostik des Adapters (wird durchgereicht, nie verschluckt). */
  diagnostics: string;
}
