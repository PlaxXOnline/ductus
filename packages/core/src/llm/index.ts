/**
 * Public surface of the LLM layer.
 */

export { SegmentCache } from './cache.js';
export type { CacheEntry, CacheKeyParts } from './cache.js';
export { estimateCostUsd, estimateTokens } from './cost.js';
export { generateDocs } from './generate.js';
export type { GenerateDocsOptions } from './generate.js';
export {
  JUDGE_RESPONSE_FORMAT,
  judgeParseFailed,
  judgeResponseFormat,
  parseJudgeFindings,
  runFaithfulnessCheck,
  verifyJudgeFindings,
} from './judge.js';
export type { VerifiedJudgeResult } from './judge.js';
export { buildVocabulary, checkLexicon, normalizeTerm, termCoverage } from './lexicon.js';
export type { LexiconResult, SegmentVocabulary } from './lexicon.js';
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
