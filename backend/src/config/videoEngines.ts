export type VideoDuration = 4 | 6 | 8;

/** Veo 3.1's real supported durations at 720p/1080p (confirmed ai.google.dev/gemini-api/docs/veo, 2026-10-02) — xAI's 3/5/8s set doesn't apply to this provider. */
export const VIDEO_DURATION_OPTIONS: VideoDuration[] = [4, 6, 8];

/**
 * Active video provider as of 2026-10-02: Google Veo 3.1 Lite via the Gemini
 * API (providers/geminiVideo.ts), chosen for cost — $0.05/s at 720p,
 * confirmed official pricing, versus xAI's real observed ~$0.14/s for
 * grok-imagine-video-1.5. xAI's provider (providers/xaiVideo.ts) is left in
 * place, untouched and simply unreferenced here — switch VIDEO_PROVIDER_ID/
 * VIDEO_MODEL_ID back and swap the import in routes/videoGenerator.ts to
 * reactivate it, no code needs to be rewritten.
 */
export const VIDEO_PROVIDER_ID = 'gemini';
export const VIDEO_MODEL_ID = 'veo-3.1-lite-generate-preview';

export function isVideoDuration(value: number): value is VideoDuration {
  return VIDEO_DURATION_OPTIONS.includes(value as VideoDuration);
}

/**
 * Credit prices carried over UNCHANGED from the xAI-based table (same
 * numbers, just remapped from 3/5/8s to this provider's 4/6/8s durations) —
 * per the "don't change prices without being asked" rule. Worth noting for
 * a future pricing decision: Veo 3.1 Lite's real cost at 720p is $0.20/$0.30/
 * $0.40 for 4/6/8s respectively (4x–2.8x cheaper than what these credits were
 * originally calibrated against), so the margin on these three tiers just
 * improved substantially — nothing was done about that here, it's a
 * commercial call, not a technical one.
 */
const CREDIT_TABLE: Record<VideoDuration, number> = {
  4: 20,
  6: 35,
  8: 55,
};

export function computeVideoCost(durationSeconds: number): number {
  if (isVideoDuration(durationSeconds)) return CREDIT_TABLE[durationSeconds];
  // Only reachable from the backend-internal model/duration comparison test
  // path (see routes/videoGenerator.ts's `allowAnyDuration`), never from the
  // real product flow — approximate rather than throw, since this path isn't
  // real billing.
  return Math.round((CREDIT_TABLE[8] / 8) * durationSeconds);
}
