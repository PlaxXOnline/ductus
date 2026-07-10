/**
 * Öffentliche Oberfläche der LLM-Schicht.
 */

export { SegmentCache } from './cache.js';
export type { CacheEntry, CacheKeyParts } from './cache.js';
export { estimateCostUsd, estimateTokens } from './cost.js';
export { generateDocs } from './generate.js';
export type { GenerateDocsOptions } from './generate.js';
export { parseJudgeResponse, runFaithfulnessCheck } from './judge.js';
export {
  buildGenerationPrompt,
  buildJudgePrompt,
  JUDGE_MARKER,
  PROMPT_VERSION,
  serializeSegment,
} from './prompts.js';
export type { PromptParts } from './prompts.js';
export { createProvider } from './providers.js';
export { segmentGraph } from './segment.js';
