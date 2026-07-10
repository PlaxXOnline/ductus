/**
 * Programmatische API des TypeScript-Adapters. Der übliche Einstieg ist das
 * CLI (`ductus-adapter-typescript`); die Exporte hier dienen Tests und
 * Werkzeugen, die den Adapter einbetten.
 */

export { AdapterConfig, KNOWN_DERIVE_SOURCES } from './config.js';
export {
  AdapterException,
  adapterVersion,
  cliAdapterName,
  encodeCanonicalGraph,
  schemaVersion,
  SourceKind,
  validTriggers,
  type GraphEdge,
  type GraphFlow,
  type GraphNode,
  type SourceRef,
} from './graph-model.js';
export { parseComments, splitBlocks } from './comment-parser.js';
export { ManualExtraction, type ActionCandidate } from './candidates.js';
export { mergeGraph, type MergeResult } from './merger.js';
export { deriveReactRouter, ReactRouterDerivation } from './derive/react-router.js';
export { deriveNext, NextDerivation } from './derive/next.js';
export { scanProject, ScannedFile, globToRegExp } from './scanner.js';
export { runAdapter, type RunAdapterOptions } from './runner.js';
