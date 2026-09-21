import { OPENAI_ARCHITECT_CHAT_CACHED_INPUT_PRICE_PER_M, OPENAI_ARCHITECT_CHAT_INPUT_PRICE_PER_M, OPENAI_ARCHITECT_CHAT_OUTPUT_PRICE_PER_M } from '../config/openaiModels';
import { ArchitectMessageUsage } from './architectChatStore';

/**
 * Same computation as services/openaiAstraCost.ts, for the chat assistant's
 * own (independently configurable) prices. Returns null — never a guess —
 * when usage is missing or a price needed for a used token bucket is unset.
 * Never throws: an unknown cost must not block delivering a reply.
 */
export function estimateArchitectChatCostUsd(usage: ArchitectMessageUsage | null): number | null {
  try {
    if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
    const cached = Math.max(0, Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens));
    const uncached = usage.inputTokens - cached;
    const parts: Array<[number, number | null]> = [
      [uncached, OPENAI_ARCHITECT_CHAT_INPUT_PRICE_PER_M],
      [cached, OPENAI_ARCHITECT_CHAT_CACHED_INPUT_PRICE_PER_M],
      [usage.outputTokens, OPENAI_ARCHITECT_CHAT_OUTPUT_PRICE_PER_M],
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
