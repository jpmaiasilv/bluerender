/**
 * Upscale IA — Topaz Labs "High Fidelity V2" configuration.
 *
 * Confirmed against the official docs at developer.topazlabs.com
 * (Enhance / Image API reference, read 2026-09-22) — nothing here is guessed:
 *   - POST https://api.topazlabs.com/image/v1/enhance/async
 *   - GET  https://api.topazlabs.com/image/v1/status/{process_id}
 *   - GET  https://api.topazlabs.com/image/v1/download/{process_id}
 *   - DELETE https://api.topazlabs.com/image/v1/cancel/{process_id}
 *   - auth header: X-API-Key
 *   - accepted input types: jpeg, jpg, png, tiff, tif — NOT webp. This is a
 *     real divergence from an earlier draft of this spec that assumed webp
 *     was accepted "desde que suportado pela Topaz" — it isn't, so webp
 *     uploads are rejected before ever reaching Topaz (see routes/upscale.ts).
 *   - max request size: 500MB (Topaz returns 413 above that)
 *   - max input: 512 megapixels; max output: up to 1024 megapixels (Topaz
 *     does not document the exact error for exceeding output MP — we
 *     pre-validate conservatively and Topaz's own rejection is the backstop)
 */
export const TOPAZ_API_BASE_URL = 'https://api.topazlabs.com/image/v1';
export const TOPAZ_MODEL = 'High Fidelity V2';

export const TOPAZ_MAX_REQUEST_BYTES = 500 * 1024 * 1024;
export const TOPAZ_MAX_INPUT_MEGAPIXELS = 512;
export const TOPAZ_MAX_OUTPUT_MEGAPIXELS = 1024;

/** Topaz does not accept webp — confirmed via official docs, not a platform choice. */
export const TOPAZ_ACCEPTED_INPUT_TYPES = ['image/jpeg', 'image/png'] as const;
export type TopazAcceptedInputType = (typeof TOPAZ_ACCEPTED_INPUT_TYPES)[number];

export type UpscaleScale = 2 | 4;
export const UPSCALE_SCALES: UpscaleScale[] = [2, 4];
export const DEFAULT_UPSCALE_SCALE: UpscaleScale = 2;

/**
 * Provisional credit cost per scale — NOT a final commercial price. Every
 * other engine's cheapest tier in this app costs 2 credits; upscaling a full
 * image at a fixed external per-call cost is a different shape of cost than
 * a render, so these default higher until a real pricing decision is made.
 * Override with TOPAZ_UPSCALE_2X_INTERNAL_CREDITS / _4X_ before shipping a final price.
 */
const DEFAULT_2X_CREDITS = 5;
const DEFAULT_4X_CREDITS = 10;

function creditsFromEnv(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function creditsForScale(scale: UpscaleScale): number {
  if (scale === 2) return creditsFromEnv(process.env.TOPAZ_UPSCALE_2X_INTERNAL_CREDITS, DEFAULT_2X_CREDITS);
  return creditsFromEnv(process.env.TOPAZ_UPSCALE_4X_INTERNAL_CREDITS, DEFAULT_4X_CREDITS);
}

export function isUpscaleScale(value: unknown): value is UpscaleScale {
  return value === 2 || value === 4;
}

/** Never logged, never returned to the client — read exactly once per request. */
export function getTopazApiKey(): string {
  const key = process.env.TOPAZ_API_KEY;
  if (!key) throw new Error('TOPAZ_API_KEY is not set.');
  return key;
}

export function isTopazConfigured(): boolean {
  return Boolean(process.env.TOPAZ_API_KEY);
}
