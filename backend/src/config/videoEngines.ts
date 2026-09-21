export type VideoDuration = 3 | 5 | 8;

export const VIDEO_DURATION_OPTIONS: VideoDuration[] = [3, 5, 8];

export const VIDEO_PROVIDER_ID = 'xai';
export const VIDEO_MODEL_ID = 'grok-imagine-video-1.5';

export function isVideoDuration(value: number): value is VideoDuration {
  return VIDEO_DURATION_OPTIONS.includes(value as VideoDuration);
}

/**
 * Final commercial pricing (confirmed 2026-08-25), set as a fixed table per
 * duration rather than a flat per-second rate. Chosen after comparing real
 * xAI costs across two live test generations: grok-imagine-video-1.5 at
 * 5s/720p cost $0.70 real (~$0.14/s — well above its documented $0.08/s),
 * while grok-imagine-video at 3s/480p cost $0.152 real (~$0.05/s, matching
 * its documented rate almost exactly). The confirmed table below is not a
 * pure per-second multiple of either model's real cost — it's the business's
 * chosen price, not derived automatically here.
 */
const CREDIT_TABLE: Record<VideoDuration, number> = {
  3: 20,
  5: 35,
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
