/**
 * Token and cost estimation (NFR3: make usage transparent before and after a run).
 */

import type { LlmPricing, LlmUsage } from '../contracts.js';

/** Rough heuristic: ~4 characters per token (after a run, the provider's real usage values apply). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Cost in USD — only computable when `llm.pricing` is configured
 * (prices change too quickly for built-in tables).
 */
export function estimateCostUsd(usage: LlmUsage, pricing?: LlmPricing): number | undefined {
  if (!pricing) return undefined;
  return (
    (usage.inputTokens * pricing.inputPerMTokUsd + usage.outputTokens * pricing.outputPerMTokUsd) /
    1_000_000
  );
}
