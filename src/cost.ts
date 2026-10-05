import type { Config } from './config.js';

/**
 * Honest cost formula used by the reference harness. Matches the MCP
 * server's own estimator so a well-behaved harness never gets clamped:
 *
 *   cost = tier(model) × (prompt_tokens + response_tokens) / tokensPerCostUnit
 *
 * The identifier for this function is exactly the one students are pointed
 * at in the lesson, see EDU_PROJECT.md section "Hranice důvěry mezi klientem
 * a serverem" and SW_PROJECT.md Komponenta 4.
 */
export function computeCost(
  config: Config,
  input: { model: string; promptTokens: number; responseTokens: number }
): number {
  const tiers = config.cost.modelTiers;
  const tier = tiers[input.model] ?? tiers.default ?? 1;
  const totalTokens = Math.max(0, input.promptTokens) + Math.max(0, input.responseTokens);
  return tier * (totalTokens / config.cost.tokensPerCostUnit);
}
