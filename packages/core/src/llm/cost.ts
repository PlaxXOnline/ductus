/**
 * Token- und Kostenschätzung (NFR3: Verbrauch vorab und nach Lauf transparent machen).
 */

import type { LlmPricing, LlmUsage } from '../contracts.js';

/** Grobe Heuristik: ~4 Zeichen je Token (nach Lauf gelten die echten usage-Werte des Providers). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Kosten in USD — nur berechenbar, wenn `llm.pricing` konfiguriert ist
 * (Preise ändern sich zu schnell für eingebaute Tabellen).
 */
export function estimateCostUsd(usage: LlmUsage, pricing?: LlmPricing): number | undefined {
  if (!pricing) return undefined;
  return (
    (usage.inputTokens * pricing.inputPerMTokUsd + usage.outputTokens * pricing.outputPerMTokUsd) /
    1_000_000
  );
}
