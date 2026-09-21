import {
  OPENAI_IMAGE_PRICE_IMAGE_INPUT_PER_M,
  OPENAI_IMAGE_PRICE_IMAGE_OUTPUT_PER_M,
  OPENAI_IMAGE_PRICE_TEXT_INPUT_PER_M,
} from '../config/openaiModels';

export interface OpenAiImageUsage {
  textInputTokens: number | null;
  imageInputTokens: number | null;
  imageOutputTokens: number | null;
  totalTokens: number | null;
}

export interface OpenAiImagePrices {
  textInputPerM: number | null;
  imageInputPerM: number | null;
  imageOutputPerM: number | null;
}

const CONFIGURED_PRICES: OpenAiImagePrices = {
  textInputPerM: OPENAI_IMAGE_PRICE_TEXT_INPUT_PER_M,
  imageInputPerM: OPENAI_IMAGE_PRICE_IMAGE_INPUT_PER_M,
  imageOutputPerM: OPENAI_IMAGE_PRICE_IMAGE_OUTPUT_PER_M,
};

/**
 * The single place provider cost is computed. Returns null (never a guess)
 * when usage is missing or any price needed for a token bucket that was
 * actually used is not configured. Never throws — cost failure must not
 * block delivering the image.
 */
export function estimateOpenAiImageCostUsd(usage: OpenAiImageUsage | null, prices: OpenAiImagePrices = CONFIGURED_PRICES): number | null {
  try {
    if (!usage) return null;
    const buckets: Array<[number | null, number | null]> = [
      [usage.textInputTokens, prices.textInputPerM],
      [usage.imageInputTokens, prices.imageInputPerM],
      [usage.imageOutputTokens, prices.imageOutputPerM],
    ];
    let total = 0;
    let anyUsed = false;
    for (const [tokens, price] of buckets) {
      if (tokens === null || tokens === 0) continue;
      if (price === null) return null;
      total += (tokens / 1_000_000) * price;
      anyUsed = true;
    }
    return anyUsed ? Math.round(total * 1_000_000) / 1_000_000 : null;
  } catch {
    return null;
  }
}
