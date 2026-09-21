import { OPENAI_ASTRA_CACHED_INPUT_PRICE_PER_M, OPENAI_ASTRA_INPUT_PRICE_PER_M, OPENAI_ASTRA_OUTPUT_PRICE_PER_M } from '../config/openaiModels';

export interface AstraUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
}

export interface AstraPrices {
  inputPerM: number | null;
  cachedInputPerM: number | null;
  outputPerM: number | null;
}

const CONFIGURED: AstraPrices = {
  inputPerM: OPENAI_ASTRA_INPUT_PRICE_PER_M,
  cachedInputPerM: OPENAI_ASTRA_CACHED_INPUT_PRICE_PER_M,
  outputPerM: OPENAI_ASTRA_OUTPUT_PRICE_PER_M,
};

/**
 * The single place Astra cost is computed. Uncached input is billed at the
 * input price, cached input at the cached price, output (which already
 * includes reasoning tokens) at the output price. Returns null — never a
 * guess — when usage is missing or a price needed for a used bucket is unset.
 * Never throws: a cost problem must not block delivering a valid image.
 */
export function estimateAstraCostUsd(usage: AstraUsage | null, prices: AstraPrices = CONFIGURED): number | null {
  try {
    if (!usage) return null;
    const cached = Math.max(0, Math.min(usage.cachedInputTokens, usage.inputTokens));
    const uncached = usage.inputTokens - cached;
    const parts: Array<[number, number | null]> = [
      [uncached, prices.inputPerM],
      [cached, prices.cachedInputPerM],
      [usage.outputTokens, prices.outputPerM],
    ];
    let total = 0;
    let any = false;
    for (const [tokens, price] of parts) {
      if (tokens === 0) continue;
      if (price === null) return null;
      total += (tokens / 1_000_000) * price;
      any = true;
    }
    return any ? Math.round(total * 1_000_000) / 1_000_000 : null;
  } catch {
    return null;
  }
}

/** Sum of step costs; null as soon as any step's cost is unknown (a partial total would understate the real spend). */
export function sumCosts(costs: Array<number | null>): number | null {
  if (costs.length === 0) return null;
  let total = 0;
  for (const c of costs) {
    if (c === null) return null;
    total += c;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}
